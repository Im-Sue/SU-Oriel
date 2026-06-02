import { spawn, spawnSync } from "node:child_process";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { isWSL, launchExternal } from "./ai-cli.external.js";

vi.mock("node:child_process", () => ({
  spawn: vi.fn(),
  spawnSync: vi.fn()
}));

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    existsSync: vi.fn(() => false),
    readFileSync: vi.fn(() => "")
  };
});

const spawnMock = vi.mocked(spawn);
const spawnSyncMock = vi.mocked(spawnSync);

function spawnSyncResult(status: number, stdout = ""): ReturnType<typeof spawnSync> {
  return {
    pid: 0,
    output: [null, stdout, ""],
    stdout,
    stderr: "",
    status,
    signal: null
  } as unknown as ReturnType<typeof spawnSync>;
}

function mockWhich(available: Record<string, string>) {
  spawnSyncMock.mockImplementation((command, args) => {
    if (command === "which" && Array.isArray(args)) {
      const name = String(args[0]);
      const resolved = available[name];
      return spawnSyncResult(resolved ? 0 : 1, resolved ? `${resolved}\n` : "");
    }

    return spawnSyncResult(1);
  });
}

describe("ai-cli external launcher", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.WSL_DISTRO_NAME;
    spawnMock.mockReturnValue({ pid: 1234, unref: vi.fn() } as never);
  });

  it("detects WSL from env or /proc/version content", () => {
    expect(isWSL({ WSL_DISTRO_NAME: "Ubuntu" }, "")).toBe(true);
    expect(isWSL({}, "Linux version 6.6.87.2-microsoft-standard-WSL2")).toBe(true);
    expect(isWSL({}, "Linux version 6.8.0-generic")).toBe(false);
  });

  it("prefers tmux before GUI terminal on Linux auto mode", () => {
    mockWhich({
      tmux: "/usr/bin/tmux",
      "gnome-terminal": "/usr/bin/gnome-terminal"
    });

    const result = launchExternal({
      command: "codex",
      args: ["--version"],
      cwd: "/tmp/project"
    });

    expect(result.terminalKind).toBe("tmux");
    expect(spawnMock).toHaveBeenCalledWith(
      "/usr/bin/tmux",
      expect.arrayContaining(["new-session", "-d", "-c", "/tmp/project", "'codex' '--version'; exec bash"]),
      expect.objectContaining({ detached: true, stdio: "ignore" })
    );
  });

  it("keeps legacy command args when profile is null", () => {
    mockWhich({
      tmux: "/usr/bin/tmux"
    });

    launchExternal({
      command: "codex",
      args: ["--version"],
      cwd: "/tmp/project",
      profile: null
    });

    expect(spawnMock).toHaveBeenCalledWith(
      "/usr/bin/tmux",
      expect.arrayContaining(["new-session", "-d", "-c", "/tmp/project", "'codex' '--version'; exec bash"]),
      expect.objectContaining({ detached: true, stdio: "ignore" })
    );
  });

  it("injects ExecutorProfile provider and model into external launch args", () => {
    mockWhich({
      tmux: "/usr/bin/tmux"
    });

    launchExternal({
      command: "claude",
      args: ["--continue"],
      cwd: "/tmp/project",
      profile: {
        profileId: "default-codex",
        provider: "codex",
        model: "gpt-5.5",
        runtime: "external"
      }
    });

    expect(spawnMock).toHaveBeenCalledWith(
      "/usr/bin/tmux",
      expect.arrayContaining([
        "new-session",
        "-d",
        "-c",
        "/tmp/project",
        "'codex' '--model' 'gpt-5.5' '--continue'; exec bash"
      ]),
      expect.objectContaining({ detached: true, stdio: "ignore" })
    );
  });

  it("rejects missing external profile resolution", () => {
    expect(() =>
      launchExternal({
        command: "codex",
        args: [],
        cwd: "/tmp/project",
        profileId: "missing-profile",
        profile: null
      })
    ).toThrow(/profile_id not found: missing-profile/);
  });

  it("does not use Windows Terminal unless explicitly requested", () => {
    process.env.WSL_DISTRO_NAME = "Ubuntu";
    mockWhich({
      "wt.exe": "/mnt/c/Users/sue/AppData/Local/Microsoft/WindowsApps/wt.exe",
      "gnome-terminal": "/usr/bin/gnome-terminal"
    });

    const result = launchExternal({
      command: "codex",
      args: [],
      cwd: "/tmp/project"
    });

    expect(result.terminalKind).toBe("gnome-terminal");
    expect(spawnMock).toHaveBeenCalledWith(
      "/usr/bin/gnome-terminal",
      expect.any(Array),
      expect.objectContaining({ detached: true, stdio: "ignore" })
    );
  });

  it("adds WSL tmux install hint when no Linux backend is available", () => {
    process.env.WSL_DISTRO_NAME = "Ubuntu";
    mockWhich({});

    expect(() =>
      launchExternal({
        command: "codex",
        args: [],
        cwd: "/tmp/project"
      })
    ).toThrow(/WSL 环境推荐安装 tmux：`sudo apt install tmux`/);
  });
});
