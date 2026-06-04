import { execFile, spawn, type ChildProcess } from "node:child_process";
import { mkdir, readFile, readlink, unlink } from "node:fs/promises";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

import {
  buildCcbdDir,
  CcbdReadinessProbe,
  type CcbdReadyResult
} from "./ccbd-readiness.service.js";

const execFileAsync = promisify(execFile);
const LAUNCH_SESSION_NAME = "ccb-anchor-launch";

export type CcbdLaunchResult = {
  pid: number | null;
  socketPath: string;
  launchSocketPath?: string;
  launchSessionName?: string;
};

export type CcbdCommandResult = {
  stdout: string;
  stderr: string;
};

type SpawnProcess = (
  command: string,
  args: string[],
  options: { detached: true; stdio: "ignore" }
) => Pick<ChildProcess, "pid" | "unref">;

type ExecFileProcess = (command: string, args: string[]) => Promise<CcbdCommandResult>;

type EnsureDirectory = (path: string) => Promise<void>;
type ReadTextFile = (path: string) => Promise<string>;
type ReadLinkPath = (path: string) => Promise<string>;
type KillPid = (pid: number, signal: NodeJS.Signals) => void;
type ReadinessProbe = Pick<CcbdReadinessProbe, "waitForReady">;

export type CcbdLauncherOptions = {
  ccbCommand?: string;
  tmuxCommand?: string;
  spawnProcess?: SpawnProcess;
  execFileProcess?: ExecFileProcess;
  readinessProbe?: ReadinessProbe;
  readinessTimeoutMs?: number;
  ensureDirectory?: EnsureDirectory;
  readTextFile?: ReadTextFile;
  readLinkPath?: ReadLinkPath;
  killPid?: KillPid;
};

export interface LifecyclePidCleanupResult {
  killed: number[];
  skipped: Array<{ pid: number; reason: string }>;
}

export class CcbdLauncherService {
  private readonly ccbCommand: string;
  private readonly tmuxCommand: string;
  private readonly spawnProcess: SpawnProcess;
  private readonly execFileProcess: ExecFileProcess;
  private readonly readinessProbe: ReadinessProbe;
  private readonly readinessTimeoutMs?: number;
  private readonly ensureDirectory: EnsureDirectory;
  private readonly readTextFile: ReadTextFile;
  private readonly readLinkPath: ReadLinkPath;
  private readonly killPid: KillPid;

  constructor(options: CcbdLauncherOptions = {}) {
    this.ccbCommand = options.ccbCommand ?? "ccb";
    this.tmuxCommand = options.tmuxCommand ?? "tmux";
    this.spawnProcess = options.spawnProcess ?? ((command, args, opts) => spawn(command, args, opts));
    this.execFileProcess = options.execFileProcess ?? (async (command, args) => await execFileAsync(command, args));
    this.readinessProbe =
      options.readinessProbe ??
      new CcbdReadinessProbe({
        listTmuxSessions: async (anchorPath) => {
          const { stdout, stderr } = await this.execFileProcess(this.tmuxCommand, [
            "-S",
            buildLaunchSocketPath(anchorPath),
            "list-sessions"
          ]);
          return stdout.trim() || stderr.trim();
        }
      });
    this.readinessTimeoutMs = options.readinessTimeoutMs;
    this.ensureDirectory =
      options.ensureDirectory ??
      (async (path) => {
        await mkdir(path, { recursive: true });
      });
    this.readTextFile = options.readTextFile ?? (async (path) => await readFile(path, "utf8"));
    this.readLinkPath = options.readLinkPath ?? (async (path) => await readlink(path));
    this.killPid = options.killPid ?? ((pid, signal) => process.kill(pid, signal));
  }

  async start(anchorPath: string): Promise<CcbdLaunchResult> {
    await this.ensureDirectory(buildCcbdDir(anchorPath));
    const launchSocketPath = buildLaunchSocketPath(anchorPath);
    const child = this.spawnProcess(this.tmuxCommand, [
      "-S",
      launchSocketPath,
      "new-session",
      "-d",
      "-x",
      "200",
      "-y",
      "60",
      "-s",
      LAUNCH_SESSION_NAME,
      "-c",
      anchorPath,
      buildTmuxLaunchCommand(this.ccbCommand, anchorPath)
    ], {
      detached: true,
      stdio: "ignore"
    });
    child.unref();
    const ready = await this.waitForReady(anchorPath);
    return {
      pid: child.pid ?? null,
      socketPath: ready.socketPath,
      launchSocketPath,
      launchSessionName: LAUNCH_SESSION_NAME
    };
  }

