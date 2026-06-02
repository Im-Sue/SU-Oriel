import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useTaskCheckpoint, useTaskCheckpoints } from "./useTaskCheckpoints.js";

const summary = { id: "cp1", taskId: "task-1", taskKey: "task-key", transitionId: "transition-123456", nodeBefore: "dispatch", nodeAfter: "implementation", stateRevisionAfter: 8, stateHash: "abcdef123456", snapshotPath: null, createdAt: "2026-05-09T00:00:00.000Z" };
const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });

describe("useTaskCheckpoints", () => {
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

  it("fetches checkpoint summaries for a task", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(ok([summary])));
    const { result } = renderHook(() => useTaskCheckpoints("task-1", { pollingMs: 0 }));
    await waitFor(() => expect(result.current.checkpoints[0]?.transitionId).toBe("transition-123456"));
    expect(fetch).toHaveBeenCalledWith("/api/tasks/task-1/checkpoints");
  });

  it("fetches a single checkpoint lazily by transition id", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(ok({ ...summary, snapshot: { currentNode: "implementation" } })));
    const { result } = renderHook(() => useTaskCheckpoint("task-1", "transition-123456"));
    await waitFor(() => expect(result.current.checkpoint?.snapshot?.currentNode).toBe("implementation"));
    expect(fetch).toHaveBeenCalledWith("/api/tasks/task-1/checkpoints/transition-123456");
  });

  it("exposes loading while a list request is in flight", async () => {
    let resolve!: (value: Response) => void;
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>((done) => { resolve = done; })));
    const { result } = renderHook(() => useTaskCheckpoints("task-1", { pollingMs: 0 }));
    await waitFor(() => expect(result.current.loading).toBe(true));
    await act(async () => { resolve(ok([])); });
    await waitFor(() => expect(result.current.loading).toBe(false));
  });

  it("surfaces fetch errors", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("nope", { status: 500 })));
    const { result } = renderHook(() => useTaskCheckpoints("task-1", { pollingMs: 0 }));
    await waitFor(() => expect(result.current.error).toBe("加载 checkpoints 失败"));
  });
});
