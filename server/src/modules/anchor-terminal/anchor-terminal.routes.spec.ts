import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import type { IncomingMessage } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

import Fastify from "fastify";
import websocket from "@fastify/websocket";
import { afterEach, test, vi } from "vitest";

import { prisma } from "../../db/prisma.js";
import {
  evaluateAnchorTerminalClientFrame,
  registerAnchorTerminalRoutes,
  type AnchorTerminalRouteDependencies
} from "./anchor-terminal.routes.js";
import { AnchorTerminalManager } from "./terminal-manager.js";
import { AnchorTerminalRecordingStore } from "./recording-store.js";
import type { AnchorTerminalTmuxBackend } from "./types.js";

async function resetFixtures(): Promise<void> {
  await prisma.anchorAllocation.deleteMany();
  await prisma.task.deleteMany();
  await prisma.requirement.deleteMany();
  await prisma.project.deleteMany();
}

async function createProjectFixture() {
  const suffix = randomUUID();
  return await prisma.project.create({
    data: {
      name: `anchor-terminal-${suffix}`,
      localPath: join(tmpdir(), `anchor-terminal-${suffix}`)
    }
  });
}

async function createAnchorFixture(options: {
  state?: "ready" | "destroyed";
  project?: Awaited<ReturnType<typeof createProjectFixture>>;
  anchorId?: string;
  anchorProjectId?: string | null;
  subjectType?: string;
  subjectId?: string;
} = {}) {
  const project = options.project ?? await createProjectFixture();
  const anchorId = options.anchorId ?? `anchor_terminal_${randomUUID()}`;
  const anchorPath = join(project.localPath, `anchor-worktree-${anchorId}`);
  const anchor = await prisma.anchorAllocation.create({
    data: {
      anchorId,
      anchorPath,
      projectId: options.anchorProjectId === undefined ? project.id : options.anchorProjectId,
      subjectType: options.subjectType ?? "subtask",
      subjectId: options.subjectId ?? "task-1",
      subjectKey: options.subjectId ?? "task-1",
      mode: "execution",
      socketPath: join(anchorPath, ".ccb", "ccbd", "ccbd.sock"),
      state: options.state ?? "ready"
    }
  });
  return { project, anchor };
}

let tempDir: string | null = null;

function buildRetiredAnchorTerminalRouteApp(dependencies: AnchorTerminalRouteDependencies) {
  const app = Fastify();
  void app.register(websocket);
  void app.register(registerAnchorTerminalRoutes, dependencies);
  return app;
}

afterEach(async () => {
  await resetFixtures();
  if (tempDir) {
    await rm(tempDir, { recursive: true, force: true });
    tempDir = null;
  }
});

test("GET /api/anchor-terminal/panes lists panes without exposing anchor paths", async () => {
  await resetFixtures();
  const { project, anchor } = await createAnchorFixture();
  const tmux: AnchorTerminalTmuxBackend = {
    listPanes: vi.fn(async () => [
      {
        name: "ccb_claude",
        paneId: "%2",
        title: "ccb_claude",
        currentCommand: "python",
        sessionName: "ccb-realtime_translator-task-task-1-a1b2",
        windowIndex: 0,
        paneIndex: 1,
        active: true,
        cols: 80,
        rows: 24
      }
    ]),
    capturePane: vi.fn(),
    captureFrame: vi.fn(async () => ({ data: "", cols: 80, rows: 24 })),
    startPipe: vi.fn(),
    stopPipe: vi.fn(),
    getWindowLayout: vi.fn(async () => "layout"),
    resizeWindow: vi.fn(async () => undefined),
    zoomPane: vi.fn(async () => undefined),
    unzoomPane: vi.fn(async () => undefined),
    restoreLayout: vi.fn(async () => undefined),
    sendKeysLiteral: vi.fn(async () => undefined)
  };
  tempDir = await mkdtemp(join(tmpdir(), "anchor-terminal-route-"));
  const app = buildRetiredAnchorTerminalRouteApp({
    manager: new AnchorTerminalManager({
      tmux,
      recordingStore: new AnchorTerminalRecordingStore(tempDir),
      anchorResolver: async (anchorId) => {
        const row = await prisma.anchorAllocation.findUnique({ where: { anchorId } });
        return row && row.state !== "destroyed"
          ? { anchorId: row.anchorId, anchorPath: row.anchorPath, taskId: row.subjectId, state: row.state }
          : null;
      }
    }),
    recordingStore: new AnchorTerminalRecordingStore(tempDir)
  });

  try {
    const response = await app.inject({
      method: "GET",
      url: `/api/anchor-terminal/panes?anchorId=${encodeURIComponent(anchor.anchorId)}&projectId=${encodeURIComponent(project.id)}`
    });

    assert.equal(response.statusCode, 200);
    const body = response.json() as { items: Array<Record<string, unknown>> };
    assert.deepEqual(body.items, [
      {
        name: "ccb_claude",
        title: "ccb_claude",
        currentCommand: "python",
        active: true,
        cols: 80,
        rows: 24
      }
    ]);
    assert.equal(JSON.stringify(body).includes(anchor.anchorPath), false);
  } finally {
    await app.close();
  }
});

