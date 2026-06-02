import { readdir, readFile, stat } from "node:fs/promises";
import net from "node:net";
import { join } from "node:path";

export interface CcbdReadinessDiagnostics {
  socketPath: string | null;
  lastErrorCode: string | null;
  snapshots: Record<string, unknown>;
  logTails: Record<string, string>;
  tmuxSessions?: string | null;
}

export interface CcbdReadyResult {
  socketPath: string;
  attempts: number;
  diagnostics: CcbdReadinessDiagnostics;
}

export class CcbdReadinessTimeoutError extends Error {
  constructor(
    message: string,
    public readonly diagnostics: CcbdReadinessDiagnostics
  ) {
    super(message);
    this.name = "CcbdReadinessTimeoutError";
  }
}

interface StatLike {
  isSocket(): boolean;
}

interface CcbdReadinessProbeOptions {
  readTextFile?: (path: string) => Promise<string>;
  statPath?: (path: string) => Promise<StatLike>;
  connectSocket?: (path: string, timeoutMs: number) => Promise<void>;
  readDir?: (path: string) => Promise<string[]>;
  listTmuxSessions?: (anchorPath: string) => Promise<string>;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

export interface WaitForCcbdReadyOptions {
  timeoutMs?: number;
  connectTimeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = Number(process.env.CCB_ANCHOR_CCBD_READY_TIMEOUT_MS ?? 30_000);
const DEFAULT_CONNECT_TIMEOUT_MS = 750;
const FAST_POLL_WINDOW_MS = 2_000;
const FAST_POLL_INTERVAL_MS = 250;
const SLOW_POLL_INTERVAL_MS = 500;
const SNAPSHOT_FILES = ["lifecycle.json", "lease.json", "startup-report.json", "keeper.json"] as const;
const MAX_TAIL_LINES = 100;

export class CcbdReadinessProbe {
  private readonly readTextFile: (path: string) => Promise<string>;
  private readonly statPath: (path: string) => Promise<StatLike>;
  private readonly connectSocket: (path: string, timeoutMs: number) => Promise<void>;
  private readonly readDir: (path: string) => Promise<string[]>;
  private readonly listTmuxSessions?: (anchorPath: string) => Promise<string>;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly now: () => number;

  constructor(options: CcbdReadinessProbeOptions = {}) {
    this.readTextFile = options.readTextFile ?? (async (path) => await readFile(path, "utf8"));
    this.statPath = options.statPath ?? (async (path) => await stat(path));
    this.connectSocket = options.connectSocket ?? connectUnixSocket;
    this.readDir = options.readDir ?? (async (path) => await readdir(path));
    this.listTmuxSessions = options.listTmuxSessions;
    this.sleep = options.sleep ?? (async (ms) => await new Promise((resolve) => setTimeout(resolve, ms)));
    this.now = options.now ?? (() => Date.now());
  }

  async waitForReady(anchorPath: string, options: WaitForCcbdReadyOptions = {}): Promise<CcbdReadyResult> {
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const connectTimeoutMs = options.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS;
    const startedAt = this.now();
    let attempts = 0;
    let socketPath: string | null = null;
    let lastErrorCode: string | null = null;

    while (this.now() - startedAt <= timeoutMs) {
      attempts += 1;
      socketPath = await this.resolveSocketPath(anchorPath);
      try {
        const socketStat = await this.statPath(socketPath);
        if (!socketStat.isSocket()) {
          lastErrorCode = "NOT_SOCKET";
        } else {
          await this.connectSocket(socketPath, connectTimeoutMs);
          return {
            socketPath,
            attempts,
            diagnostics: {
              socketPath,
              lastErrorCode: null,
              snapshots: {},
              logTails: {}
            }
          };
        }
      } catch (error) {
        lastErrorCode = readErrorCode(error);
      }

      const elapsedMs = this.now() - startedAt;
      if (elapsedMs >= timeoutMs) {
        break;
      }
      const intervalMs = elapsedMs < FAST_POLL_WINDOW_MS ? FAST_POLL_INTERVAL_MS : SLOW_POLL_INTERVAL_MS;
      await this.sleep(Math.min(intervalMs, timeoutMs - elapsedMs));
    }

    const diagnostics = await this.collectDiagnostics(anchorPath, socketPath, lastErrorCode);
    throw new CcbdReadinessTimeoutError(buildTimeoutMessage(timeoutMs, diagnostics), diagnostics);
  }

  private async resolveSocketPath(anchorPath: string): Promise<string> {
    const ccbdDir = buildCcbdDir(anchorPath);
    for (const filename of SNAPSHOT_FILES) {
      const payload = await readJsonObject(this.readTextFile, join(ccbdDir, filename));
      const socketPath = readSocketPathFromPayload(payload);
      if (socketPath) {
        return socketPath;
      }
    }
    return join(ccbdDir, "ccbd.sock");
  }

