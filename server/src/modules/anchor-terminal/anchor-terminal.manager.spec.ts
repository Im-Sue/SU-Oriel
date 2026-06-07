import { EventEmitter } from "node:events";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { AnchorTerminalManager } from "./terminal-manager.js";
import { AnchorTerminalRecordingStore } from "./recording-store.js";
import type { AnchorTerminalPane, AnchorTerminalTmuxBackend, PipeOutputSource } from "./types.js";

class ControlledPipeSource implements PipeOutputSource {
  public readonly emitter = new EventEmitter();
  public closed = false;

  onData(handler: (chunk: string) => void): void {
    this.emitter.on("data", handler);
  }

  onError(handler: (error: Error) => void): void {
    this.emitter.on("error", handler);
  }

  async close(): Promise<void> {
    this.closed = true;
  }

  push(chunk: string): void {
    this.emitter.emit("data", chunk);
  }
}

function pane(name = "ccb_claude", paneId = "%2"): AnchorTerminalPane {
  return {
    name,
    paneId,
    title: name,
    currentCommand: "python",
    sessionName: "ccb-realtime_translator-task-task-1-a1b2",
    windowIndex: 0,
    paneIndex: 1,
    active: true,
    cols: 80,
    rows: 24
  };
}

describe("anchor-terminal manager", () => {
  let tempDir: string | null = null;

  afterEach(async () => {
    vi.useRealTimers();
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
      tempDir = null;
    }
  });

  it("fans out capture-pane frames to clients while pipe output only records", async () => {
    vi.useFakeTimers();
    tempDir = await mkdtemp(join(tmpdir(), "anchor-terminal-recordings-"));
    const pipeSource = new ControlledPipeSource();
    const startPipe = vi.fn(async () => undefined);
    const stopPipe = vi.fn(async () => undefined);
    const captureFrame = vi
      .fn()
      .mockResolvedValueOnce({ data: "\u001b[32mframe-1\u001b[0m\n", cols: 80, rows: 31 })
      .mockResolvedValueOnce({ data: "\u001b[32mframe-1\u001b[0m\n", cols: 80, rows: 31 })
      .mockResolvedValueOnce({ data: "\u001b[33mframe-2\u001b[0m\n", cols: 81, rows: 31 });
    const tmux: AnchorTerminalTmuxBackend = {
      listPanes: vi.fn(async () => [pane()]),
      capturePane: vi.fn(async () => "\u001b[32msnapshot\u001b[0m\n"),
      captureFrame,
      startPipe,
      stopPipe,
      getWindowLayout: vi.fn(async () => "layout"),
      resizeWindow: vi.fn(async () => undefined),
      zoomPane: vi.fn(async () => undefined),
      unzoomPane: vi.fn(async () => undefined),
      restoreLayout: vi.fn(async () => undefined),
      sendKeysLiteral: vi.fn(async () => undefined)
    };
    const manager = new AnchorTerminalManager({
      tmux,
      recordingStore: new AnchorTerminalRecordingStore(tempDir),
      openPipeOutput: async () => pipeSource,
      anchorResolver: async () => ({
        anchorId: "anchor_task_1",
        anchorPath: "/repo/realtime_translator-task-1",
        taskId: "task-1",
        state: "ready"
      }),
      healthCheckIntervalMs: 60_000,
      mirrorIntervalMs: 200
    });

    const first = await manager.attach({
      anchorId: "anchor_task_1",
      paneName: "ccb_claude",
      clientId: "client-a"
    });
    const second = await manager.attach({
      anchorId: "anchor_task_1",
      paneName: "ccb_claude",
      clientId: "client-b"
    });
    const receivedA: string[] = [];
    const receivedB: string[] = [];
    first.emitter.on("frame", (event) => {
      receivedA.push(`${event.generation}:${event.cols}x${event.rows}:${event.data}`);
    });
    second.emitter.on("frame", (event) => {
      receivedB.push(`${event.generation}:${event.cols}x${event.rows}:${event.data}`);
    });

    pipeSource.push("\u001b[31mlive\u001b[0m\n");
    await vi.advanceTimersByTimeAsync(200);
    await vi.advanceTimersByTimeAsync(200);
    await vi.advanceTimersByTimeAsync(200);

    vi.useRealTimers();
    await manager.closeStream("anchor_task_1", "ccb_claude", "test cleanup");

    expect(startPipe).toHaveBeenCalledTimes(1);
    expect(stopPipe).toHaveBeenCalledTimes(1);
    expect(pipeSource.closed).toBe(true);
    expect(first.snapshot).toBe("");
    expect(first.bufferTail).toBe("");
    expect(second.snapshot).toBe("");
    expect(second.bufferTail).toBe("");
    expect(receivedA).toEqual([
      "1:80x31:\u001b[32mframe-1\u001b[0m\n",
      "2:81x31:\u001b[33mframe-2\u001b[0m\n"
    ]);
    expect(receivedB).toEqual(receivedA);

    const recordings = new AnchorTerminalRecordingStore(tempDir).list({ anchorId: "anchor_task_1" });
    expect(recordings).toHaveLength(1);
    expect(recordings[0]).toMatchObject({
      anchorId: "anchor_task_1",
      taskId: "task-1",
      pane: "ccb_claude",
      source: "anchor",
      finishedAt: expect.any(String)
    });
    const payload = new AnchorTerminalRecordingStore(tempDir).read(recordings[0].id);
    expect(payload.cast).toContain("live");
    expect(payload.cast).not.toContain("frame-1");
  });

  it("stores the latest mirror frame for future attach calls and keeps it unchanged on dedup ticks", async () => {
    vi.useFakeTimers();
    tempDir = await mkdtemp(join(tmpdir(), "anchor-terminal-last-frame-"));
    const pipeSource = new ControlledPipeSource();
    const captureFrame = vi
      .fn()
      .mockResolvedValueOnce({ data: "first frame\n", cols: 80, rows: 24 })
      .mockResolvedValueOnce({ data: "first frame\n", cols: 80, rows: 24 });
    const tmux: AnchorTerminalTmuxBackend = {
      listPanes: vi.fn(async () => [pane()]),
      capturePane: vi.fn(async () => ""),
      captureFrame,
      startPipe: vi.fn(async () => undefined),
      stopPipe: vi.fn(async () => undefined),
      getWindowLayout: vi.fn(async () => "layout"),
      resizeWindow: vi.fn(async () => undefined),
      zoomPane: vi.fn(async () => undefined),
      unzoomPane: vi.fn(async () => undefined),
      restoreLayout: vi.fn(async () => undefined),
      sendKeysLiteral: vi.fn(async () => undefined)
    };
    const manager = new AnchorTerminalManager({
      tmux,
      recordingStore: new AnchorTerminalRecordingStore(tempDir),
      openPipeOutput: async () => pipeSource,
      anchorResolver: async () => ({
        anchorId: "anchor_task_1",
        anchorPath: "/repo/realtime_translator-task-1",
        taskId: "task-1",
        state: "ready"
      }),
      healthCheckIntervalMs: 60_000,
      mirrorIntervalMs: 200
    });

    const first = await manager.attach({
      anchorId: "anchor_task_1",
      paneName: "ccb_claude",
      clientId: "client-a"
    });
    expect(first.lastFrame).toBe(null);

    await vi.advanceTimersByTimeAsync(200);
    const second = await manager.attach({
      anchorId: "anchor_task_1",
      paneName: "ccb_claude",
      clientId: "client-b"
    });

    expect(second.lastFrame).toEqual({
      anchorId: "anchor_task_1",
      pane: "ccb_claude",
      data: "first frame\n",
      cols: 80,
      rows: 24,
      generation: 1
    });

    await vi.advanceTimersByTimeAsync(200);
    const third = await manager.attach({
      anchorId: "anchor_task_1",
      paneName: "ccb_claude",
      clientId: "client-c"
    });

    expect(third.lastFrame).toEqual(second.lastFrame);

    vi.useRealTimers();
    await manager.closeStream("anchor_task_1", "ccb_claude", "test cleanup");
  });

  it("leases tmux viewport, debounces resize, switches zoom target, and restores on final detach", async () => {
    vi.useFakeTimers();
    tempDir = await mkdtemp(join(tmpdir(), "anchor-terminal-viewport-"));
    const sources: ControlledPipeSource[] = [];
    const claude = pane("ccb_claude", "%2");
    const codex = pane("ccb_codex", "%3");
    const getWindowLayout = vi.fn(async () => "original-layout");
    const resizeWindow = vi.fn(async () => undefined);
    const zoomPane = vi.fn(async () => undefined);
    const unzoomPane = vi.fn(async () => undefined);
    const restoreLayout = vi.fn(async () => undefined);
    const tmux: AnchorTerminalTmuxBackend = {
      listPanes: vi.fn(async () => [claude, codex]),
      capturePane: vi.fn(async () => ""),
      captureFrame: vi.fn(async () => ({ data: "", cols: 80, rows: 24 })),
      startPipe: vi.fn(async () => undefined),
      stopPipe: vi.fn(async () => undefined),
      getWindowLayout,
      resizeWindow,
      zoomPane,
      unzoomPane,
      restoreLayout,
      sendKeysLiteral: vi.fn(async () => undefined)
    };
    const manager = new AnchorTerminalManager({
      tmux,
      recordingStore: new AnchorTerminalRecordingStore(tempDir),
      openPipeOutput: async () => {
        const source = new ControlledPipeSource();
        sources.push(source);
        return source;
      },
      anchorResolver: async () => ({
        anchorId: "anchor_task_1",
        anchorPath: "/repo/realtime_translator-task-1",
        taskId: "task-1",
        state: "ready"
      }),
      healthCheckIntervalMs: 60_000
    });

    await manager.attach({ anchorId: "anchor_task_1", paneName: "ccb_claude", clientId: "client-a" });
    await manager.applyViewport({
      anchorId: "anchor_task_1",
      paneName: "ccb_claude",
      clientId: "client-a",
      cols: 120,
      rows: 40,
      active: true
    });
    await manager.applyViewport({
      anchorId: "anchor_task_1",
      paneName: "ccb_claude",
      clientId: "client-a",
      cols: 142,
      rows: 38,
      active: true
    });

    expect(getWindowLayout).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(199);
    expect(resizeWindow).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);

    expect(resizeWindow).toHaveBeenCalledTimes(1);
    expect(resizeWindow).toHaveBeenLastCalledWith(
      expect.objectContaining({ anchorPath: "/repo/realtime_translator-task-1" }),
      "ccb-realtime_translator-task-task-1-a1b2",
      142,
      38
    );
    expect(zoomPane).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ name: "ccb_claude" }));

    await manager.attach({ anchorId: "anchor_task_1", paneName: "ccb_codex", clientId: "client-b" });
    await manager.applyViewport({
      anchorId: "anchor_task_1",
      paneName: "ccb_codex",
      clientId: "client-b",
      cols: 150,
      rows: 42,
      active: true
    });
    await vi.advanceTimersByTimeAsync(200);

    expect(unzoomPane).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ name: "ccb_claude" }));
    expect(zoomPane).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ name: "ccb_codex" }));
    expect(resizeWindow).toHaveBeenLastCalledWith(expect.anything(), "ccb-realtime_translator-task-task-1-a1b2", 150, 42);

    manager.detach("anchor_task_1", "ccb_claude", "client-a");
    manager.detach("anchor_task_1", "ccb_codex", "client-b");
    await Promise.resolve();
    await Promise.resolve();

    expect(restoreLayout).toHaveBeenCalledWith(
      expect.objectContaining({ anchorPath: "/repo/realtime_translator-task-1" }),
      "ccb-realtime_translator-task-task-1-a1b2",
      "original-layout"
    );
  });

  it("grants one writer lease per pane, applies input, audits metadata, and releases on detach", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "anchor-terminal-writer-"));
    const pipeSource = new ControlledPipeSource();
    const sendKeysLiteral = vi.fn(async () => undefined);
    const recordInput = vi.fn();
    const tmux: AnchorTerminalTmuxBackend = {
      listPanes: vi.fn(async () => [pane()]),
      capturePane: vi.fn(async () => ""),
      captureFrame: vi.fn(async () => ({ data: "", cols: 80, rows: 24 })),
      startPipe: vi.fn(async () => undefined),
      stopPipe: vi.fn(async () => undefined),
      getWindowLayout: vi.fn(async () => "layout"),
      resizeWindow: vi.fn(async () => undefined),
      zoomPane: vi.fn(async () => undefined),
      unzoomPane: vi.fn(async () => undefined),
      restoreLayout: vi.fn(async () => undefined),
      sendKeysLiteral
    };
    const manager = new AnchorTerminalManager({
      tmux,
      recordingStore: new AnchorTerminalRecordingStore(tempDir),
      openPipeOutput: async () => pipeSource,
      auditWriter: {
        recordInput,
        flush: vi.fn(async () => undefined),
        close: vi.fn(async () => undefined)
      },
      anchorResolver: async () => ({
        anchorId: "anchor_task_1",
        anchorPath: "/repo/realtime_translator-task-1",
        taskId: "task-1",
        state: "ready"
      }),
      healthCheckIntervalMs: 60_000
    });

    const first = await manager.attach({
      anchorId: "anchor_task_1",
      paneName: "ccb_claude",
      clientId: "client-a"
    });
    await manager.attach({
      anchorId: "anchor_task_1",
      paneName: "ccb_claude",
      clientId: "client-b"
    });
    const leaseEvents: unknown[] = [];
    first.emitter.on("lease_changed", (event) => leaseEvents.push(event));

    const granted = manager.requestWriterLease("anchor_task_1", "ccb_claude", "client-a");
    const denied = manager.requestWriterLease("anchor_task_1", "ccb_claude", "client-b");

    expect(granted).toMatchObject({
      granted: true,
      lease: { clientId: "client-a", since: expect.any(String) }
    });
    expect(denied).toMatchObject({
      granted: false,
      currentHolder: { clientId: "client-a", since: expect.any(String) }
    });
    expect(leaseEvents.at(-1)).toMatchObject({
      anchorId: "anchor_task_1",
      pane: "ccb_claude",
      hasWriter: true,
      holderClientId: "client-a",
      since: expect.any(String)
    });
    const readerAfterGrant = await manager.attach({
      anchorId: "anchor_task_1",
      paneName: "ccb_claude",
      clientId: "client-c"
    });
    expect(readerAfterGrant.descriptor.writer).toMatchObject({
      hasWriter: true,
      isYou: false,
      since: expect.any(String)
    });

    await expect(
      manager.applyInput({
        anchorId: "anchor_task_1",
        paneName: "ccb_claude",
        clientId: "client-b",
        remoteAddr: "127.0.0.1",
        data: "\u0003"
      })
    ).rejects.toMatchObject({ code: "WRITER_LEASE_REQUIRED" });

    await manager.applyInput({
      anchorId: "anchor_task_1",
      paneName: "ccb_claude",
      clientId: "client-a",
      remoteAddr: "127.0.0.1",
      data: "\u0003"
    });

    expect(sendKeysLiteral).toHaveBeenCalledWith(
      expect.objectContaining({ anchorPath: "/repo/realtime_translator-task-1" }),
      expect.objectContaining({ name: "ccb_claude" }),
      "\u0003"
    );
    expect(recordInput).toHaveBeenCalledWith({
      anchorId: "anchor_task_1",
      pane: "ccb_claude",
      clientId: "client-a",
      remoteAddr: "127.0.0.1",
      data: "\u0003"
    });

    expect(manager.releaseWriterLease("anchor_task_1", "ccb_claude", "client-b")).toBe(false);
    expect(manager.releaseWriterLease("anchor_task_1", "ccb_claude", "client-a")).toBe(true);
    expect(leaseEvents.at(-1)).toMatchObject({
      anchorId: "anchor_task_1",
      pane: "ccb_claude",
      hasWriter: false
    });
    expect(manager.requestWriterLease("anchor_task_1", "ccb_claude", "client-b")).toMatchObject({
      granted: true,
      lease: { clientId: "client-b", since: expect.any(String) }
    });

    manager.detach("anchor_task_1", "ccb_claude", "client-b");
    expect(leaseEvents.at(-1)).toMatchObject({
      anchorId: "anchor_task_1",
      pane: "ccb_claude",
      hasWriter: false
    });
  });
});