test("anchor-terminal routes reject non-local requests and destroyed anchors", async () => {
  await resetFixtures();
  const { project, anchor } = await createAnchorFixture({ state: "destroyed" });
  tempDir = await mkdtemp(join(tmpdir(), "anchor-terminal-route-"));
  const app = buildRetiredAnchorTerminalRouteApp({
    recordingStore: new AnchorTerminalRecordingStore(tempDir)
  });

  try {
    const remote = await app.inject({
      method: "GET",
      url: `/api/anchor-terminal/panes?anchorId=${encodeURIComponent(anchor.anchorId)}&projectId=${encodeURIComponent(project.id)}`,
      remoteAddress: "10.0.0.20"
    });
    assert.equal(remote.statusCode, 403);

    const destroyed = await app.inject({
      method: "GET",
      url: `/api/anchor-terminal/panes?anchorId=${encodeURIComponent(anchor.anchorId)}&projectId=${encodeURIComponent(project.id)}`
    });
    assert.equal(destroyed.statusCode, 404);
  } finally {
    await app.close();
  }
});

test("anchor-terminal panes enforce project scope, legacy subject fallback, and orphan fail-closed", async () => {
  await resetFixtures();
  const project = await createProjectFixture();
  const otherProject = await createProjectFixture();
  const crossProjectAnchor = await createAnchorFixture({ project });
  const legacyTask = await prisma.task.create({
    data: {
      projectId: project.id,
      taskKey: `task-${randomUUID()}`,
      title: "Legacy anchor task",
      status: "reviewing",
      updatedAt: new Date()
    }
  });
  const legacyAnchor = await createAnchorFixture({
    project,
    anchorProjectId: null,
    subjectType: "subtask",
    subjectId: legacyTask.id
  });
  const orphanAnchor = await createAnchorFixture({
    project,
    anchorProjectId: null,
    subjectType: "subtask",
    subjectId: "missing-task"
  });
  const listPanes = vi.fn(async () => []);
  tempDir = await mkdtemp(join(tmpdir(), "anchor-terminal-route-"));
  const app = buildRetiredAnchorTerminalRouteApp({
    manager: { listPanes } as unknown as AnchorTerminalManager,
    recordingStore: new AnchorTerminalRecordingStore(tempDir)
  });

  try {
    const cross = await app.inject({
      method: "GET",
      url: `/api/anchor-terminal/panes?anchorId=${encodeURIComponent(crossProjectAnchor.anchor.anchorId)}&projectId=${encodeURIComponent(otherProject.id)}`
    });
    assert.equal(cross.statusCode, 403);

    const legacy = await app.inject({
      method: "GET",
      url: `/api/anchor-terminal/panes?anchorId=${encodeURIComponent(legacyAnchor.anchor.anchorId)}&projectId=${encodeURIComponent(project.id)}`
    });
    assert.equal(legacy.statusCode, 200);

    const orphan = await app.inject({
      method: "GET",
      url: `/api/anchor-terminal/panes?anchorId=${encodeURIComponent(orphanAnchor.anchor.anchorId)}&projectId=${encodeURIComponent(project.id)}`
    });
    assert.equal(orphan.statusCode, 404);
    assert.equal(listPanes.mock.calls.length, 1);
  } finally {
    await app.close();
  }
});

test("anchor-terminal websocket contract parses write lease frames", () => {
  assert.deepEqual(
    evaluateAnchorTerminalClientFrame(JSON.stringify({ type: "in", data: "rm -rf nope" })),
    { type: "input", data: "rm -rf nope" }
  );
  assert.deepEqual(evaluateAnchorTerminalClientFrame(JSON.stringify({ type: "request_write" })), {
    type: "request_write"
  });
  assert.deepEqual(evaluateAnchorTerminalClientFrame(JSON.stringify({ type: "release_write" })), {
    type: "release_write"
  });
  assert.deepEqual(
    evaluateAnchorTerminalClientFrame(JSON.stringify({ type: "resize", cols: 500, rows: 2 })),
    { type: "resize", cols: 300, rows: 10 }
  );
  assert.deepEqual(evaluateAnchorTerminalClientFrame(JSON.stringify({ type: "ping" })), {
    type: "send",
    payload: { type: "pong" }
  });
  assert.deepEqual(evaluateAnchorTerminalClientFrame(JSON.stringify({ type: "close" })), { type: "close" });
});