  async kill(anchorPath: string): Promise<CcbdCommandResult> {
    return await this.execFileProcess(this.ccbCommand, ["--project", anchorPath, "kill"]);
  }

  async killLaunchSession(anchorPath: string): Promise<CcbdCommandResult> {
    return await this.execFileProcess(this.tmuxCommand, [
      "-S",
      buildLaunchSocketPath(anchorPath),
      "kill-session",
      "-t",
      LAUNCH_SESSION_NAME
    ]);
  }

  async killLifecyclePids(anchorPath: string): Promise<LifecyclePidCleanupResult> {
    const lifecyclePath = join(buildCcbdDir(anchorPath), "lifecycle.json");
    const lifecycle = await readJsonObject(this.readTextFile, lifecyclePath);
    const pids = collectLifecyclePids(lifecycle);
    const killed: number[] = [];
    const skipped: Array<{ pid: number; reason: string }> = [];

    for (const pid of pids) {
      const belongs = await this.pidBelongsToAnchor(pid, anchorPath);
      if (!belongs) {
        skipped.push({ pid, reason: "pid does not belong to anchor path" });
        continue;
      }
      try {
        this.killPid(pid, "SIGTERM");
        killed.push(pid);
      } catch (error) {
        skipped.push({ pid, reason: error instanceof Error ? error.message : "kill failed" });
      }
    }

    return { killed, skipped };
  }

  async unlinkLaunchSocket(anchorPath: string): Promise<void> {
    await unlink(buildLaunchSocketPath(anchorPath));
  }

  private async waitForReady(anchorPath: string): Promise<CcbdReadyResult> {
    return await this.readinessProbe.waitForReady(anchorPath, {
      ...(this.readinessTimeoutMs === undefined ? {} : { timeoutMs: this.readinessTimeoutMs })
    });
  }

  private async pidBelongsToAnchor(pid: number, anchorPath: string): Promise<boolean> {
    const normalizedAnchorPath = resolve(anchorPath);
    const [cmdline, cwd] = await Promise.all([
      this.readTextFile(`/proc/${pid}/cmdline`).catch(() => ""),
      this.readLinkPath(`/proc/${pid}/cwd`).catch(() => "")
    ]);
    const normalizedCmdline = cmdline.replace(/\0/g, " ");
    const normalizedCwd = cwd ? resolve(cwd) : "";
    return (
      normalizedCmdline.includes(anchorPath) ||
      normalizedCmdline.includes(normalizedAnchorPath) ||
      normalizedCwd === normalizedAnchorPath ||
      normalizedCwd.startsWith(`${normalizedAnchorPath}/`)
    );
  }
}

export function buildLaunchSocketPath(anchorPath: string): string {
  return join(buildCcbdDir(anchorPath), "launch.sock");
}

function buildTmuxLaunchCommand(ccbCommand: string, anchorPath: string): string {
  // CCB_NO_ATTACH=1 让 ccb 跳过 tty 检测使用默认 (160,48) session size，
  // 否则 ccb 会从我们外层 tmux 给的 pty 取 size，受外层 tmux size 限制。
  // CCB_SKIP_STARTUP_UPDATE_CHECK=1 跳过 ccb 的"是否升级"交互 prompt
  // （tmux pty 是 tty，ccb 会弹"Release update available [y/N/s]"卡住）。
  return `env -u TMUX -u TMUX_PANE CCB_NO_ATTACH=1 CCB_SKIP_STARTUP_UPDATE_CHECK=1 CCB_REPLY_LANG=${resolveCcbReplyLang()} ${shellQuote(ccbCommand)} --project ${shellQuote(anchorPath)}`;
}

function resolveCcbReplyLang(): "zh" | "en" {
  const raw = process.env.CCB_REPLY_LANG ?? process.env.CCB_LANG ?? "";
  const normalized = raw.trim().toLowerCase();
  return normalized === "en" || normalized === "english" ? "en" : "zh";
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
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

function collectLifecyclePids(lifecycle: Record<string, unknown> | null): number[] {
  if (!lifecycle) {
    return [];
  }
  const pids = new Set<number>();
  for (const key of ["keeper_pid", "owner_pid", "main_pid"]) {
    const value = lifecycle[key];
    if (typeof value === "number" && Number.isInteger(value) && value > 0) {
      pids.add(value);
    }
  }
  return [...pids];
}
