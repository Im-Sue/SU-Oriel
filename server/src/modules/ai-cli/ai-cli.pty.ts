import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";

import * as nodePty from "node-pty";
import type { IPty } from "node-pty";

import { AI_CLI_ERROR_CODES, AiCliError } from "./ai-cli.errors.js";
import type { ExecutorProfileRef } from "./ai-cli.external.js";
import type { CastWriter, RecordingMeta, RecordingStore } from "./ai-cli.recording.js";
import type { AiCliToolId } from "./ai-cli.types.js";

const DEFAULT_COLS = 100;
const DEFAULT_ROWS = 30;
const IDLE_TIMEOUT_MS = 30 * 60 * 1000;
const ORPHAN_GRACE_MS = 60 * 1000;

export interface PtySessionDescriptor {
  id: string;
  toolId: AiCliToolId;
  command: string;
  args: string[];
  cwd: string;
  cols: number;
  rows: number;
  projectId: string | null;
  createdAt: string;
  lastActiveAt: string;
  status: "starting" | "running" | "exited";
  exitCode: number | null;
  exitSignal: string | null;
  recordingId: string | null;
  attachedSocketCount: number;
}

export interface PtySessionEvents {
  output: { sessionId: string; data: string };
  exit: { sessionId: string; code: number; signal: string | null };
}

interface InternalSession {
  id: string;
  toolId: AiCliToolId;
  command: string;
  args: string[];
  cwd: string;
  cols: number;
  rows: number;
  projectId: string | null;
  createdAt: number;
  lastActiveAt: number;
  status: "starting" | "running" | "exited";
  exitCode: number | null;
  exitSignal: string | null;
  proc: IPty;
  sockets: Set<unknown>;
  emitter: EventEmitter;
  bufferTail: string;
  bufferTailMax: number;
  recording: { writer: CastWriter; meta: RecordingMeta } | null;
  orphanTimer: NodeJS.Timeout | null;
  idleCheckTimer: NodeJS.Timeout | null;
}

export interface CreateSessionInput {
  toolId: AiCliToolId;
  command: string;
  args: string[];
  cwd: string;
  projectId: string | null;
  cols?: number;
  rows?: number;
  shellWrap: boolean;
  recordingStore: RecordingStore | null;
  profileId?: string | null;
  profile?: ExecutorProfileRef | null;
}

/**
 * PtyManager —— 嵌入式终端会话管理。
 *
 * 设计要点：
 * - sessionId 是 UUID，前端拿到后用它去 attach WS。
 * - 同一会话允许多个 socket 订阅（页面刷新可重连）。
 * - 服务端维护一个滚动 buffer（默认 64KB）让 attach 时能补一段历史。
 * - 客户端全部断开后，给 60s 宽限期等重连，超时杀进程。
 * - 30 分钟无 IO 视为 idle，主动关闭，避免遗留进程占用。
 * - 进程退出广播 exit，并清理资源。
 *
 * 跨平台：Windows 默认 conpty + cmd.exe；*nix 用用户登录 shell（环境变量 SHELL）。
 */
export class PtyManager {
  private readonly sessions = new Map<string, InternalSession>();
  private readonly maxConcurrent: number;
  public constructor(options: { maxConcurrent?: number } = {}) {
    this.maxConcurrent = options.maxConcurrent ?? 8;
  }

  public list(): PtySessionDescriptor[] {
    return [...this.sessions.values()].map(toDescriptor);
  }

  public get(sessionId: string): PtySessionDescriptor | null {
    const session = this.sessions.get(sessionId);
    return session ? toDescriptor(session) : null;
  }

