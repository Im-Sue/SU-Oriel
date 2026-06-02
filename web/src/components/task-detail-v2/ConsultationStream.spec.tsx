import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ConsultationStream } from "./ConsultationStream.js";

class MockEventSource extends EventTarget {
  static instances: MockEventSource[] = [];
  close = vi.fn();
  constructor(public url: string) { super(); MockEventSource.instances.push(this); }
  projection(data: unknown) { this.dispatchEvent(new MessageEvent("projection", { data: JSON.stringify(data) })); }
}

const record = { round: "R1", layer: "technical_design", input_summary: "Clarify scope", codex_reply: { recommendation: "Ship it" }, unsolicited_findings: [], stop_reason: "converged", timestamp: "2026-05-09T12:00:00.000Z" };
const pendingRequest = { id: "req-1", task_id: "task-1", task_key: "task-key", node_id: "technical_design", message: "Need another view", target_agent: "ccb_codex", status: "pending", consult_round: null, created_by: "console_user", created_at: "2026-05-09T12:00:00.000Z", consumed_at: null };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const records = (items: unknown[]) => json({ task_id: "task-1", consult_records: items, count: items.length });

describe("ConsultationStream", () => {
  afterEach(() => { vi.unstubAllGlobals(); MockEventSource.instances = []; localStorage.clear(); });

  it("renders historical consult records as Claude and Codex bubbles", async () => {
    vi.stubGlobal("EventSource", MockEventSource);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(records([record])));
    render(<ConsultationStream taskId="task-1" nodeId="technical_design" />);
    expect(await screen.findByText("Clarify scope")).toBeInTheDocument();
    expect(screen.getByText("Ship it")).toBeInTheDocument();
  });

  it("shows a user bubble and waiting placeholder after submit", async () => {
    vi.stubGlobal("EventSource", MockEventSource);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(records([])).mockResolvedValueOnce(json({ request: pendingRequest }, 201)));
    render(<ConsultationStream taskId="task-1" nodeId="technical_design" />);
    await screen.findByLabelText("Consult message");
    fireEvent.change(screen.getByLabelText("Consult message"), { target: { value: "Need another view" } });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Send consult" })); });
    expect(screen.getByText("Need another view")).toBeInTheDocument();
    expect(screen.getByText("等待 Codex 响应...")).toBeInTheDocument();
  });

  it("refetches and removes the pending placeholder after consult_round_added", async () => {
    vi.stubGlobal("EventSource", MockEventSource);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(records([])).mockResolvedValueOnce(json({ request: pendingRequest }, 201)).mockResolvedValueOnce(records([record])));
    render(<ConsultationStream taskId="task-1" nodeId="technical_design" />);
    await screen.findByLabelText("Consult message");
    fireEvent.change(screen.getByLabelText("Consult message"), { target: { value: "Need another view" } });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Send consult" })); });
    act(() => MockEventSource.instances[0].projection({ kind: "consult_round_added", task_id: "task-1", emitted_at: "2026-05-09T12:00:01.000Z", payload: { consult_request_id: "req-1", round: "R1" } }));
    expect(await screen.findByText("Ship it")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText("等待 Codex 响应...")).not.toBeInTheDocument());
  });

  it("renders an empty state for nodes that do not accept consult requests", () => {
    vi.stubGlobal("EventSource", MockEventSource);
    vi.stubGlobal("fetch", vi.fn());
    render(<ConsultationStream taskId="task-1" nodeId="review" />);
    expect(screen.getByText("该节点不接受 consult 请求")).toBeInTheDocument();
  });

  it("keeps the draft and shows an error bar when submit fails", async () => {
    vi.stubGlobal("EventSource", MockEventSource);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(records([])).mockResolvedValueOnce(json({ error: "rate limit exceeded", code: "rate_limited" }, 429)));
    render(<ConsultationStream taskId="task-1" nodeId="technical_design" />);
    const textarea = await screen.findByLabelText("Consult message");
    fireEvent.change(textarea, { target: { value: "Need another view" } });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Send consult" })); });
    expect(screen.getByRole("alert")).toHaveTextContent("请求过于频繁");
    expect(screen.getByLabelText("Consult message")).toHaveValue("Need another view");
  });

  it("cancels a pending request from the stream", async () => {
    vi.stubGlobal("EventSource", MockEventSource);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(records([])).mockResolvedValueOnce(json({ request: pendingRequest }, 201)).mockResolvedValueOnce(json({ request: { ...pendingRequest, status: "cancelled" } })));
    render(<ConsultationStream taskId="task-1" nodeId="technical_design" />);
    await screen.findByLabelText("Consult message");
    fireEvent.change(screen.getByLabelText("Consult message"), { target: { value: "Need another view" } });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Send consult" })); });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Cancel pending consult" })); });
    expect(screen.queryByText("等待 Codex 响应...")).not.toBeInTheDocument();
  });
});
