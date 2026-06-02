import { describe, expect, it, vi, afterEach } from "vitest";

import {
  approveBreakdownDraft,
  beginReview,
  cancelBreakdownDraft,
  createBreakdownDraft,
  materializeRequirement,
  rejectAndFeedback,
  updateBreakdownDraft
} from "../lib/breakdown-draft-api.js";

function okDispatch() {
  return new Response(JSON.stringify({ jobId: "job-1", anchorId: "anchor-1", status: "queued" }), {
    status: 202,
    headers: {
      "Content-Type": "application/json"
    }
  });
}

describe("breakdown-draft-api mutation helpers", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("dispatches create/update/delete/begin/approve to requirement anchor", async () => {
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(okDispatch()));
    vi.stubGlobal("fetch", fetchMock);

    await createBreakdownDraft("project-1", "req-1");
    await updateBreakdownDraft("project-1", "req-1", "a".repeat(64));
    await cancelBreakdownDraft("project-1", "req-1");
    await beginReview("project-1", "req-1");
    await approveBreakdownDraft("project-1", "req-1", "b".repeat(64));

    const endpoint = "/api/projects/project-1/requirements/req-1/anchor-dispatch";
    expect(fetchMock).toHaveBeenNthCalledWith(1, endpoint, expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ command: "su-flow", payload: { action: "breakdown_draft_create", step: "breakdown_draft" } })
    }));
    expect(fetchMock).toHaveBeenNthCalledWith(2, endpoint, expect.objectContaining({
      body: JSON.stringify({
        command: "su-flow",
        payload: { action: "breakdown_draft_update", expected_hash: "a".repeat(64), step: "breakdown_draft" }
      })
    }));
    expect(fetchMock).toHaveBeenNthCalledWith(3, endpoint, expect.objectContaining({
      body: JSON.stringify({ command: "su-cancel", payload: { action: "breakdown_draft_delete" } })
    }));
    expect(fetchMock).toHaveBeenNthCalledWith(4, endpoint, expect.objectContaining({
      body: JSON.stringify({ command: "su-flow", payload: { action: "breakdown_draft_begin_review", step: "breakdown_draft" } })
    }));
    expect(fetchMock).toHaveBeenNthCalledWith(5, endpoint, expect.objectContaining({
      body: JSON.stringify({
        command: "su-approve",
        payload: { action: "breakdown_draft_approve", expected_hash: "b".repeat(64) }
      })
    }));
  });

  it("dispatches reject feedback without calling the removed reject endpoint", async () => {
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(okDispatch()));
    vi.stubGlobal("fetch", fetchMock);

    await rejectAndFeedback("project-1", "req-1", "请重新拆分前后端任务，并合并重复 UI slice。", "c".repeat(64));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/projects/project-1/requirements/req-1/anchor-dispatch");
    const body = JSON.parse((init as RequestInit).body as string) as {
      command: string;
      payload: {
        action: string;
        expected_hash: string;
        feedback: {
          summary: string;
        };
      };
    };
    expect(body.command).toBe("su-revise-breakdown");
    expect(body.payload.action).toBe("breakdown_draft_reject");
    expect(body.payload.expected_hash).toBe("c".repeat(64));
    expect(body.payload.feedback).toEqual({ summary: "请重新拆分前后端任务，并合并重复 UI slice。" });
  });

  it("dispatches materialize through the requirement anchor instead of the removed materialize endpoint", async () => {
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(okDispatch()));
    vi.stubGlobal("fetch", fetchMock);

    await materializeRequirement("project-1", "req-1", "d".repeat(64));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/projects/project-1/requirements/req-1/anchor-dispatch");
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      command: "su-materialize-requirement",
      payload: {
        requirement_id: "req-1",
        expected_hash: "d".repeat(64)
      }
    });
  });
});