  public create(input: CreateSessionInput): PtySessionDescriptor {
    const liveSessions = [...this.sessions.values()].filter((session) => session.status !== "exited");
    if (liveSessions.length >= this.maxConcurrent) {
      throw new AiCliError(
        AI_CLI_ERROR_CODES.SESSION_LIMIT,
        `已达到最大并发会话数（${this.maxConcurrent}），请先关闭其他会话`,
        429
      );
    }

    const cols = clampDim(input.cols ?? DEFAULT_COLS, 20, 500);
    const rows = clampDim(input.rows ?? DEFAULT_ROWS, 5, 200);
    const launchInput = resolvePtyProfileLaunchInput(input);

    const { shellPath, shellArgs, autoTypeCommand } = resolveShell(launchInput);
    let proc: IPty;
    try {
      proc = nodePty.spawn(shellPath, shellArgs, {
        name: "xterm-256color",
        cols,
        rows,
        cwd: input.cwd,
        env: buildSpawnEnv()
      });
    } catch (error) {
      throw new AiCliError(
        AI_CLI_ERROR_CODES.PTY_SPAWN_FAILED,
        error instanceof Error ? error.message : "PTY 子进程创建失败",
        500
      );
    }

    const id = randomUUID();
    const now = Date.now();
    const emitter = new EventEmitter();
    const session: InternalSession = {
      id,
      toolId: input.toolId,
      command: launchInput.command,
      args: launchInput.args,
      cwd: input.cwd,
      cols,
      rows,
      projectId: input.projectId,
      createdAt: now,
      lastActiveAt: now,
      status: "starting",
      exitCode: null,
      exitSignal: null,
      proc,
      sockets: new Set(),
      emitter,
      bufferTail: "",
      bufferTailMax: 64 * 1024,
      recording: null,
      orphanTimer: null,
      idleCheckTimer: null
    };

    if (input.recordingStore) {
      session.recording = input.recordingStore.newWriter({
        sessionId: id,
        toolId: input.toolId,
        projectId: input.projectId,
        cwd: input.cwd,
        cols,
        rows,
        title: `${input.toolId} @ ${input.cwd}`
      });
    }

    proc.onData((chunk) => {
      session.lastActiveAt = Date.now();
      session.status = "running";
      appendToTail(session, chunk);
      emitter.emit("output", { sessionId: id, data: chunk });
      session.recording?.writer.writeOutput(chunk);
    });

    proc.onExit(({ exitCode, signal }) => {
      session.status = "exited";
      session.exitCode = exitCode;
      session.exitSignal = signal !== undefined ? String(signal) : null;
      emitter.emit("exit", { sessionId: id, code: exitCode, signal: session.exitSignal });
      this.cleanup(session);
    });

    if (autoTypeCommand) {
      // 包 shell 模式：先把用户期望的 AI CLI 命令写入 stdin。
      // 加 200ms 等 shell 输出 prompt 完毕，避免被覆盖。
      setTimeout(() => {
        if (session.status !== "exited") {
          proc.write(`${autoTypeCommand}\r`);
        }
      }, 200);
    }

    session.idleCheckTimer = setInterval(() => this.idleCheck(session), 60 * 1000);

    this.sessions.set(id, session);
    return toDescriptor(session);
  }

  public attach(sessionId: string, socket: unknown): {
    descriptor: PtySessionDescriptor;
    bufferTail: string;
    emitter: EventEmitter;
  } {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new AiCliError(AI_CLI_ERROR_CODES.SESSION_NOT_FOUND, "会话不存在或已结束", 404);
    }
    session.sockets.add(socket);
    if (session.orphanTimer) {
      clearTimeout(session.orphanTimer);
      session.orphanTimer = null;
    }
    return { descriptor: toDescriptor(session), bufferTail: session.bufferTail, emitter: session.emitter };
  }

  public detach(sessionId: string, socket: unknown): void {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return;
    }
    session.sockets.delete(socket);
    if (session.sockets.size === 0 && session.status !== "exited") {
      // 客户端全部断开后给 60s 宽限期等重连，超时则关闭进程
      session.orphanTimer = setTimeout(() => {
        this.kill(sessionId, "ORPHAN_TIMEOUT");
      }, ORPHAN_GRACE_MS);
    }
  }

  public write(sessionId: string, data: string): void {
    const session = this.sessions.get(sessionId);
    if (!session || session.status === "exited") {
      return;
    }
    session.lastActiveAt = Date.now();
    session.recording?.writer.writeInput(data);
    session.proc.write(data);
  }

  public resize(sessionId: string, cols: number, rows: number): void {
    const session = this.sessions.get(sessionId);
    if (!session || session.status === "exited") {
      return;
    }
    const c = clampDim(cols, 20, 500);
    const r = clampDim(rows, 5, 200);
    session.cols = c;
    session.rows = r;
    try {
      session.proc.resize(c, r);
    } catch {
      // resize 失败常见于进程已退出，忽略
    }
  }

  public kill(sessionId: string, _reason = "USER_CLOSE"): void {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return;
    }
    if (session.status === "exited") {
      this.cleanup(session);
      return;
    }
    try {
      session.proc.kill();
    } catch {
      // 已经死了
    }
  }

  public killAll(): void {
    for (const session of this.sessions.values()) {
      this.kill(session.id, "SHUTDOWN");
    }
  }

  private idleCheck(session: InternalSession): void {
    if (session.status === "exited") {
      return;
    }
    if (Date.now() - session.lastActiveAt > IDLE_TIMEOUT_MS) {
      this.kill(session.id, "IDLE_TIMEOUT");
    }
  }

  private cleanup(session: InternalSession): void {
    if (session.idleCheckTimer) {
      clearInterval(session.idleCheckTimer);
      session.idleCheckTimer = null;
    }
    if (session.orphanTimer) {
      clearTimeout(session.orphanTimer);
      session.orphanTimer = null;
    }
    if (session.recording) {
      try {
        session.recording.writer.close();
        session.recording.meta.cols = session.cols;
        session.recording.meta.rows = session.rows;
        // RecordingStore 不在 PtyManager 持引用，meta 落盘交给写入端，但 close 后的 size
        // 保存还原由 writer 内部计算。
      } catch {
        // 忽略关闭错误
      }
    }
    // 保留 5 分钟描述符，便于前端查询历史；之后再丢
    setTimeout(() => {
      this.sessions.delete(session.id);
    }, 5 * 60 * 1000);
  }
}

