import { existsSync } from "node:fs";
import { release as osRelease } from "node:os";
import { join, resolve } from "node:path";

import type { PrismaClient } from "@prisma/client";
import chokidar, { type FSWatcher } from "chokidar";

import { startProjectScan } from "../indexer/project-indexer.js";

export const DEFAULT_FILE_WATCHER_DEBOUNCE_MS = 500;
export const DEFAULT_FILE_WATCHER_POLL_INTERVAL_MS = 1000;

type FileWatchEventName = "add" | "change" | "unlink";
export interface EnsureProjectWatcherOptions {
  backfill?: boolean;
}

export interface FileWatcherLifecycle {
  start: () => Promise<void>;
  stop: () => Promise<void>;
  ensureProjectWatcher?: (projectId: string, options?: EnsureProjectWatcherOptions) => Promise<void>;
}

interface WatchLogger {
  info: (message: string) => void;
  warn: (message: string) => void;
  error: (message: string) => void;
}

interface DebouncedPathQueueOptions<T> {
  debounceMs: number;
  handler: (item: T) => Promise<void>;
  onError?: (error: unknown) => void;
}

export class DebouncedPathQueue<T> {
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly latestItems = new Map<string, T>();
  private readonly runningTasks = new Set<Promise<void>>();

  public constructor(private readonly options: DebouncedPathQueueOptions<T>) {}

  public enqueue(key: string, item: T): void {
    const existingTimer = this.timers.get(key);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    this.latestItems.set(key, item);
    const timer = setTimeout(() => {
      this.timers.delete(key);
      const latestItem = this.latestItems.get(key);
      this.latestItems.delete(key);
      if (!latestItem) {
        return;
      }

      const task = this.options.handler(latestItem).catch((error: unknown) => {
        this.options.onError?.(error);
      });
      this.runningTasks.add(task);
      void task.finally(() => {
        this.runningTasks.delete(task);
      });
    }, this.options.debounceMs);

    this.timers.set(key, timer);
  }

  public async dispose(): Promise<void> {
    for (const timer of this.timers.values()) {
      clearTimeout(timer);
    }
    this.timers.clear();
    this.latestItems.clear();
    await Promise.allSettled(Array.from(this.runningTasks));
  }
}

interface FileWatcherServiceOptions {
  prisma: PrismaClient;
  logger?: WatchLogger;
  debounceMs?: number;
  scanProject?: (prisma: PrismaClient, projectId: string) => Promise<unknown>;
  watchFactory?: typeof chokidar.watch;
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  osRelease?: string;
}

interface QueuedFileEvent {
  projectId: string;
  eventName: FileWatchEventName;
  filePath: string;
}

export class FileWatcherService implements FileWatcherLifecycle {
  private readonly watchers = new Map<string, FSWatcher>();
  private readonly registeringWatchers = new Map<string, Promise<void>>();
  private readonly queue: DebouncedPathQueue<QueuedFileEvent>;
  private readonly scanProject: (prisma: PrismaClient, projectId: string) => Promise<unknown>;
  private readonly watchFactory: typeof chokidar.watch;
  private readonly watchOptions: ReturnType<typeof buildWatchOptions>;
  private started = false;

  public constructor(private readonly options: FileWatcherServiceOptions) {
    this.scanProject = options.scanProject ?? startProjectScan;
    this.watchFactory = options.watchFactory ?? chokidar.watch;
    this.watchOptions = buildWatchOptions({
      env: options.env,
      platform: options.platform,
      osRelease: options.osRelease
    });
    this.queue = new DebouncedPathQueue<QueuedFileEvent>({
      debounceMs: options.debounceMs ?? DEFAULT_FILE_WATCHER_DEBOUNCE_MS,
      handler: async (event) => {
        await this.processFileEvent(event);
      },
      onError: (error) => {
        this.logError("文件监听增量更新失败", error);
      }
    });
  }

  public async start(): Promise<void> {
    this.started = true;
    await this.ensureAllProjectWatchers();
  }

  public async ensureAllProjectWatchers(): Promise<void> {
    const projects = await this.options.prisma.project.findMany({
      select: {
        id: true
      }
    });

    for (const project of projects) {
      await this.ensureProjectWatcher(project.id, { backfill: false });
    }
  }

  public async ensureProjectWatcher(projectId: string, options: EnsureProjectWatcherOptions = {}): Promise<void> {
    if (this.watchers.has(projectId)) {
      return;
    }

    const registering = this.registeringWatchers.get(projectId);
    if (registering) {
      await registering;
      return;
    }

    const task = this.registerProjectWatcher(projectId, { backfill: options.backfill ?? true });
    this.registeringWatchers.set(projectId, task);
    try {
      await task;
    } finally {
      this.registeringWatchers.delete(projectId);
    }
  }

  public hasProjectWatcher(projectId: string): boolean {
    return this.watchers.has(projectId);
  }

  public getWatchedProjectIds(): string[] {
    return [...this.watchers.keys()].sort();
  }

  public queueProjectFileEvent(projectId: string, eventName: FileWatchEventName, filePath: string): void {
    if (!isIndexerWatchedPath(filePath)) {
      return;
    }

    const normalizedPath = resolve(filePath);
    this.queue.enqueue(`${projectId}:${normalizedPath}`, {
      projectId,
      eventName,
      filePath: normalizedPath
    });
  }

