import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { usePendingConsult } from "./usePendingConsult.js";
import type { ProjectionSignal } from "./useTaskEventStream.js";

const rawRequest = { id: "req-1", task_id: "task-1", task_key: "task-key", node_id: "technical_design", message: "Need help", target_agent: "ccb_codex", status: "pending", consult_round: null, created_by: "console_user", created_at: "2026-05-09T12:00:00.000Z", consumed_at: null };
const ok = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

describe("usePendingConsult", () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it("submits a consult request with x-ccb-token and stores the pending request", async () => {
    const fetchMock = vi.fn().mockResolvedValue(ok({ request: rawRequest }, 201));
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => usePendingConsult("task-1", "technical_design", { projectionSignal: null }));
    await act(async () => { await result.current.submit("Need help"); });
    expect(fetchMock).toHaveBeenCalledWith("/api/tasks/task-1/nodes/technical_design/consult-requests", expect.objectContaining({ method: "POST", headers: expect.objectContaining({ "x-ccb-token": "dev-token" }) }));
    expect(result.current.pending?.message).toBe("Need help");
  });

  it("cancels a pending consult request with x-ccb-token", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(ok({ request: rawRequest }, 201)).mockResolvedValueOnce(ok({ request: { ...rawRequest, status: "cancelled" } }));
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => usePendingConsult("task-1", "technical_design", { projectionSignal: null }));
    await act(async () => { await result.current.submit("Need help"); });
    await act(async () => { await result.current.cancel("req-1"); });
    expect(fetchMock).toHaveBeenLastCalledWith("/api/tasks/task-1/consult-requests/req-1", expect.objectContaining({ method: "DELETE", headers: expect.objectContaining({ "x-ccb-token": "dev-token" }) }));
    expect(result.current.pending).toBeNull();
  });

  it("maps 401 responses to an auth error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(ok({ error: "unauthorized" }, 401)));
    const { result } = renderHook(() => usePendingConsult("task-1", "technical_design", { projectionSignal: null }));
    await act(async () => { await result.current.submit("Need help"); });
    expect(result.current.submitError).toContain("x-ccb-token");
  });

  it("maps cross-node 409 responses to a node mismatch error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(ok({ error: "consult request node_id 与当前节点不匹配", code: "conflict" }, 409)));
    const { result } = renderHook(() => usePendingConsult("task-1", "technical_design", { projectionSignal: null }));
    await act(async () => { await result.current.submit("Need help"); });
    expect(result.current.submitError).toBe("当前节点已变化，请刷新后重试。");
  });

  it("maps pending-exists 409 responses to a pending conflict error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(ok({ error: "该任务已有 pending consult request", code: "conflict" }, 409)));
    const { result } = renderHook(() => usePendingConsult("task-1", "technical_design", { projectionSignal: null }));
    await act(async () => { await result.current.submit("Need help"); });
    expect(result.current.submitError).toBe("该任务已有 pending consult request，请等待或取消后再试。");
  });

  it("maps 429 responses to a rate limit error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(ok({ error: "rate limit exceeded", code: "rate_limited" }, 429)));
    const { result } = renderHook(() => usePendingConsult("task-1", "technical_design", { projectionSignal: null }));
    await act(async () => { await result.current.submit("Need help"); });
    expect(result.current.submitError).toBe("请求过于频繁，请 30 秒后重试。");
  });

  it("clears local pending state when consult_round_added arrives", async () => {
    const fetchMock = vi.fn().mockResolvedValue(ok({ request: rawRequest }, 201));
    vi.stubGlobal("fetch", fetchMock);
    const signal: ProjectionSignal = { kind: "consult_round_added", task_id: "task-1", emitted_at: "2026-05-09T12:00:01.000Z", payload: { consult_request_id: "req-1", round: "R1" } };
    const { result, rerender } = renderHook(({ projectionSignal }) => usePendingConsult("task-1", "technical_design", { projectionSignal }), { initialProps: { projectionSignal: null as ProjectionSignal | null } });
    await act(async () => { await result.current.submit("Need help"); });
    rerender({ projectionSignal: signal });
    await waitFor(() => expect(result.current.pending).toBeNull());
  });
});
