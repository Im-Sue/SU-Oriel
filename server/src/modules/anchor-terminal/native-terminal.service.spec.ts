import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import { NativeAnchorTerminalService } from "./native-terminal.service.js";

const child = { unref: vi.fn() };

describe("native anchor terminal spawn", () => {
  it("uses the linux fallback chain in order and attaches the anchor session", async () => {
    const launches: Array<[string, string[]]> = [];
    const service = new NativeAnchorTerminalService({
      platform: "linux",
      env: {},
      readProcVersion: vi.fn(async () => "Linux version generic"),
      execFileProcess: vi.fn(async (_command, args) => {
        if (args.includes("list-sessions")) {
          return { stdout: "other\nccb-realtime_translator-task-task-1-a1b2\n", stderr: "" };
        }
        return { stdout: "", stderr: "" };
      }),
      probeExecutable: vi.fn(async () => true),
      launchProcess: vi.fn((command, args) => {
        launches.push([command, args]);
        if (command !== "xterm") {
          throw new Error(`${command} failed`);
        }
        return child;
      })
    });

    const result = await service.spawn({
      anchorId: "anchor-1",
      anchorPath: "/repo/realtime_translator-task-task-1",
      projectId: "project-1",
      socketPath: "/repo/realtime_translator-task-task-1/.ccb/ccbd/ccbd.sock"
    });

    expect(result.spawned).toBe(true);
    expect(result.sessionName).toBe("ccb-realtime_translator-task-task-1-a1b2");
    expect(result.socketPath).toBe("/repo/realtime_translator-task-task-1/.ccb/ccbd/tmux.sock");
    expect(launches.map(([command]) => command)).toEqual(["gnome-terminal", "konsole", "xterm"]);
    expect(launches.at(-1)).toEqual([
      "xterm",
      [
        "-e",
        "bash",
        "-lc",
        "tmux -S /repo/realtime_translator-task-task-1/.ccb/ccbd/tmux.sock attach -t ccb-realtime_translator-task-task-1-a1b2"
      ]
    ]);
    expect(child.unref).toHaveBeenCalled();
  });

  it("honors ANCHOR_TERMINAL_COMMAND with placeholder substitution", async () => {
    const launchProcess = vi.fn(() => child);
    const service = new NativeAnchorTerminalService({
      platform: "linux",
      env: {
        ANCHOR_TERMINAL_COMMAND: "custom-terminal --socket {socket} --session {session} --cwd {anchorPath}"
      },
      readProcVersion: vi.fn(async () => "Linux version generic"),
      execFileProcess: vi.fn(async () => ({ stdout: "ccb-realtime_translator-task-task-2-b2\n", stderr: "" })),
      probeExecutable: vi.fn(async (command) => command === "custom-terminal"),
      launchProcess
    });

    const result = await service.spawn({
      anchorId: "anchor-2",
      anchorPath: "/repo/realtime_translator-task-task-2",
      projectId: "project-1",
      socketPath: null
    });

    expect(result.spawned).toBe(true);
    expect(launchProcess).toHaveBeenCalledWith("custom-terminal", [
      "--socket",
      "/repo/realtime_translator-task-task-2/.ccb/ccbd/tmux.sock",
      "--session",
      "ccb-realtime_translator-task-task-2-b2",
      "--cwd",
      "/repo/realtime_translator-task-task-2"
    ]);
  });

  it("rejects shell metacharacters in ANCHOR_TERMINAL_COMMAND", async () => {
    const launchProcess = vi.fn(() => child);
    const service = new NativeAnchorTerminalService({
      platform: "linux",
      env: {
        ANCHOR_TERMINAL_COMMAND: "custom-terminal -- bash -lc tmux;touch /tmp/pwned"
      },
      readProcVersion: vi.fn(async () => "Linux version generic"),
      execFileProcess: vi.fn(async () => ({ stdout: "ccb-realtime_translator-task-task-3-c3\n", stderr: "" })),
      probeExecutable: vi.fn(async () => false),
      launchProcess
    });

    const result = await service.spawn({
      anchorId: "anchor-3",
      anchorPath: "/repo/realtime_translator-task-task-3",
      projectId: "project-1",
      socketPath: null
    });

    expect(result.spawned).toBe(false);
    expect(result.reason).toMatch(/shell metacharacters/i);
    expect(result.attempted[0]).toMatch(/ANCHOR_TERMINAL_COMMAND rejected/);
    expect(launchProcess).not.toHaveBeenCalled();
  });

  it("uses absolute WSL cmd path, probes wt through Windows cmd, and keeps wt first when available", async () => {
    const launchProcess = vi.fn(() => child);
    const execFileProcess = vi.fn(async (command: string, args: string[]) => {
      if (args.includes("list-sessions")) {
        return { stdout: "ccb-realtime_translator-task-task-4-d4\n", stderr: "" };
      }
      if (command === "/windows/c/Windows/System32/cmd.exe" && args.join(" ") === "/c where wt.exe") {
        return { stdout: "C:\\Users\\Administrator\\AppData\\Local\\Microsoft\\WindowsApps\\wt.exe\n", stderr: "" };
      }
      throw new Error(`unexpected command ${command} ${args.join(" ")}`);
    });
    const service = new NativeAnchorTerminalService({
      platform: "linux",
      env: {},
      readProcVersion: vi.fn(async () => "Linux version microsoft-standard-WSL2"),
      readWslConfig: vi.fn(async () => "[automount]\nroot=/windows/\n"),
      execFileProcess,
      probeExecutable: vi.fn(
        async (command) =>
          command === "/windows/c/Windows/System32/cmd.exe" ||
          command === "/windows/c/Windows/System32/wsl.exe"
      ),
      launchProcess
    });

    const result = await service.spawn({
      anchorId: "anchor-4",
      anchorPath: "/repo/realtime_translator-task-task-4",
      projectId: "project-1",
      socketPath: null
    });

    expect(result.spawned).toBe(true);
    expect(launchProcess).toHaveBeenCalledWith("/windows/c/Windows/System32/cmd.exe", [
      "/c",
      "start",
      "",
      "wt.exe",
      "wsl.exe",
      "--",
      "bash",
      "-lc",
      "tmux -S /repo/realtime_translator-task-task-4/.ccb/ccbd/tmux.sock attach -t ccb-realtime_translator-task-task-4-d4"
    ]);
  });

  it("skips wt when Windows where fails and falls back to conhost wsl.exe", async () => {
    const launchProcess = vi.fn(() => child);
    const execFileProcess = vi.fn(async (command: string, args: string[]) => {
      if (args.includes("list-sessions")) {
        return { stdout: "ccb-realtime_translator-task-task-5-e5\n", stderr: "" };
      }
      if (command === "/mnt/c/Windows/System32/cmd.exe" && args.join(" ") === "/c where wt.exe") {
        throw new Error("wt not found");
      }
      throw new Error(`unexpected command ${command} ${args.join(" ")}`);
    });
    const service = new NativeAnchorTerminalService({
      platform: "linux",
      env: {},
      readProcVersion: vi.fn(async () => "Linux version microsoft-standard-WSL2"),
      readWslConfig: vi.fn(async () => ""),
      execFileProcess,
      probeExecutable: vi.fn(
        async (command) =>
          command === "/mnt/c/Windows/System32/cmd.exe" || command === "/mnt/c/Windows/System32/wsl.exe"
      ),
      launchProcess
    });

    const result = await service.spawn({
      anchorId: "anchor-5",
      anchorPath: "/repo/realtime_translator-task-task-5",
      projectId: "project-1",
      socketPath: null
    });

    expect(result.spawned).toBe(true);
    expect(result.attempted[0]).toContain("(not found)");
    expect(launchProcess).toHaveBeenCalledTimes(1);
    expect(launchProcess).toHaveBeenCalledWith("/mnt/c/Windows/System32/cmd.exe", [
      "/c",
      "start",
      "",
      "wsl.exe",
      "--",
      "bash",
      "-lc",
      "tmux -S /repo/realtime_translator-task-task-5/.ccb/ccbd/tmux.sock attach -t ccb-realtime_translator-task-task-5-e5"
    ]);
  });

  it("falls back to /mnt/c when reading WSL config fails", async () => {
    const launchProcess = vi.fn(() => child);
    const service = new NativeAnchorTerminalService({
      platform: "linux",
      env: {},
      readProcVersion: vi.fn(async () => "Linux version microsoft-standard-WSL2"),
      readWslConfig: vi.fn(async () => {
        throw new Error("EACCES");
      }),
      execFileProcess: vi.fn(async (_command, args) => {
        if (args.includes("list-sessions")) {
          return { stdout: "ccb-realtime_translator-task-task-6-f6\n", stderr: "" };
        }
        throw new Error("wt not found");
      }),
      probeExecutable: vi.fn(
        async (command) =>
          command === "/mnt/c/Windows/System32/cmd.exe" || command === "/mnt/c/Windows/System32/wsl.exe"
      ),
      launchProcess
    });

    const result = await service.spawn({
      anchorId: "anchor-6",
      anchorPath: "/repo/realtime_translator-task-task-6",
      projectId: "project-1",
      socketPath: null
    });

    expect(result.spawned).toBe(true);
    expect(launchProcess).toHaveBeenCalledWith(
      "/mnt/c/Windows/System32/cmd.exe",
      expect.arrayContaining(["wsl.exe"])
    );
  });

  it("probes absolute .exe paths by existence while preserving X_OK for non-exe absolute paths", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "native-terminal-probe-"));
    const exePath = join(tempDir, "custom.exe");
    const scriptPath = join(tempDir, "custom-script");
    await writeFile(exePath, "", "utf8");
    await writeFile(scriptPath, "", "utf8");
    try {
      const execFileProcess = vi.fn(async () => ({ stdout: "ccb-realtime_translator-task-task-7-g7\n", stderr: "" }));
      const exeLaunchProcess = vi.fn(() => child);
      const exeService = new NativeAnchorTerminalService({
        platform: "linux",
        env: {
          ANCHOR_TERMINAL_COMMAND: exePath
        },
        readProcVersion: vi.fn(async () => "Linux version generic"),
        execFileProcess,
        launchProcess: exeLaunchProcess
      });
      const exeResult = await exeService.spawn({
        anchorId: "anchor-7",
        anchorPath: "/repo/realtime_translator-task-task-7",
        projectId: "project-1",
        socketPath: null
      });

      const scriptLaunchProcess = vi.fn(() => child);
      const scriptService = new NativeAnchorTerminalService({
        platform: "linux",
        env: {
          ANCHOR_TERMINAL_COMMAND: scriptPath
        },
        readProcVersion: vi.fn(async () => "Linux version generic"),
        execFileProcess,
        launchProcess: scriptLaunchProcess
      });
      const scriptResult = await scriptService.spawn({
        anchorId: "anchor-8",
        anchorPath: "/repo/realtime_translator-task-task-8",
        projectId: "project-1",
        socketPath: null
      });

      expect(exeResult.spawned).toBe(true);
      expect(exeLaunchProcess).toHaveBeenCalledWith(exePath, []);
      expect(scriptResult.spawned).toBe(false);
      expect(scriptLaunchProcess).not.toHaveBeenCalled();
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("continues to probe relative commands through which", async () => {
    const launchProcess = vi.fn(() => child);
    const service = new NativeAnchorTerminalService({
      platform: "linux",
      env: {
        ANCHOR_TERMINAL_COMMAND: "ccb-missing-terminal-command"
      },
      readProcVersion: vi.fn(async () => "Linux version generic"),
      execFileProcess: vi.fn(async () => ({ stdout: "ccb-realtime_translator-task-task-9-h9\n", stderr: "" })),
      launchProcess
    });

    const result = await service.spawn({
      anchorId: "anchor-9",
      anchorPath: "/repo/realtime_translator-task-task-9",
      projectId: "project-1",
      socketPath: null
    });

    expect(result.spawned).toBe(false);
    expect(result.attempted[0]).toContain("ccb-missing-terminal-command");
    expect(launchProcess).not.toHaveBeenCalled();
  });

  it("rejects placeholder values that introduce shell metacharacters after substitution", async () => {
    const launchProcess = vi.fn(() => child);
    const service = new NativeAnchorTerminalService({
      platform: "linux",
      env: {
        ANCHOR_TERMINAL_COMMAND: "custom-terminal --socket {socket}"
      },
      readProcVersion: vi.fn(async () => "Linux version generic"),
      execFileProcess: vi.fn(async () => ({ stdout: "ccb-realtime_translator-task-task-10-i10\n", stderr: "" })),
      probeExecutable: vi.fn(async () => false),
      launchProcess
    });

    const result = await service.spawn({
      anchorId: "anchor-10",
      anchorPath: "/repo/realtime_translator-task-task-10;touch-pwned",
      projectId: "project-1",
      socketPath: null
    });

    expect(result.spawned).toBe(false);
    expect(result.reason).toMatch(/shell metacharacters/i);
    expect(launchProcess).not.toHaveBeenCalled();
  });
});
