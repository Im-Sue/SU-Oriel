import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

export type ExternalTerminalPreference = "tmux" | "windows-terminal" | "auto";

export interface ExternalLaunchInput {
  command: string;
  args: string[];
  cwd: string;
  terminalPreference?: ExternalTerminalPreference;
  profileId?: string | null;
  profile?: ExecutorProfileRef | null;
}

export interface ExternalLaunchResult {
  pid: number | null;
  terminalKind: string;
}

export interface ExecutorProfileRef {
  profileId: string;
  provider: string;
  model: string;
  runtime: "external" | "pty" | "command" | "settings";
}

export class ExternalLaunchError extends Error {
  public readonly code: string;
  public constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

/**
 * 在系统原生终端窗口里启动 AI CLI。
 *
 * 关键：
 * - 不使用 shell:true，所有参数走数组传递
 * - command 与 args 都来自 server-side 白名单/settings，不接受请求体里的任意值
 * - detached + stdio:'ignore' + unref，让新窗口与 server 完全脱钩
 */
export function launchExternal(input: ExternalLaunchInput): ExternalLaunchResult {
  const launchInput = resolveExternalProfileLaunchInput(input);
  const platform = process.platform;
  if (platform === "win32") {
    return launchOnWindows(launchInput);
  }
  if (platform === "darwin") {
    return launchOnMacOs(launchInput);
  }
  if (platform === "linux") {
    return launchOnLinux(launchInput);
  }
  throw new ExternalLaunchError("PLATFORM_UNSUPPORTED", `不支持的操作系统：${platform}`);
}

export function resolveExternalProfileLaunchInput(input: ExternalLaunchInput): ExternalLaunchInput {
  if (!input.profile) {
    if (input.profileId) {
      throw new ExternalLaunchError("PROFILE_NOT_FOUND", `profile_id not found: ${input.profileId}`);
    }
    return input;
  }

  assertValidExecutorProfile(input.profile, "external");
  return {
    ...input,
    command: input.profile.provider,
    args: ["--model", input.profile.model, ...input.args]
  };
}

function assertValidExecutorProfile(profile: ExecutorProfileRef, expectedRuntime: ExecutorProfileRef["runtime"]): void {
  if (!profile.profileId || !profile.provider || !profile.model || !profile.runtime) {
    throw new ExternalLaunchError("PROFILE_INVALID", "ExecutorProfile 缺少 profileId/provider/model/runtime");
  }
  if (profile.runtime !== expectedRuntime) {
    throw new ExternalLaunchError(
      "PROFILE_RUNTIME_MISMATCH",
      `ExecutorProfile runtime=${profile.runtime} 不能用于 ${expectedRuntime} adapter`
    );
  }
}

function launchOnWindows(input: ExternalLaunchInput): ExternalLaunchResult {
  const wt = resolveExecutableInPath("wt.exe");
  const inner = quoteForCmd(input.command, input.args);

  if (wt) {
    const child = spawn(wt, ["-d", input.cwd, "cmd.exe", "/K", inner], {
      detached: true,
      stdio: "ignore",
      windowsHide: false
    });
    child.unref();
    return { pid: child.pid ?? null, terminalKind: "wt" };
  }

  const child = spawn("cmd.exe", ["/c", "start", "", "cmd.exe", "/K", inner], {
    cwd: input.cwd,
    detached: true,
    stdio: "ignore",
    windowsHide: false
  });
  child.unref();
  return { pid: child.pid ?? null, terminalKind: "cmd" };
}

function launchOnMacOs(input: ExternalLaunchInput): ExternalLaunchResult {
  const escapedCwd = escapeAppleScript(input.cwd);
  const escapedCmd = escapeAppleScript(buildShellCommandLine(input.command, input.args));
  const script = `tell application "Terminal" to do script "cd \\"${escapedCwd}\\"; ${escapedCmd}"`;
  const child = spawn("osascript", ["-e", script, "-e", 'tell application "Terminal" to activate'], {
    detached: true,
    stdio: "ignore"
  });
  child.unref();
  return { pid: child.pid ?? null, terminalKind: "Terminal.app" };
}

function launchOnLinux(input: ExternalLaunchInput): ExternalLaunchResult {
  const cmdLine = buildShellCommandLine(input.command, input.args);
  const terminalPreference = input.terminalPreference ?? "auto";

  if (terminalPreference === "windows-terminal" && isWSL()) {
    return launchOnWslWindowsTerminal(input, cmdLine);
  }

  const tmux = resolveExecutableInPath("tmux");
  if (tmux) {
    // tmux new-session is the stable backend for WSL/headless Linux.
    const child = spawn(tmux, ["new-session", "-d", "-s", `ccb-console-${Date.now()}`, "-c", input.cwd, `${cmdLine}; exec bash`], {
      detached: true,
      stdio: "ignore"
    });
    child.unref();
    return { pid: child.pid ?? null, terminalKind: "tmux" };
  }

  const candidates: Array<{ bin: string; argsFor: (cmd: string, cwd: string) => string[] }> = [
    {
      bin: "gnome-terminal",
      argsFor: (cmd, cwd) => ["--working-directory", cwd, "--", "bash", "-lc", `${cmd}; exec bash`]
    },
    {
      bin: "konsole",
      argsFor: (cmd, cwd) => ["--workdir", cwd, "-e", "bash", "-lc", `${cmd}; exec bash`]
    },
    {
      bin: "xfce4-terminal",
      argsFor: (cmd, cwd) => ["--working-directory", cwd, "--command", `bash -lc "${cmd.replace(/"/g, '\\"')}; exec bash"`]
    },
    {
      bin: "x-terminal-emulator",
      argsFor: (cmd, cwd) => ["-e", `bash -lc "cd '${cwd.replace(/'/g, "'\\''")}'; ${cmd.replace(/"/g, '\\"')}; exec bash"`]
    },
    {
      bin: "xterm",
      argsFor: (cmd, cwd) => ["-e", `bash -lc "cd '${cwd.replace(/'/g, "'\\''")}'; ${cmd.replace(/"/g, '\\"')}; exec bash"`]
    }
  ];

  for (const candidate of candidates) {
    const bin = resolveExecutableInPath(candidate.bin);
    if (!bin) {
      continue;
    }
    const child = spawn(bin, candidate.argsFor(cmdLine, input.cwd), {
      detached: true,
      stdio: "ignore"
    });
    child.unref();
    return { pid: child.pid ?? null, terminalKind: candidate.bin };
  }

  const wslHint = isWSL() ? " WSL 环境推荐安装 tmux：`sudo apt install tmux`。" : "";
  throw new ExternalLaunchError(
    "EXTERNAL_TERMINAL_MISSING",
    `未在系统中检测到可用的终端模拟器，请安装 tmux、gnome-terminal、konsole、xterm 等。${wslHint}`
  );
}

function launchOnWslWindowsTerminal(input: ExternalLaunchInput, cmdLine: string): ExternalLaunchResult {
  const wt = resolveExecutableInPath("wt.exe");
  const wslpath = resolveExecutableInPath("wslpath");
  if (!wt || !wslpath) {
    throw new ExternalLaunchError(
      "EXTERNAL_TERMINAL_MISSING",
      "显式选择 Windows Terminal，但 WSL 环境未检测到 wt.exe 或 wslpath。WSL 环境推荐安装 tmux：`sudo apt install tmux`。"
    );
  }

  const pathResult = spawnSync(wslpath, ["-w", input.cwd], { encoding: "utf8" });
  if (pathResult.status !== 0) {
    throw new ExternalLaunchError("EXTERNAL_TERMINAL_MISSING", `wslpath 无法转换工作目录：${input.cwd}`);
  }

  const windowsCwd = pathResult.stdout.trim();
  const child = spawn(wt, ["-d", windowsCwd, "wsl.exe", "--cd", input.cwd, "bash", "-lc", `${cmdLine}; exec bash`], {
    detached: true,
    stdio: "ignore"
  });
  child.unref();
  return { pid: child.pid ?? null, terminalKind: "wt" };
}

export function isWSL(env: NodeJS.ProcessEnv = process.env, procVersion = readProcVersion()): boolean {
  if (env.WSL_DISTRO_NAME) {
    return true;
  }
  return /microsoft|WSL/i.test(procVersion);
}

function readProcVersion(): string {
  try {
    return readFileSync("/proc/version", "utf8");
  } catch {
    return "";
  }
}

function buildShellCommandLine(command: string, args: string[]): string {
  // 用于 bash/Terminal.app 这种"按字符串执行"的场景，需要单引号转义
  const safe = (value: string): string => `'${value.replace(/'/g, "'\\''")}'`;
  return [safe(command), ...args.map(safe)].join(" ");
}

function quoteForCmd(command: string, args: string[]): string {
  const quote = (value: string): string => {
    if (value.length === 0) {
      return '""';
    }
    if (!/[\s"^&|<>]/.test(value)) {
      return value;
    }
    return `"${value.replace(/(\\*)("|$)/g, (_match, slashes: string, quoteChar: string) => slashes + slashes + (quoteChar ? '\\"' : ""))}"`;
  };
  return [quote(command), ...args.map(quote)].join(" ");
}

function escapeAppleScript(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function resolveExecutableInPath(name: string): string | null {
  // 复用一个轻量的 which 探测。registry 也有同名实现，但这里要保持模块独立。
  if (existsSync(name)) {
    return name;
  }
  try {
    const probe = process.platform === "win32"
      ? spawnSync("where", [name], { encoding: "utf8" })
      : spawnSync("which", [name], { encoding: "utf8" });
    if (probe.status === 0) {
      const first = probe.stdout.split(/\r?\n/).map((line) => line.trim()).find(Boolean);
      return first ?? null;
    }
  } catch {
    return null;
  }
  return null;
}
