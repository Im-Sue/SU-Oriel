import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CheckpointsListDrawer } from "./CheckpointsListDrawer.js";

const checkpointRows = [
  {
    id: "cp-1",
    taskId: "task-1",
    taskKey: "task-key",
    transitionId: "implementation__done",
    nodeBefore: "dispatch",
    nodeAfter: "implementation",
    stateRevisionAfter: 2,
    stateHash: "abcdef123456",
    snapshotPath: null,
    createdAt: "2026-05-10T00:00:00.000Z"
  }
];

const ok = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" }
  });

describe("CheckpointsListDrawer", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("does not fetch checkpoints while the drawer is closed", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockResolvedValue(ok(checkpointRows));
    vi.stubGlobal("fetch", fetchMock);

    render(<CheckpointsListDrawer isOpen={false} onClose={vi.fn()} onSelect={vi.fn()} taskId="task-1" />);
    await act(async () => {});

    expect(fetchMock).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(30_000);
    });

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fetches checkpoints when open and polls every 30 seconds", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockResolvedValue(ok(checkpointRows));
    vi.stubGlobal("fetch", fetchMock);

    render(<CheckpointsListDrawer isOpen={true} onClose={vi.fn()} onSelect={vi.fn()} taskId="task-1" />);
    await act(async () => {});

    expect(fetchMock).toHaveBeenCalledWith("/api/tasks/task-1/checkpoints");
    expect(screen.getByRole("dialog", { name: "检查点" })).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      vi.advanceTimersByTime(30_000);
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenLastCalledWith("/api/tasks/task-1/checkpoints");
  });
});