test("anchor-terminal websocket contract accepts viewport frames without enabling writes", () => {
  assert.deepEqual(
    evaluateAnchorTerminalClientFrame(JSON.stringify({ type: "viewport", cols: 500, rows: 2 })),
    { type: "viewport", cols: 300, rows: 10, active: true }
  );
  assert.deepEqual(
    evaluateAnchorTerminalClientFrame(JSON.stringify({ type: "viewport", cols: 142, rows: 38, active: false })),
    { type: "viewport", cols: 142, rows: 38, active: false }
  );
  assert.deepEqual(evaluateAnchorTerminalClientFrame(JSON.stringify({ type: "viewport", cols: 0, rows: 38 })), {
    type: "ignore"
  });
  assert.deepEqual(evaluateAnchorTerminalClientFrame(JSON.stringify({ type: "write", data: "legacy" })), {
    type: "send",
    payload: {
      type: "error",
      code: "READ_ONLY",
      message: "anchor terminal MVP 仅支持只读 attach"
    }
  });
});

test("anchor-terminal websocket replays the last mirror frame after ready", async () => {
  await resetFixtures();
  const { project } = await createAnchorFixture({ anchorId: "anchor_task_1" });
  const emitter = new EventEmitter();
  const detach = vi.fn();
  const app = buildRetiredAnchorTerminalRouteApp({
    manager: {
      attach: vi.fn(async () => ({
        descriptor: {
          anchorId: "anchor_task_1",
          taskId: "task-1",
          pane: "ccb_claude",
          source: "anchor",
          readonly: true,
          recordingId: "recording-1",
          attachedSocketCount: 1,
          writer: {
            hasWriter: false,
            isYou: false
          }
        },
        snapshot: "",
        bufferTail: "",
        emitter,
        lastFrame: {
          anchorId: "anchor_task_1",
          pane: "ccb_claude",
          data: "cached frame\n",
          cols: 100,
          rows: 30,
          generation: 7
        }
      })),
      detach,
      applyViewport: vi.fn(async () => undefined),
      requestWriterLease: vi.fn(),
      releaseWriterLease: vi.fn(),
      applyInput: vi.fn(async () => undefined),
      applyWriteResize: vi.fn(async () => undefined),
      listPanes: vi.fn()
    } as unknown as AnchorTerminalManager
  });

  try {
    await app.ready();
    let resolveMessages!: (messages: Array<Record<string, unknown>>) => void;
    let rejectMessages!: (error: unknown) => void;
    const messagesPromise = new Promise<Array<Record<string, unknown>>>((resolve, reject) => {
      resolveMessages = resolve;
      rejectMessages = reject;
    });
    const socket = await app.injectWS(
      `/api/anchor-terminal/ws?anchorId=anchor_task_1&pane=ccb_claude&projectId=${encodeURIComponent(project.id)}`,
      {
        socket: { remoteAddress: "127.0.0.1" }
      } as Partial<IncomingMessage>,
      {
        onInit(ws) {
          collectWebSocketMessages(ws, 2).then(resolveMessages, rejectMessages);
        }
      }
    );
    const messages = await messagesPromise;

    assert.deepEqual(messages.map((message) => message.type), ["ready", "frame"]);
    assert.deepEqual(messages[1], {
      type: "frame",
      data: "cached frame\n",
      cols: 100,
      rows: 30,
      generation: 7
    });
    socket.terminate();
  } finally {
    await app.close();
  }
});

