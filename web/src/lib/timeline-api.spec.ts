import { afterEach, describe, expect, it, vi } from "vitest";

import { fetchTaskTimeline } from "./timeline-api.js";

describe("fetchTaskTimeline", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("normalizes missing events to an empty array", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ taskId: "task-1", hasMore: false }), {
          status: 200,
          statusText: "OK",
          headers: { "Content-Type": "application/json" }
        })
      )
    );

    await expect(fetchTaskTimeline("task-1")).resolves.toEqual({
      taskId: "task-1",
      events: [],
      hasMore: false
    });
  });
});
