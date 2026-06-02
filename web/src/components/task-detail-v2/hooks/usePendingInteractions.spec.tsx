import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { snakeToCamelPendingInteraction, usePendingInteractions } from "./usePendingInteractions.js";

const payload = { task_id: "task-1", count: 1, pending: [{ id: "p1", kind: "review_intent" as const, source_table: "ReviewIntent", node_id: "review", summary: "Check", cta_label: "Review", cta_action: "open:p1", created_at: "2026-05-08T12:00:00.000Z", raw_ref: "review_intent:p1" }] };
const ok = (body = payload) => new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });

describe("usePendingInteractions", () => {
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

  it("fetches pending interactions and maps snake_case to camelCase", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(ok()));
    const { result } = renderHook(() => usePendingInteractions("task-1", { pollingMs: 0 }));
    await waitFor(() => expect(result.current.data[0]?.ctaLabel).toBe("Review"));
    expect(result.current.data[0]).toMatchObject({ sourceTable: "ReviewIntent", nodeId: "review", ctaAction: "open:p1" });
  });

  it("exports the snakeToCamelPendingInteraction adapter", () => {
    expect(snakeToCamelPendingInteraction(payload.pending[0]).createdAt).toBe("2026-05-08T12:00:00.000Z");
  });

  it("refetch reloads data on demand", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(ok({ task_id: "task-1", count: 0, pending: [] })).mockResolvedValueOnce(ok());
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => usePendingInteractions("task-1", { pollingMs: 0 }));
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => { await result.current.refetch(); });
    expect(result.current.data).toHaveLength(1);
  });

  it("surfaces fetch errors", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("nope", { status: 500 })));
    const { result } = renderHook(() => usePendingInteractions("task-1", { pollingMs: 0 }));
    await waitFor(() => expect(result.current.error).toBe("加载 pending interactions 失败"));
  });

  it("polls while mounted", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockResolvedValue(ok());
    vi.stubGlobal("fetch", fetchMock);
    renderHook(() => usePendingInteractions("task-1", { pollingMs: 20 }));
    await act(async () => { await vi.advanceTimersByTimeAsync(45); });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