test("anchor-terminal websocket rejects cross-project anchor before attach", async () => {
  await resetFixtures();
  const { anchor } = await createAnchorFixture();
  const otherProject = await createProjectFixture();
  const emitter = new EventEmitter();
  const attach = vi.fn(async () => ({
    descriptor: {
      anchorId: anchor.anchorId,
      taskId: "task-1",
      pane: "ccb_claude",
      source: "anchor" as const,
      readonly: true as const,
      recordingId: "recording-1",
      attachedSocketCount: 1,
      writer: {
        hasWriter: false,
        isYou: false
      }
    },
    snapshot: "",
    bufferTail: "",
    emitter,
    lastFrame: null
  }));
  const app = buildRetiredAnchorTerminalRouteApp({
    manager: {
      attach,
      detach: vi.fn(),
      applyViewport: vi.fn(async () => undefined),
      requestWriterLease: vi.fn(),
      releaseWriterLease: vi.fn(),
      applyInput: vi.fn(async () => undefined),
      applyWriteResize: vi.fn(async () => undefined),
      listPanes: vi.fn()
    } as unknown as AnchorTerminalManager
  });

  try {
    await app.ready();
    let resolveMessages!: (messages: Array<Record<string, unknown>>) => void;
    let rejectMessages!: (error: unknown) => void;
    const messagesPromise = new Promise<Array<Record<string, unknown>>>((resolve, reject) => {
      resolveMessages = resolve;
      rejectMessages = reject;
    });
    const socket = await app.injectWS(
      `/api/anchor-terminal/ws?anchorId=${encodeURIComponent(anchor.anchorId)}&pane=ccb_claude&projectId=${encodeURIComponent(otherProject.id)}`,
      {
        socket: { remoteAddress: "127.0.0.1" }
      } as Partial<IncomingMessage>,
      {
        onInit(ws) {
          collectWebSocketMessages(ws, 1).then(resolveMessages, rejectMessages);
        }
      }
    );
    const messages = await messagesPromise;
    assert.equal(messages[0]?.code, "ANCHOR_SCOPE_FORBIDDEN");
    assert.equal(attach.mock.calls.length, 0);
    socket.terminate();
  } finally {
    await app.close();
  }
});

test("anchor-terminal recordings and cast are scoped by project", async () => {
  await resetFixtures();
  const { project, anchor } = await createAnchorFixture();
  const { project: otherProject, anchor: otherAnchor } = await createAnchorFixture();
  tempDir = await mkdtemp(join(tmpdir(), "anchor-terminal-recordings-route-"));
  const recordingStore = new AnchorTerminalRecordingStore(tempDir);
  const session = recordingStore.start({
    anchorId: anchor.anchorId,
    taskId: "task-1",
    pane: "ccb_claude"
  });
  session.writeOutput("project-owned recording\n");
  await session.close();
  const otherSession = recordingStore.start({
    anchorId: otherAnchor.anchorId,
    taskId: "task-2",
    pane: "ccb_codex"
  });
  otherSession.writeOutput("other recording\n");
  await otherSession.close();
  const app = buildRetiredAnchorTerminalRouteApp({
    manager: { listPanes: vi.fn(async () => []) } as unknown as AnchorTerminalManager,
    recordingStore
  });

  try {
    const list = await app.inject({
      method: "GET",
      url: `/api/anchor-terminal/recordings?projectId=${encodeURIComponent(project.id)}`
    });
    assert.equal(list.statusCode, 200);
    const listBody = list.json() as { items: Array<{ anchorId: string }> };
    assert.deepEqual(listBody.items.map((item) => item.anchorId), [anchor.anchorId]);

    const crossList = await app.inject({
      method: "GET",
      url: `/api/anchor-terminal/recordings?projectId=${encodeURIComponent(otherProject.id)}&anchorId=${encodeURIComponent(anchor.anchorId)}`
    });
    assert.equal(crossList.statusCode, 403);

    const cast = await app.inject({
      method: "GET",
      url: `/api/anchor-terminal/recordings/${encodeURIComponent(session.meta.id)}/cast?projectId=${encodeURIComponent(project.id)}`
    });
    assert.equal(cast.statusCode, 200);
    assert.match((cast.json() as { cast: string }).cast, /project-owned recording/);

    const crossCast = await app.inject({
      method: "GET",
      url: `/api/anchor-terminal/recordings/${encodeURIComponent(session.meta.id)}/cast?projectId=${encodeURIComponent(otherProject.id)}`
    });
    assert.equal(crossCast.statusCode, 403);
  } finally {
    await app.close();
  }
});

function collectWebSocketMessages(
  socket: { on: (event: "message" | "error", handler: (...args: unknown[]) => void) => void },
  count: number
): Promise<Array<Record<string, unknown>>> {
  return new Promise((resolve, reject) => {
    const messages: Array<Record<string, unknown>> = [];
    const timeout = setTimeout(() => {
      reject(new Error(`timed out waiting for ${count} websocket messages`));
    }, 2_000);
    socket.on("message", (data) => {
      messages.push(JSON.parse(String(data)) as Record<string, unknown>);
      if (messages.length === count) {
        clearTimeout(timeout);
        resolve(messages);
      }
    });
    socket.on("error", () => {
      clearTimeout(timeout);
      reject(new Error("websocket error"));
    });
  });
}
