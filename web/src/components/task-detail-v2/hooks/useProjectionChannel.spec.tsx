import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useProjectionChannel } from "./useProjectionChannel.js";

class MockEventSource extends EventTarget {
  static instances: MockEventSource[] = [];
  close = vi.fn();
  constructor(public url: string) { super(); MockEventSource.instances.push(this); }
  projection(data: unknown) { this.dispatchEvent(new MessageEvent("projection", { data: JSON.stringify(data) })); }
  msg(data: unknown) { this.dispatchEvent(new MessageEvent("message", { data: JSON.stringify(data) })); }
}

const signal = { kind: "interaction_pending_changed", task_id: "task-1", emitted_at: "2026-05-08T12:00:00.000Z", payload: { count: 1 } };

describe("useProjectionChannel", () => {
  afterEach(() => { vi.unstubAllGlobals(); MockEventSource.instances = []; });

  it("receives projection channel signals", async () => {
    vi.stubGlobal("EventSource", MockEventSource);
    const { result } = renderHook(() => useProjectionChannel("task-1"));
    act(() => MockEventSource.instances[0].projection(signal));
    await waitFor(() => expect(result.current.latest?.kind).toBe("interaction_pending_changed"));
  });

  it("filters projection signals by kind", async () => {
    vi.stubGlobal("EventSource", MockEventSource);
    const { result } = renderHook(() => useProjectionChannel("task-1"));
    act(() => {
      MockEventSource.instances[0].projection(signal);
      MockEventSource.instances[0].projection({ ...signal, kind: "checkpoint_added" });
    });
    await waitFor(() => expect(result.current.byKind("checkpoint_added")).toHaveLength(1));
  });

  it("ignores canonical event-store messages", async () => {
    vi.stubGlobal("EventSource", MockEventSource);
    const { result } = renderHook(() => useProjectionChannel("task-1"));
    act(() => MockEventSource.instances[0].msg({ event_id: "event-1", event_type: "codex_picked_up" }));
    expect(result.current.signals).toEqual([]);
  });
});
