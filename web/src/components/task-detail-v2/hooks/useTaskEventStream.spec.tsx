import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useProjectionChannel } from "./useProjectionChannel.js";
import { lastEventIdKey, useTaskEventStream } from "./useTaskEventStream.js";

class MockEventSource extends EventTarget {
  static instances: MockEventSource[] = [];
  url: string;
  close = vi.fn();
  constructor(url: string) { super(); this.url = url; MockEventSource.instances.push(this); }
  open() { this.dispatchEvent(new Event("open")); }
  msg(data: unknown) { this.dispatchEvent(new MessageEvent("message", { data: JSON.stringify(data) })); }
  projection(data: unknown) { this.dispatchEvent(new MessageEvent("projection", { data: JSON.stringify(data) })); }
  fail(status?: number) { this.dispatchEvent(Object.assign(new Event("error"), { status })); }
}

const event = { event_id: "event-1", event_type: "codex_picked_up", emitted_at: "2026-05-08T12:00:00.000Z", payload: { node_id: "implementation" } };

describe("useTaskEventStream", () => {
  beforeEach(() => { localStorage.clear(); });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); localStorage.clear(); MockEventSource.instances = []; });

  it("opens a native EventSource and reports open status", async () => {
    vi.stubGlobal("EventSource", MockEventSource);
    const { result } = renderHook(() => useTaskEventStream("task-1", { fallbackAfterMs: 0 }));
    act(() => MockEventSource.instances[0].open());
    await waitFor(() => expect(result.current.status).toBe("open"));
    expect(MockEventSource.instances[0].url).toBe("/api/tasks/task-1/events");
  });

  it("receives events and stores lastEventId", async () => {
    vi.stubGlobal("EventSource", MockEventSource);
    const { result } = renderHook(() => useTaskEventStream("task-1", { fallbackAfterMs: 0 }));
    act(() => MockEventSource.instances[0].msg(event));
    await waitFor(() => expect(result.current.events[0]?.event_id).toBe("event-1"));
    expect(localStorage.getItem(lastEventIdKey("task-1"))).toBe("event-1");
  });

  it("resumes with the stored Last-Event-ID cursor as since query", () => {
    localStorage.setItem(lastEventIdKey("task-1"), "event-0");
    vi.stubGlobal("EventSource", MockEventSource);
    renderHook(() => useTaskEventStream("task-1", { fallbackAfterMs: 0 }));
    expect(MockEventSource.instances[0].url).toContain("since=event-0");
  });

  it("clears an unknown cursor on 410 Gone and reconnects", async () => {
    vi.useFakeTimers();
    localStorage.setItem(lastEventIdKey("task-1"), "missing");
    vi.stubGlobal("EventSource", MockEventSource);
    renderHook(() => useTaskEventStream("task-1", { fallbackAfterMs: 0 }));
    act(() => MockEventSource.instances[0].fail(410));
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(localStorage.getItem(lastEventIdKey("task-1"))).toBeNull();
    expect(MockEventSource.instances.at(-1)?.url).toBe("/api/tasks/task-1/events");
  });

  it("falls back to 5s polling when the stream is idle", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("EventSource", MockEventSource);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ events: [{ kind: "state", at: "2026-05-08T12:00:01.000Z", label: "State", details: { node_id: "review" } }] }), { status: 200, headers: { "Content-Type": "application/json" } })));
    const { result } = renderHook(() => useTaskEventStream("task-1", { fallbackAfterMs: 20, pollingIntervalMs: 20 }));
    await act(async () => { await vi.advanceTimersByTimeAsync(45); });
    expect(result.current.events[0]?.event_type).toBe("state");
  });

  it("shares one EventSource across stream subscribers and closes after the last unmount", async () => {
    vi.stubGlobal("EventSource", MockEventSource);
    const first = renderHook(() => useTaskEventStream("task-1", { fallbackAfterMs: 0 }));
    const second = renderHook(() => useTaskEventStream("task-1", { fallbackAfterMs: 0 }));

    expect(MockEventSource.instances).toHaveLength(1);
    act(() => MockEventSource.instances[0].msg(event));
    await waitFor(() => expect(first.result.current.events[0]?.event_id).toBe("event-1"));
    await waitFor(() => expect(second.result.current.events[0]?.event_id).toBe("event-1"));

    first.unmount();
    expect(MockEventSource.instances[0].close).not.toHaveBeenCalled();
    second.unmount();
    expect(MockEventSource.instances[0].close).toHaveBeenCalledTimes(1);
  });

  it("shares one EventSource between timeline and projection subscribers", async () => {
    vi.stubGlobal("EventSource", MockEventSource);
    const stream = renderHook(() => useTaskEventStream("task-1", { fallbackAfterMs: 0 }));
    const projection = renderHook(() => useProjectionChannel("task-1"));

    expect(MockEventSource.instances).toHaveLength(1);
    act(() => {
      MockEventSource.instances[0].msg(event);
      MockEventSource.instances[0].projection({ kind: "consult_round_added", task_id: "task-1", emitted_at: "2026-05-09T12:00:00.000Z", payload: { round: "R1" } });
    });

    await waitFor(() => expect(stream.result.current.events[0]?.event_id).toBe("event-1"));
    await waitFor(() => expect(projection.result.current.latest?.kind).toBe("consult_round_added"));
  });
});
