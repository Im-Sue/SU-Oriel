import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { TraceTimeline } from "./TraceTimeline.js";

describe("TraceTimeline", () => {
  it("renders event cards and expands payload preview on demand", () => {
    render(
      <TraceTimeline
        events={[
          {
            id: "event-1",
            sender: "claude",
            receiver: "codex",
            intent: "plan_review_request",
            score: 8.6,
            tokensIn: 2100,
            tokensOut: 400,
            at: "2026-05-04T09:45:12Z",
            payloadPreview: "请评估 E12 plan review round 4。"
          },
          {
            id: "event-2",
            sender: "codex",
            receiver: "claude",
            intent: "plan_review_reply",
            at: "2026-05-04T09:47:00Z",
            payloadPreview: "verdict: pass"
          },
          {
            id: "event-3",
            sender: "system",
            receiver: "all",
            intent: "transition.applied",
            at: "2026-05-04T09:48:00Z"
          }
        ]}
      />
    );

    expect(screen.getAllByTestId("trace-timeline-card")).toHaveLength(3);
    expect(screen.queryByText("请评估 E12 plan review round 4。")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "展开 plan_review_request" }));

    expect(screen.getByText("请评估 E12 plan review round 4。")).toBeInTheDocument();
    expect(screen.getByText("score 8.6")).toBeInTheDocument();
    expect(screen.getByText("tokens 2100 → 400")).toBeInTheDocument();
  });
});
