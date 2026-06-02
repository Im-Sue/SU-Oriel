import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CheckpointDrawer } from "./CheckpointDrawer.js";

const base = { id: "cp1", taskId: "task-1", taskKey: "task-key", transitionId: "transition-abcdef", nodeBefore: "dispatch", nodeAfter: "implementation", stateRevisionAfter: 9, stateHash: "abcdef1234567890", createdAt: "2026-05-09T00:00:00.000Z" };
const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });

describe("CheckpointDrawer", () => {
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

  it("renders inline checkpoint JSON", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(ok({ ...base, snapshotPath: null, snapshot: { currentNode: "implementation" } })));
    render(<CheckpointDrawer isOpen taskId="task-1" transitionId="transition-abcdef" onClose={vi.fn()} />);
    expect(await screen.findByText(/currentNode/)).toBeInTheDocument();
    expect(screen.getByText("abcdef12")).toBeInTheDocument();
  });

  it("shows pending snapshot copy and retries after 30 seconds", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockResolvedValue(ok({ ...base, snapshotPath: "pending:docs/.ccb/state/.checkpoints/task/cp.json", snapshot: null }));
    vi.stubGlobal("fetch", fetchMock);
    render(<CheckpointDrawer isOpen taskId="task-1" transitionId="transition-abcdef" onClose={vi.fn()} />);
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByText(/快照异步落盘中/)).toBeInTheDocument();
    await act(async () => { await vi.advanceTimersByTimeAsync(30000); });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("shows a filesystem placeholder for non-inline file snapshots", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(ok({ ...base, snapshotPath: "docs/.ccb/state/.checkpoints/task/cp.json", snapshot: null })));
    render(<CheckpointDrawer isOpen taskId="task-1" transitionId="transition-abcdef" onClose={vi.fn()} />);
    expect(await screen.findByText(/暂不支持预览/)).toBeInTheDocument();
    expect(screen.getByText("docs/.ccb/state/.checkpoints/task/cp.json")).toBeInTheDocument();
  });

  it("closes on Escape and outside click", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(ok({ ...base, snapshotPath: null, snapshot: {} })));
    const onClose = vi.fn();
    render(<CheckpointDrawer isOpen taskId="task-1" transitionId="transition-abcdef" onClose={onClose} />);
    await waitFor(() => expect(screen.getByRole("dialog")).toBeInTheDocument());
    fireEvent.keyDown(window, { key: "Escape" });
    fireEvent.mouseDown(screen.getByTestId("checkpoint-drawer-backdrop"));
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("marks the drawer as a modal dialog and focuses the close button on open", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(ok({ ...base, snapshotPath: null, snapshot: {} })));
    render(<CheckpointDrawer isOpen taskId="task-1" transitionId="transition-abcdef" onClose={vi.fn()} />);

    const dialog = await screen.findByRole("dialog", { name: "检查点详情" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    await waitFor(() => expect(screen.getByRole("button", { name: "关闭" })).toHaveFocus());
  });

  it("keeps Tab and Shift+Tab focus inside the drawer", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(ok({ ...base, snapshotPath: null, snapshot: {} })));
    render(<CheckpointDrawer isOpen taskId="task-1" transitionId="transition-abcdef" onClose={vi.fn()} />);
    const close = await screen.findByRole("button", { name: "关闭" });
    await waitFor(() => expect(close).toHaveFocus());

    fireEvent.keyDown(window, { key: "Tab" });
    expect(close).toHaveFocus();
    fireEvent.keyDown(window, { key: "Tab", shiftKey: true });
    expect(close).toHaveFocus();
  });

  it("returns focus to the previously active element after close", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(ok({ ...base, snapshotPath: null, snapshot: {} })));
    const opener = document.createElement("button");
    opener.textContent = "Open checkpoints";
    document.body.appendChild(opener);
    opener.focus();

    const { rerender } = render(<CheckpointDrawer isOpen taskId="task-1" transitionId="transition-abcdef" onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getByRole("button", { name: "关闭" })).toHaveFocus());
    rerender(<CheckpointDrawer isOpen={false} taskId="task-1" transitionId="transition-abcdef" onClose={vi.fn()} />);

    await waitFor(() => expect(opener).toHaveFocus());
    opener.remove();
  });
});
