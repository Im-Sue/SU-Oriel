import { afterEach, describe, expect, it, vi } from "vitest";

import { fetchTaskNodeFlow } from "./use-task-node-flow.js";

const ok = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" }
  });

describe("fetchTaskNodeFlow", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("normalizes applicability without parsing guard_reason for an apply event id", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        ok({
          currentNode: "implementation",
          nodeSubstate: "receipt_ready",
          runtimeState: "running",
          lastTransitionId: null,
          lastTransitionAt: null,
          transitions: [],
          applicable_actions: [
            {
              transition_id: "implementation__on_receipt_ready__to__review",
              label: "进入评审",
              guard_status: "satisfied",
              guard_reason: "codex_receipt_ready event available",
              applicability: "system_only"
            }
          ]
        })
      )
    );

    const flow = await fetchTaskNodeFlow("task-1");

    expect(fetch).toHaveBeenCalledWith("/api/tasks/task-1/node-flow");
    expect(flow.applicableActions).toEqual([
      {
        transitionId: "implementation__on_receipt_ready__to__review",
        label: "进入评审",
        guardStatus: "satisfied",
        guardReason: "codex_receipt_ready event available",
        applicability: "system_only"
      }
    ]);
  });
});
