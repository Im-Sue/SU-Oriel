import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PtyManager } from "./ai-cli.pty.js";

type ExitHandler = (event: { exitCode: number; signal?: string }) => void;

const spawnMock = vi.hoisted(() => vi.fn());

vi.mock("node-pty", () => ({
  spawn: spawnMock
}));

function mockPtyProcess() {
  let exitHandler: ExitHandler | null = null;
  return {
    onData: vi.fn(),
    onExit: vi.fn((handler: ExitHandler) => {
      exitHandler = handler;
    }),
    write: vi.fn(),
    resize: vi.fn(),
    kill: vi.fn(() => {
      exitHandler?.({ exitCode: 0 });
    })
  };
}

describe("ai-cli pty profile resolution", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    spawnMock.mockReset();
    spawnMock.mockReturnValue(mockPtyProcess());
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  });

  it("keeps legacy command args when profile is null", () => {
    const manager = new PtyManager();

    const descriptor = manager.create({
      toolId: "codex",
      command: "codex",
      args: ["--version"],
      cwd: "/tmp/project",
      projectId: null,
      shellWrap: false,
      recordingStore: null,
      profile: null
    });

    expect(descriptor.command).toBe("codex");
    expect(descriptor.args).toEqual(["--version"]);
    expect(spawnMock).toHaveBeenCalledWith(
      "codex",
      ["--version"],
      expect.objectContaining({ cwd: "/tmp/project" })
    );
    manager.killAll();
  });

  it("injects ExecutorProfile provider and model into pty launch args", () => {
    const manager = new PtyManager();

    const descriptor = manager.create({
      toolId: "codex",
      command: "claude",
      args: ["--continue"],
      cwd: "/tmp/project",
      projectId: null,
      shellWrap: false,
      recordingStore: null,
      profile: {
        profileId: "default-codex",
        provider: "codex",
        model: "gpt-5.5",
        runtime: "pty"
      }
    });

    expect(descriptor.command).toBe("codex");
    expect(descriptor.args).toEqual(["--model", "gpt-5.5", "--continue"]);
    expect(spawnMock).toHaveBeenCalledWith(
      "codex",
      ["--model", "gpt-5.5", "--continue"],
      expect.objectContaining({ cwd: "/tmp/project" })
    );
    manager.killAll();
  });

  it("rejects missing pty profile resolution", () => {
    const manager = new PtyManager();

    expect(() =>
      manager.create({
        toolId: "codex",
        command: "codex",
        args: [],
        cwd: "/tmp/project",
        projectId: null,
        shellWrap: false,
        recordingStore: null,
        profileId: "missing-profile",
        profile: null
      })
    ).toThrow(/profile_id not found: missing-profile/);
  });
});
