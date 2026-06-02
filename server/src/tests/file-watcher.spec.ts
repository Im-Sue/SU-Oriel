import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { mkdir, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "vitest";

import { buildApp } from "../app.js";
import {
  buildWatchOptions,
  DebouncedPathQueue,
  DEFAULT_FILE_WATCHER_DEBOUNCE_MS,
  DEFAULT_FILE_WATCHER_POLL_INTERVAL_MS,
  FileWatcherService,
  isFileWatcherEnabled,
  isIndexerIgnoredWatchPath,
  isIndexerWatchedPath,
  resolveFileWatcherPolling,
} from "../fs/file-watcher-service.js";
import { shouldScanProjectOnStartup } from "../indexer/startup-project-scan.js";
import type { ProjectRecord, ProjectStore } from "../modules/project/project.types.js";

class FakeWatcher extends EventEmitter {
  public closeCalls = 0;

  public override on(eventName: string | symbol, listener: (...args: unknown[]) => void): this {
    return super.on(eventName, listener);
  }

  public async close(): Promise<void> {
    this.closeCalls += 1;
  }
}

function projectRecord(input: { id: string; name?: string; localPath: string }): ProjectRecord {
  return {
    id: input.id,
    name: input.name ?? input.id,
    localPath: input.localPath,
    summary: null,
    initStatus: "initialized",
    docsRoot: "docs",
    lastScanAt: null,
    syncStatus: "idle",
    ownerUserId: null,
    createdAt: "2026-05-29T00:00:00.000Z",
    updatedAt: "2026-05-29T00:00:00.000Z"
  };
}

async function waitForCondition(assertion: () => Promise<boolean>, timeoutMs = 1000): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (await assertion()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.fail("等待条件超时");
}

test("文件监听服务随 Fastify 生命周期启动和清理", async () => {
  const calls: string[] = [];
  const app = buildApp({
    enableFileWatcher: true,
    fileWatcherService: {
      start: async () => {
        calls.push("start");
      },
      stop: async () => {
        calls.push("stop");
      }
    }
  });

  await app.ready();
  assert.deepEqual(calls, ["start"]);

  await app.close();
  assert.deepEqual(calls, ["start", "stop"]);
});

test("文件监听默认开启，显式 off 值才关闭", async () => {
  assert.equal(isFileWatcherEnabled(undefined), true);
  assert.equal(isFileWatcherEnabled(""), true);
  assert.equal(isFileWatcherEnabled("1"), true);
  assert.equal(isFileWatcherEnabled("true"), true);
  assert.equal(isFileWatcherEnabled("yes"), true);
  assert.equal(isFileWatcherEnabled("on"), true);
  assert.equal(isFileWatcherEnabled("0"), false);
  assert.equal(isFileWatcherEnabled("false"), false);
  assert.equal(isFileWatcherEnabled("no"), false);
  assert.equal(isFileWatcherEnabled("off"), false);
});

test("文件监听 polling 在 WSL 环境默认开启，并支持 env 显式开关和间隔", () => {
  assert.deepEqual(
    resolveFileWatcherPolling({
      platform: "linux",
      osRelease: "5.15.90.1-microsoft-standard-WSL2",
      env: {}
    }),
    { usePolling: true, interval: DEFAULT_FILE_WATCHER_POLL_INTERVAL_MS }
  );
  assert.deepEqual(
    resolveFileWatcherPolling({
      platform: "linux",
      osRelease: "6.8.0-generic",
      env: {}
    }),
    { usePolling: false, interval: DEFAULT_FILE_WATCHER_POLL_INTERVAL_MS }
  );
  assert.deepEqual(
    resolveFileWatcherPolling({
      platform: "linux",
      osRelease: "6.8.0-generic",
      env: {
        CCB_INDEXER_WATCH_POLLING: "1",
        CCB_INDEXER_WATCH_POLL_INTERVAL_MS: "1500"
      }
    }),
    { usePolling: true, interval: 1500 }
  );
  assert.deepEqual(
    resolveFileWatcherPolling({
      platform: "linux",
      osRelease: "5.15.90.1-microsoft-standard-WSL2",
      env: { CCB_INDEXER_WATCH_POLLING: "0" }
    }),
    { usePolling: false, interval: DEFAULT_FILE_WATCHER_POLL_INTERVAL_MS }
  );

  assert.equal(
    buildWatchOptions({
      platform: "linux",
      osRelease: "5.15.90.1-microsoft-standard-WSL2",
      env: {}
    }).usePolling,
    true
  );
});

test("文件监听 ignored 排除 indexer 自写产物但保留 breakdown draft", () => {
  const options = buildWatchOptions({
    platform: "linux",
    osRelease: "5.15.90.1-microsoft-standard-WSL2",
    env: {}
  });
  assert.equal(typeof options.ignored, "function");
  const ignored = options.ignored as (filePath: string) => boolean;

  assert.equal(ignored("/repo/docs/00_文档地图.md"), true);
  assert.equal(ignored("/repo/docs/.ccb/index/document-map.json"), true);
  assert.equal(ignored("/repo/docs/.ccb/index"), true);
  assert.equal(ignored("/repo/docs/.ccb/locks/project.lock"), true);
  assert.equal(ignored("/repo/docs/.ccb/drafts/breakdown/req-1.json"), false);
  assert.equal(ignored("/repo/docs/03_开发计划/task.md"), false);

  assert.equal(isIndexerIgnoredWatchPath("/repo/docs/00_文档地图.md"), true);
  assert.equal(isIndexerIgnoredWatchPath("/repo/docs/.ccb/index/document-map.json"), true);
  assert.equal(isIndexerWatchedPath("/repo/docs/00_文档地图.md"), false);
  assert.equal(isIndexerWatchedPath("/repo/docs/.ccb/index/document-map.json"), false);
  assert.equal(isIndexerWatchedPath("/repo/docs/.ccb/drafts/breakdown/req-1.json"), true);
  assert.equal(isIndexerWatchedPath("/repo/docs/03_开发计划/task.md"), true);
});

test("buildApp 默认随生命周期启动注入的文件监听服务", async () => {
  const calls: string[] = [];
  const app = buildApp({
    fileWatcherService: {
      start: async () => {
        calls.push("start");
      },
      stop: async () => {
        calls.push("stop");
      }
    }
  });

  await app.ready();
  assert.deepEqual(calls, ["start"]);

  await app.close();
  assert.deepEqual(calls, ["start", "stop"]);
});

test("FileWatcherService start/stop 重复调用幂等安全", async () => {
  const root = join(tmpdir(), `ccb-file-watcher-idempotent-${randomUUID()}`);
  await mkdir(join(root, "docs"), { recursive: true });
  const watchers: FakeWatcher[] = [];
  const scans: string[] = [];
  const service = new FileWatcherService({
    prisma: {
      project: {
        findMany: async () => [{ id: "project-idempotent" }],
        findUnique: async () => ({ id: "project-idempotent", name: "Idempotent", localPath: root })
      }
    } as never,
    watchFactory: ((path: string, options: unknown) => {
      assert.equal(path, join(root, "docs"));
      assert.equal((options as { ignoreInitial?: boolean }).ignoreInitial, true);
      const watcher = new FakeWatcher();
      watchers.push(watcher);
      return watcher;
    }) as never,
    scanProject: async (_prisma, projectId) => {
      scans.push(projectId);
    }
  });

  try {
    await service.start();
    await service.start();
    assert.deepEqual(service.getWatchedProjectIds(), ["project-idempotent"]);
    assert.equal(watchers.length, 1);
    assert.deepEqual(scans, []);

    await service.stop();
    await service.stop();
    assert.deepEqual(service.getWatchedProjectIds(), []);
    assert.equal(watchers[0].closeCalls, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("FileWatcherService 启动注册不 backfill，动态注册 watcher 会 backfill 且避免重复注册", async () => {
  const firstRoot = join(tmpdir(), `ccb-file-watcher-first-${randomUUID()}`);
  const secondRoot = join(tmpdir(), `ccb-file-watcher-second-${randomUUID()}`);
  await mkdir(join(firstRoot, "docs"), { recursive: true });
  await mkdir(join(secondRoot, "docs"), { recursive: true });
  const projects = new Map([
    ["project-1", { id: "project-1", name: "Project 1", localPath: firstRoot }],
    ["project-2", { id: "project-2", name: "Project 2", localPath: secondRoot }]
  ]);
  const watchers: FakeWatcher[] = [];
  const scans: string[] = [];
  const service = new FileWatcherService({
    prisma: {
      project: {
        findMany: async () => [{ id: "project-1" }],
        findUnique: async ({ where }: { where: { id: string } }) => projects.get(where.id) ?? null
      }
    } as never,
    debounceMs: 5,
    watchFactory: (() => {
      const watcher = new FakeWatcher();
      watchers.push(watcher);
      return watcher;
    }) as never,
    scanProject: async (_prisma, projectId) => {
      scans.push(projectId);
    }
  });

  try {
    await service.start();
    assert.deepEqual(service.getWatchedProjectIds(), ["project-1"]);
    assert.deepEqual(scans, []);

    await service.ensureProjectWatcher("project-2");
    await service.ensureProjectWatcher("project-2");
    assert.deepEqual(service.getWatchedProjectIds(), ["project-1", "project-2"]);
    assert.equal(watchers.length, 2);
    assert.deepEqual(scans, ["project-2"]);

    const newFile = join(secondRoot, "docs", "new-requirement.md");
    await writeFile(newFile, "# new\n", "utf8");
    watchers[1].emit("add", newFile);
    await waitForCondition(async () => scans.filter((projectId) => projectId === "project-2").length === 2);
  } finally {
    await service.stop();
    await rm(firstRoot, { recursive: true, force: true });
    await rm(secondRoot, { recursive: true, force: true });
  }
});

test("FileWatcherService 忽略 document-map 自写事件但保留 breakdown draft 事件", async () => {
  const root = join(tmpdir(), `ccb-file-watcher-ignore-${randomUUID()}`);
  await mkdir(join(root, "docs", ".ccb", "drafts", "breakdown"), { recursive: true });
  await mkdir(join(root, "docs", ".ccb", "index"), { recursive: true });
  const watchers: FakeWatcher[] = [];
  const scans: string[] = [];
  const service = new FileWatcherService({
    prisma: {
      project: {
        findMany: async () => [{ id: "project-ignore" }],
        findUnique: async () => ({ id: "project-ignore", name: "Ignore", localPath: root })
      }
    } as never,
    debounceMs: 5,
    watchFactory: ((path: string, options: unknown) => {
      assert.equal(path, join(root, "docs"));
      assert.equal(typeof (options as { ignored?: unknown }).ignored, "function");
      const watcher = new FakeWatcher();
      watchers.push(watcher);
      return watcher;
    }) as never,
    scanProject: async (_prisma, projectId) => {
      scans.push(projectId);
    }
  });

  try {
    await service.start();
    assert.deepEqual(scans, []);

    watchers[0].emit("change", join(root, "docs", "00_文档地图.md"));
    watchers[0].emit("change", join(root, "docs", ".ccb", "index", "document-map.json"));
    watchers[0].emit("change", join(root, "docs", ".ccb", "drafts", "breakdown", "req-1.json"));

    await waitForCondition(async () => scans.length === 1);
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.deepEqual(scans, ["project-ignore"]);
  } finally {
    await service.stop();
    await rm(root, { recursive: true, force: true });
  }
});

test("项目创建后 route 层动态注册 watcher", async () => {
  const calls: string[] = [];
  const createdAt = "2026-05-29T00:00:00.000Z";
  const projectStore: ProjectStore = {
    list: async () => [],
    create: async (input) => ({
      id: "created-project",
      name: input.name,
      localPath: input.localPath,
      summary: input.summary ?? null,
      initStatus: "not_initialized",
      docsRoot: null,
      lastScanAt: null,
      syncStatus: "idle",
      ownerUserId: null,
      createdAt,
      updatedAt: createdAt
    })
  };
  const app = buildApp({
    projectStore,
    enableFileWatcher: true,
    startupProjectScan: null,
    fileWatcherService: {
      start: async () => {
        calls.push("start");
      },
      stop: async () => {
        calls.push("stop");
      },
      ensureProjectWatcher: async (projectId, options) => {
        calls.push(`ensure:${projectId}:${String(options?.backfill)}`);
      }
    }
  });

  const response = await app.inject({
    method: "POST",
    url: "/api/projects",
    payload: {
      name: "Created Project",
      localPath: "/tmp/created-project"
    }
  });

  assert.equal(response.statusCode, 201, response.body);
  assert.deepEqual(calls, ["start", "ensure:created-project:false"]);
  await app.close();
  assert.deepEqual(calls, ["start", "ensure:created-project:false", "stop"]);
});

test("Console 启动时异步触发项目补扫", async () => {
  const calls: string[] = [];
  const app = buildApp({
    enableFileWatcher: false,
    startupProjectScan: {
      start: async () => {
        calls.push("startup-scan");
      }
    }
  });

  await app.ready();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(calls, ["startup-scan"]);

  await app.close();
});

test("启动补扫按 lastScanAt 判断 docs 文件是否需要补扫", async () => {
  const root = join(tmpdir(), `ccb-startup-scan-${randomUUID()}`);
  const docsRoot = join(root, "docs", ".ccb", "specs", "active");
  const specPath = join(docsRoot, "subtask-abcdef123456.md");
  try {
    await mkdir(docsRoot, { recursive: true });
    await writeFile(specPath, "# old\n", "utf8");
    const oldTime = new Date("2026-05-22T01:00:00.000Z");
    await utimes(specPath, oldTime, oldTime);

    assert.equal(await shouldScanProjectOnStartup(root, null), true);
    assert.equal(await shouldScanProjectOnStartup(root, new Date("2026-05-22T02:00:00.000Z")), false);

    await writeFile(specPath, "# new\n", "utf8");
    const newTime = new Date("2026-05-22T03:00:00.000Z");
    await utimes(specPath, newTime, newTime);
    assert.equal(await shouldScanProjectOnStartup(root, new Date("2026-05-22T02:00:00.000Z")), true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("文件事件队列默认 500ms 防抖并合并同一路径", async () => {
  assert.equal(DEFAULT_FILE_WATCHER_DEBOUNCE_MS, 500);
  const flushed: string[] = [];
  const queue = new DebouncedPathQueue<{ filePath: string }>({
    debounceMs: 10,
    handler: async (item) => {
      flushed.push(item.filePath);
    }
  });

  queue.enqueue("state.md", { filePath: "revision-1" });
  queue.enqueue("state.md", { filePath: "revision-2" });

  await waitForCondition(async () => flushed.length === 1);
  assert.deepEqual(flushed, ["revision-2"]);

  await queue.dispose();
});

test("文件监听接受 markdown 与 breakdown draft JSON，忽略其它 JSON", () => {
  assert.equal(isIndexerWatchedPath("/repo/docs/.ccb/state/task-1.md"), true);
  assert.equal(isIndexerWatchedPath("/repo/docs/.ccb/drafts/breakdown/req-1.json"), true);
  assert.equal(isIndexerWatchedPath("/repo/docs/.ccb/index/document-map.json"), false);
  assert.equal(isIndexerWatchedPath("/repo/docs/.ccb/events/journal.jsonl"), false);
  assert.equal(isIndexerWatchedPath("/repo/docs/other.json"), false);
});
