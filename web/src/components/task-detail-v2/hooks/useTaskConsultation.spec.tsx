import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { snakeToCamelConsultRound, useTaskConsultation } from "./useTaskConsultation.js";

class MockEventSource extends EventTarget {
  static instances: MockEventSource[] = [];
  close = vi.fn();
  constructor(public url: string) { super(); MockEventSource.instances.push(this); }
  projection(data: unknown) { this.dispatchEvent(new MessageEvent("projection", { data: JSON.stringify(data) })); }
}

const rawRecord = { round: "R1", layer: "technical_design", input_summary: "Clarify scope", codex_reply: { recommendation: "Ship it" }, unsolicited_findings: [], stop_reason: "converged", timestamp: "2026-05-09T12:00:00.000Z" };
const ok = (records = [rawRecord]) => new Response(JSON.stringify({ task_id: "task-1", consult_records: records, count: records.length }), { status: 200, headers: { "Content-Type": "application/json" } });

describe("useTaskConsultation", () => {
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); MockEventSource.instances = []; localStorage.clear(); });

  it("fetches consult records from the dedicated endpoint", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(ok()));
    const { result } = renderHook(() => useTaskConsultation("task-1", { pollingMs: 0, projectionSignal: null }));
    await waitFor(() => expect(result.current.rounds[0]?.inputSummary).toBe("Clarify scope"));
    expect(fetch).toHaveBeenCalledWith("/api/tasks/task-1/consult-records");
  });

  it("maps snake_case consult_records into camelCase rounds", () => {
    expect(snakeToCamelConsultRound(rawRecord)).toMatchObject({ round: "R1", nodeId: "technical_design", inputSummary: "Clarify scope", stopReason: "converged" });
  });

  it("refetch reloads records on demand", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(ok([])).mockResolvedValueOnce(ok());
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useTaskConsultation("task-1", { pollingMs: 0, projectionSignal: null }));
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => { await result.current.refetch(); });
    expect(result.current.rounds).toHaveLength(1);
  });

  it("refetches when consult_round_added arrives on the projection channel", async () => {
    vi.stubGlobal("EventSource", MockEventSource);
    const fetchMock = vi.fn().mockResolvedValueOnce(ok([])).mockResolvedValueOnce(ok());
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useTaskConsultation("task-1", { pollingMs: 0 }));
    await waitFor(() => expect(result.current.loading).toBe(false));
    act(() => MockEventSource.instances[0].projection({ kind: "consult_round_added", task_id: "task-1", emitted_at: "2026-05-09T12:00:01.000Z", payload: { round: "R1" } }));
    await waitFor(() => expect(result.current.rounds).toHaveLength(1));
  });

  it("polls while mounted", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(ok()));
    renderHook(() => useTaskConsultation("task-1", { pollingMs: 20, projectionSignal: null }));
    await act(async () => { await vi.advanceTimersByTimeAsync(45); });
    expect(fetch).toHaveBeenCalledTimes(3);
  });
});
