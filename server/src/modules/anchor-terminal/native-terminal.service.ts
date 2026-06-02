import { execFile, type ChildProcess, type ExecFileOptions } from "node:child_process";
import { constants as fsConstants } from "node:fs";
import { access, chmod, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import { promisify } from "node:util";

import type { AnchorRegistryEntry } from "../anchor-broker/broker.service.js";
import { buildAnchorTmuxSocketPath } from "./tmux.service.js";

const execFileAsync = promisify(execFile);
const ANCHOR_SESSION_PREFIX = "ccb-su-ccb-task-";
const SHELL_META_PATTERN = /[;&|<>`$()[\]{}\n\r]/;
const DEFAULT_WSL_AUTOMOUNT_ROOT = "/mnt";

type NativeTerminalAnchor = Pick<AnchorRegistryEntry, "anchorId" | "projectId" | "anchorPath" | "socketPath">;

export interface NativeAnchorTerminalSpawnResult {
  spawned: boolean;
  attempted: string[];
  reason?: string;
  fallbackCommand: string;
  sessionName: string;
  socketPath: string;
  anchorPath: string;
}

export interface NativeTerminalCommandResult {
  stdout: string;
  stderr: string;
}

export type NativeTerminalExecFileProcess = (
  command: string,
  args: string[]
) => Promise<NativeTerminalCommandResult>;
export type NativeTerminalExecutableProbe = (command: string) => Promise<boolean>;
export type NativeTerminalLaunchProcess = (command: string, args: string[]) => Pick<ChildProcess, "unref">;

interface NativeTerminalCandidate {
  command: string;
  args: string[];
  label?: string;
  probe?: () => Promise<boolean>;
}

interface NativeTerminalRejectedCandidate {
  rejected: string;
  reason: string;
}

type NativeTerminalCandidateEntry = NativeTerminalCandidate | NativeTerminalRejectedCandidate;

export interface NativeAnchorTerminalServiceOptions {
  tmuxCommand?: string;
  platform?: NodeJS.Platform;
  env?: Record<string, string | undefined>;
  execFileProcess?: NativeTerminalExecFileProcess;
  probeExecutable?: NativeTerminalExecutableProbe;
  launchProcess?: NativeTerminalLaunchProcess;
  readProcVersion?: () => Promise<string>;
  readWslConfig?: () => Promise<string>;
  createCommandFile?: (attachCommand: string) => Promise<string>;
}

export class NativeAnchorTerminalService {
  private readonly tmuxCommand: string;
  private readonly platform: NodeJS.Platform;
  private readonly env: Record<string, string | undefined>;
  private readonly execFileProcess: NativeTerminalExecFileProcess;
  private readonly probeExecutable: NativeTerminalExecutableProbe;
  private readonly launchProcess: NativeTerminalLaunchProcess;
  private readonly readProcVersion: () => Promise<string>;
  private readonly readWslConfig: () => Promise<string>;
  private readonly createCommandFile: (attachCommand: string) => Promise<string>;

  constructor(options: NativeAnchorTerminalServiceOptions = {}) {
    this.tmuxCommand = options.tmuxCommand ?? "tmux";
    this.platform = options.platform ?? process.platform;
    this.env = options.env ?? process.env;
    this.execFileProcess = options.execFileProcess ?? defaultExecFileProcess;
    this.probeExecutable = options.probeExecutable ?? defaultProbeExecutable;
    this.launchProcess = options.launchProcess ?? defaultLaunchProcess;
    this.readProcVersion = options.readProcVersion ?? defaultReadProcVersion;
    this.readWslConfig = options.readWslConfig ?? defaultReadWslConfig;
    this.createCommandFile = options.createCommandFile ?? defaultCreateCommandFile;
  }

  async spawn(anchor: NativeTerminalAnchor): Promise<NativeAnchorTerminalSpawnResult> {
    const socketPath = buildAnchorTmuxSocketPath(anchor.anchorPath);
    const sessionName = await this.resolveAnchorSession(socketPath);
    const fallbackCommand = buildAttachCommand(socketPath, sessionName);
    const candidates = await this.buildCandidates({
      anchorPath: anchor.anchorPath,
      socketPath,
      sessionName,
      attachCommand: fallbackCommand
    });
    const attempted: string[] = [];
    let reason: string | undefined;

    for (const candidate of candidates) {
      if ("rejected" in candidate) {
        attempted.push(`${candidate.rejected} rejected: ${candidate.reason}`);
        reason = candidate.reason;
        continue;
      }

      const display = formatArgv(candidate.command, candidate.args);
      const available = await this.probeExecutable(candidate.command);
      if (!available) {
        attempted.push(`${display} (not found)`);
        continue;
      }
      if (candidate.probe && !(await candidate.probe())) {
        attempted.push(`${display} (not found)`);
        continue;
      }

      attempted.push(display);
      try {
        const child = this.launchProcess(candidate.command, candidate.args);
        child.unref();
        return {
          spawned: true,
          attempted,
          fallbackCommand,
          sessionName,
          socketPath,
          anchorPath: anchor.anchorPath
        };
      } catch (error) {
        reason = error instanceof Error ? error.message : `failed to launch ${candidate.command}`;
      }
    }

    return {
      spawned: false,
      attempted,
      reason: reason ?? "no supported terminal emulator found",
      fallbackCommand,
      sessionName,
      socketPath,
      anchorPath: anchor.anchorPath
    };
  }

  private async resolveAnchorSession(socketPath: string): Promise<string> {
    const { stdout } = await this.execFileProcess(this.tmuxCommand, [
      "-S",
      socketPath,
      "list-sessions",
      "-F",
      "#{session_name}"
    ]);
    const sessions = stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    const anchorSession = sessions.find((session) => session.startsWith(ANCHOR_SESSION_PREFIX)) ?? sessions[0];
    if (!anchorSession) {
      throw new Error("anchor tmux session not found");
    }
    return anchorSession;
  }

  private async buildCandidates(input: {
    anchorPath: string;
    socketPath: string;
    sessionName: string;
    attachCommand: string;
  }): Promise<NativeTerminalCandidateEntry[]> {
    if (this.platform === "linux" && (await this.isWsl())) {
      const system32Path = await this.resolveWslSystem32Path();
      const cmdPath = join(system32Path, "cmd.exe");
      const wslPath = join(system32Path, "wsl.exe");
      return [
        {
          command: cmdPath,
          args: ["/c", "start", "", "wt.exe", "wsl.exe", "--", "bash", "-lc", input.attachCommand],
          probe: async () => (await this.probeExecutable(wslPath)) && (await this.probeWindowsTerminal(cmdPath))
        },
        {
          command: cmdPath,
          args: ["/c", "start", "", "wsl.exe", "--", "bash", "-lc", input.attachCommand],
          probe: async () => await this.probeExecutable(wslPath)
        }
      ];
    }

    if (this.platform === "linux") {
      return [
        ...this.buildOverrideCandidate(input),
        {
          command: "gnome-terminal",
          args: ["--", "bash", "-lc", input.attachCommand]
        },
        {
          command: "konsole",
          args: ["-e", "bash", "-lc", input.attachCommand]
        },
        {
          command: "xterm",
          args: ["-e", "bash", "-lc", input.attachCommand]
        }
      ];
    }

    if (this.platform === "darwin") {
      const commandFile = await this.createCommandFile(input.attachCommand);
      return [
        ...this.buildOverrideCandidate(input),
        {
          command: "osascript",
          args: ["-e", buildITermAppleScript(input.attachCommand)]
        },
        {
          command: "open",
          args: ["-a", "Terminal.app", commandFile]
        }
      ];
    }

    return this.buildOverrideCandidate(input);
  }

  private buildOverrideCandidate(input: {
    anchorPath: string;
    socketPath: string;
    sessionName: string;
  }): NativeTerminalCandidateEntry[] {
    const template = this.env.ANCHOR_TERMINAL_COMMAND?.trim();
    if (!template) {
      return [];
    }
    try {
      const parsed = parseOverrideCommand(template, input);
      return [parsed];
    } catch (error) {
      return [
        {
          rejected: "ANCHOR_TERMINAL_COMMAND",
          reason: error instanceof Error ? error.message : "invalid ANCHOR_TERMINAL_COMMAND"
        }
      ];
    }
  }

  private async isWsl(): Promise<boolean> {
    try {
      return /microsoft/i.test(await this.readProcVersion());
    } catch {
      return false;
    }
  }

  private async resolveWslSystem32Path(): Promise<string> {
    let root = DEFAULT_WSL_AUTOMOUNT_ROOT;
    try {
      root = parseWslAutomountRoot(await this.readWslConfig()) ?? DEFAULT_WSL_AUTOMOUNT_ROOT;
    } catch {
      root = DEFAULT_WSL_AUTOMOUNT_ROOT;
    }
    return join(root, "c", "Windows", "System32");
  }

  private async probeWindowsTerminal(cmdPath: string): Promise<boolean> {
    try {
      await this.execFileProcess(cmdPath, ["/c", "where", "wt.exe"]);
      return true;
    } catch {
      return false;
    }
  }
}

async function defaultExecFileProcess(command: string, args: string[]): Promise<NativeTerminalCommandResult> {
  const { stdout, stderr } = await execFileAsync(command, args, { encoding: "utf8" });
  return {
    stdout: String(stdout),
    stderr: String(stderr)
  };
}

async function defaultProbeExecutable(command: string): Promise<boolean> {
  try {
    if (isAbsolute(command)) {
      await access(command, isWindowsExePath(command) ? fsConstants.F_OK : fsConstants.X_OK);
      return true;
    }
    await execFileAsync("which", [command], { encoding: "utf8" });
    return true;
  } catch {
    return false;
  }
}

function defaultLaunchProcess(command: string, args: string[]): Pick<ChildProcess, "unref"> {
  const options = {
    detached: true,
    windowsHide: false
  } as ExecFileOptions;
  const child = execFile(
    command,
    args,
    options,
    () => undefined
  );
  unrefChildStream(child.stdin);
  unrefChildStream(child.stdout);
  unrefChildStream(child.stderr);
  return child;
}

function unrefChildStream(stream: unknown): void {
  const maybeStream = stream as { unref?: () => void } | null | undefined;
  maybeStream?.unref?.();
}

async function defaultReadProcVersion(): Promise<string> {
  return await readFile("/proc/version", "utf8");
}

async function defaultReadWslConfig(): Promise<string> {
  return await readFile("/etc/wsl.conf", "utf8");
}

async function defaultCreateCommandFile(attachCommand: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "ccb-anchor-terminal-"));
  const filePath = join(dir, "attach.command");
  await writeFile(filePath, `#!/bin/bash\n${attachCommand}\n`, "utf8");
  await chmod(filePath, 0o700);
  return filePath;
}

function parseOverrideCommand(
  template: string,
  values: { socketPath: string; sessionName: string; anchorPath: string }
): NativeTerminalCandidate {
  const parts = template
    .split(/\s+/)
    .filter(Boolean)
    .map((part) =>
      part
        .replaceAll("{socket}", values.socketPath)
        .replaceAll("{session}", values.sessionName)
        .replaceAll("{anchorPath}", values.anchorPath)
    );

  if (parts.length === 0 || !parts[0]) {
    throw new Error("ANCHOR_TERMINAL_COMMAND is empty");
  }
  if (parts.some((part) => SHELL_META_PATTERN.test(part))) {
    throw new Error("shell metacharacters are not allowed");
  }

  return {
    command: parts[0],
    args: parts.slice(1)
  };
}

function parseWslAutomountRoot(value: string): string | null {
  let inAutomount = false;
  for (const rawLine of value.split(/\r?\n/)) {
    const line = stripIniComment(rawLine).trim();
    if (!line) {
      continue;
    }
    const section = line.match(/^\[([^\]]+)]$/);
    if (section) {
      inAutomount = section[1]?.trim().toLowerCase() === "automount";
      continue;
    }
    if (!inAutomount) {
      continue;
    }
    const root = line.match(/^root\s*=\s*(.+)$/i);
    if (root) {
      const parsed = root[1]?.trim().replace(/^["']|["']$/g, "") ?? "";
      return parsed.startsWith("/") ? parsed : null;
    }
  }
  return null;
}

function stripIniComment(line: string): string {
  return line.replace(/\s[#;].*$/, "");
}

function isWindowsExePath(command: string): boolean {
  const normalized = command.replace(/\\/g, "/");
  return /\.exe$/i.test(normalized) || /\/Windows\//i.test(normalized);
}

function buildAttachCommand(socketPath: string, sessionName: string): string {
  return `tmux -S ${quoteForShell(socketPath)} attach -t ${quoteForShell(sessionName)}`;
}

function quoteForShell(value: string): string {
  if (/^[A-Za-z0-9_@%+=:,./-]+$/.test(value)) {
    return value;
  }
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function formatArgv(command: string, args: string[]): string {
  return [command, ...args].map(quoteForShell).join(" ");
}

function buildITermAppleScript(attachCommand: string): string {
  return [
    'tell application "iTerm"',
    "activate",
    `create window with default profile command ${quoteAppleScriptString(attachCommand)}`,
    "end tell"
  ].join("\n");
}

function quoteAppleScriptString(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}