  private async collectDiagnostics(
    anchorPath: string,
    socketPath: string | null,
    lastErrorCode: string | null
  ): Promise<CcbdReadinessDiagnostics> {
    const ccbdDir = buildCcbdDir(anchorPath);
    const snapshots: Record<string, unknown> = {};
    for (const filename of SNAPSHOT_FILES) {
      snapshots[filename] = await readDiagnosticFile(this.readTextFile, join(ccbdDir, filename));
    }

    const logTails = await this.collectLogTails(ccbdDir);
    const tmuxSessions = this.listTmuxSessions
      ? await this.listTmuxSessions(anchorPath).catch((error) => `error: ${readErrorMessage(error)}`)
      : undefined;

    return {
      socketPath,
      lastErrorCode,
      snapshots,
      logTails,
      ...(tmuxSessions === undefined ? {} : { tmuxSessions })
    };
  }

  private async collectLogTails(ccbdDir: string): Promise<Record<string, string>> {
    const logTails: Record<string, string> = {};
    const entries = await this.readDir(ccbdDir).catch(() => []);
    for (const entry of entries) {
      if (!entry.endsWith(".log") && !entry.endsWith(".jsonl")) {
        continue;
      }
      const content = await this.readTextFile(join(ccbdDir, entry)).catch(() => "");
      if (content) {
        logTails[entry] = tailLines(content, MAX_TAIL_LINES);
      }
    }
    return logTails;
  }
}

export function buildCcbdDir(anchorPath: string): string {
  return join(anchorPath, ".ccb", "ccbd");
}

async function connectUnixSocket(socketPath: string, timeoutMs: number): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const socket = net.createConnection({ path: socketPath }, () => settle(null));
    socket.setTimeout(timeoutMs);
    socket.on("timeout", () => settle(Object.assign(new Error("socket connect timeout"), { code: "ETIMEDOUT" })));
    socket.on("error", (error) => settle(error));

    function settle(error: Error | null): void {
      if (settled) {
        return;
      }
      settled = true;
      socket.destroy();
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    }
  });
}

async function readJsonObject(
  readTextFile: (path: string) => Promise<string>,
  path: string
): Promise<Record<string, unknown> | null> {
  const content = await readTextFile(path).catch(() => null);
  if (!content) {
    return null;
  }
  try {
    const parsed = JSON.parse(content) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

async function readDiagnosticFile(
  readTextFile: (path: string) => Promise<string>,
  path: string
): Promise<unknown> {
  const content = await readTextFile(path).catch((error) => `missing: ${readErrorCode(error)}`);
  try {
    return JSON.parse(content) as unknown;
  } catch {
    return content.length > 4_000 ? `${content.slice(0, 4_000)}...<truncated>` : content;
  }
}

function readSocketPathFromPayload(payload: Record<string, unknown> | null): string | null {
  if (!payload) {
    return null;
  }
  const direct = normalizeString(payload.socket_path);
  if (direct) {
    return direct;
  }
  const inspection = objectField(payload.inspection);
  const lease = objectField(inspection?.lease);
  const leaseSocket = normalizeString(lease?.socket_path);
  if (leaseSocket) {
    return leaseSocket;
  }
  const placement = objectField(payload.socket_placement);
  return normalizeString(placement?.effective_socket_path);
}

function objectField(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function normalizeString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function buildTimeoutMessage(timeoutMs: number, diagnostics: CcbdReadinessDiagnostics): string {
  const lifecycle = objectField(diagnostics.snapshots["lifecycle.json"]);
  const details = [
    `ccbd readiness timeout after ${timeoutMs}ms`,
    `socketPath=${diagnostics.socketPath ?? "unknown"}`,
    `desired_state=${String(lifecycle?.desired_state ?? "unknown")}`,
    `owner_pid=${String(lifecycle?.owner_pid ?? "unknown")}`,
    `keeper_pid=${String(lifecycle?.keeper_pid ?? "unknown")}`,
    `last_error=${diagnostics.lastErrorCode ?? "none"}`
  ];
  return details.join("; ");
}

function readErrorCode(error: unknown): string {
  if (error && typeof error === "object" && "code" in error) {
    return String((error as { code?: unknown }).code ?? "ERROR");
  }
  return error instanceof Error ? error.message : "ERROR";
}

function readErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function tailLines(content: string, maxLines: number): string {
  const lines = content.split(/\r?\n/);
  return lines.slice(Math.max(lines.length - maxLines, 0)).join("\n");
}