  public async stop(): Promise<void> {
    await Promise.allSettled(this.registeringWatchers.values());
    this.registeringWatchers.clear();
    const closingWatchers = Array.from(this.watchers.values()).map((watcher) => watcher.close());
    this.watchers.clear();
    await Promise.allSettled(closingWatchers);
    await this.queue.dispose();
    this.started = false;
  }

  private async registerProjectWatcher(projectId: string, options: Required<EnsureProjectWatcherOptions>): Promise<void> {
    const project = await this.options.prisma.project.findUnique({
      where: {
        id: projectId
      },
      select: {
        id: true,
        name: true,
        localPath: true
      }
    });
    if (!project) {
      this.options.logger?.warn(`文件监听跳过项目：${projectId}，项目不存在`);
      return;
    }

    const docsRoot = join(project.localPath, "docs");
    if (!existsSync(docsRoot)) {
      this.options.logger?.warn(`文件监听跳过项目：${project.name}，未找到 docs 目录`);
      return;
    }

    const watcher = this.watchFactory(docsRoot, this.watchOptions);
    for (const eventName of ["add", "change", "unlink"] as const) {
      watcher.on(eventName, (filePath) => {
        this.queueProjectFileEvent(project.id, eventName, filePath);
      });
    }

    watcher.on("ready", () => {
      this.options.logger?.info(`文件监听已启动：${project.name} -> ${docsRoot}`);
    });
    watcher.on("error", (error) => {
      this.logError(`文件监听异常：${project.name}`, error);
    });

    this.watchers.set(project.id, watcher);
    if (options.backfill) {
      await this.backfillProject(project.id);
    }
  }

  private async backfillProject(projectId: string): Promise<void> {
    try {
      await this.scanProject(this.options.prisma, projectId);
      this.options.logger?.info(`文件监听注册后已提交项目补扫：${projectId}`);
    } catch (error) {
      this.logError(`文件监听注册后补扫失败：${projectId}`, error);
    }
  }

  private async processFileEvent(event: QueuedFileEvent): Promise<void> {
    await this.scanProject(this.options.prisma, event.projectId);
    this.options.logger?.info(`文件变更已触发项目扫描：${event.filePath}`);
  }

  private logError(message: string, error: unknown): void {
    const detail = error instanceof Error ? error.message : String(error);
    this.options.logger?.error(`${message}：${detail}`);
  }
}

export function isFileWatcherEnabled(value: string | undefined): boolean {
  return !["0", "false", "no", "off"].includes(value?.trim().toLowerCase() ?? "");
}

export function buildWatchOptions(input: {
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  osRelease?: string;
} = {}) {
  const polling = resolveFileWatcherPolling(input);
  return {
    ignoreInitial: true,
    persistent: true,
    awaitWriteFinish: {
      stabilityThreshold: 100,
      pollInterval: 50
    },
    ignored: isIndexerIgnoredWatchPath,
    ignorePermissionErrors: true,
    usePolling: polling.usePolling,
    interval: polling.interval
  };
}

export function resolveFileWatcherPolling(input: {
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  osRelease?: string;
} = {}): { usePolling: boolean; interval: number } {
  const env = input.env ?? process.env;
  const platform = input.platform ?? process.platform;
  const release = input.osRelease ?? osRelease();
  const explicit = env.CCB_INDEXER_WATCH_POLLING?.trim().toLowerCase();
  const usePolling =
    explicit === undefined || explicit.length === 0
      ? isWsl(platform, release)
      : ["1", "true", "yes", "on"].includes(explicit);
  const configuredInterval = Number.parseInt(env.CCB_INDEXER_WATCH_POLL_INTERVAL_MS ?? "", 10);
  const interval = Number.isFinite(configuredInterval) && configuredInterval >= 250
    ? configuredInterval
    : DEFAULT_FILE_WATCHER_POLL_INTERVAL_MS;
  return { usePolling, interval };
}

function isWsl(platform: NodeJS.Platform, release: string): boolean {
  return platform === "linux" && /microsoft|wsl/i.test(release);
}

function isMarkdownPath(filePath: string): boolean {
  return filePath.toLowerCase().endsWith(".md");
}

export function isIndexerWatchedPath(filePath: string): boolean {
  return !isIndexerIgnoredWatchPath(filePath) && (isMarkdownPath(filePath) || isBreakdownDraftJsonPath(filePath));
}

function isBreakdownDraftJsonPath(filePath: string): boolean {
  const normalized = filePath.replace(/\\/g, "/").toLowerCase();
  return normalized.includes("/docs/.ccb/drafts/breakdown/") && normalized.endsWith(".json");
}

export function isIndexerIgnoredWatchPath(filePath: string): boolean {
  const normalized = filePath.replace(/\\/g, "/").toLowerCase().replace(/\/+$/, "");
  if (normalized === "00_文档地图.md" || normalized.endsWith("/docs/00_文档地图.md")) {
    return true;
  }
  return (
    isPathAtOrBelowDocsSubpath(normalized, ".ccb/index") ||
    isPathAtOrBelowDocsSubpath(normalized, ".ccb/locks")
  );
}

function isPathAtOrBelowDocsSubpath(normalizedPath: string, subpath: string): boolean {
  return (
    normalizedPath === subpath ||
    normalizedPath.startsWith(`${subpath}/`) ||
    normalizedPath.endsWith(`/docs/${subpath}`) ||
    normalizedPath.includes(`/docs/${subpath}/`)
  );
}