function appendToTail(session: InternalSession, chunk: string): void {
  const next = session.bufferTail + chunk;
  if (next.length <= session.bufferTailMax) {
    session.bufferTail = next;
    return;
  }
  session.bufferTail = next.slice(next.length - session.bufferTailMax);
}

function toDescriptor(session: InternalSession): PtySessionDescriptor {
  return {
    id: session.id,
    toolId: session.toolId,
    command: session.command,
    args: session.args,
    cwd: session.cwd,
    cols: session.cols,
    rows: session.rows,
    projectId: session.projectId,
    createdAt: new Date(session.createdAt).toISOString(),
    lastActiveAt: new Date(session.lastActiveAt).toISOString(),
    status: session.status,
    exitCode: session.exitCode,
    exitSignal: session.exitSignal,
    recordingId: session.recording ? session.recording.meta.id : null,
    attachedSocketCount: session.sockets.size
  };
}

function resolvePtyProfileLaunchInput(input: CreateSessionInput): CreateSessionInput {
  if (!input.profile) {
    if (input.profileId) {
      throw new AiCliError(AI_CLI_ERROR_CODES.TOOL_NOT_FOUND, `profile_id not found: ${input.profileId}`, 400);
    }
    return input;
  }

  assertValidExecutorProfile(input.profile, "pty");
  return {
    ...input,
    command: input.profile.provider,
    args: ["--model", input.profile.model, ...input.args]
  };
}

function assertValidExecutorProfile(profile: ExecutorProfileRef, expectedRuntime: ExecutorProfileRef["runtime"]): void {
  if (!profile.profileId || !profile.provider || !profile.model || !profile.runtime) {
    throw new AiCliError(AI_CLI_ERROR_CODES.TOOL_NOT_FOUND, "ExecutorProfile 缺少 profileId/provider/model/runtime", 400);
  }
  if (profile.runtime !== expectedRuntime) {
    throw new AiCliError(
      AI_CLI_ERROR_CODES.TOOL_NOT_FOUND,
      `ExecutorProfile runtime=${profile.runtime} 不能用于 ${expectedRuntime} adapter`,
      400
    );
  }
}

function resolveShell(input: CreateSessionInput): { shellPath: string; shellArgs: string[]; autoTypeCommand: string | null } {
  if (process.platform === "win32") {
    if (input.shellWrap) {
      return {
        shellPath: process.env.COMSPEC ?? "cmd.exe",
        shellArgs: [],
        autoTypeCommand: composeCommandLineForCmd(input.command, input.args)
      };
    }
    return {
      shellPath: input.command,
      shellArgs: input.args,
      autoTypeCommand: null
    };
  }

  const shell = process.env.SHELL ?? "/bin/bash";
  if (input.shellWrap) {
    return {
      shellPath: shell,
      shellArgs: ["-l"],
      autoTypeCommand: composeCommandLineForPosix(input.command, input.args)
    };
  }
  return {
    shellPath: input.command,
    shellArgs: input.args,
    autoTypeCommand: null
  };
}

function composeCommandLineForCmd(command: string, args: string[]): string {
  const quote = (value: string): string => (/[\s"^&|<>]/.test(value) ? `"${value.replace(/"/g, '\\"')}"` : value);
  return [quote(command), ...args.map(quote)].join(" ");
}

function composeCommandLineForPosix(command: string, args: string[]): string {
  const quote = (value: string): string => `'${value.replace(/'/g, "'\\''")}'`;
  return [quote(command), ...args.map(quote)].join(" ");
}

function clampDim(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.max(min, Math.min(max, Math.floor(value)));
}

function buildSpawnEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value === "string") {
      env[key] = value;
    }
  }
  // 确保 TERM 是 256 色，避免某些 TUI 退化为黑白
  env.TERM = "xterm-256color";
  env.COLORTERM = "truecolor";
  return env;
}

export const sharedPtyManager = new PtyManager();
