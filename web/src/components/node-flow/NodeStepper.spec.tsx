import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { NodeStepper } from "./NodeStepper.js";

const canonicalNodes = [
  { id: "requirement_analysis", label: "Req" },
  { id: "technical_design", label: "Design" },
  { id: "task_breakdown", label: "Breakdown" },
  { id: "dispatch", label: "Dispatch" },
  { id: "implementation", label: "Implement" },
  { id: "review", label: "Review" },
  { id: "archive", label: "Archive" }
];

describe("NodeStepper", () => {
  it("highlights the current node and keeps the projection read-only", () => {
    render(
      <NodeStepper
        nodes={canonicalNodes}
        currentNodeId="technical_design"
        substate="drafting"
        transitions={[
          { source: "requirement_analysis", target: "technical_design", verdict: "pass" },
          { source: "technical_design", target: "task_breakdown", verdict: "blocked" }
        ]}
      />
    );

    const currentNode = screen.getByTestId("node-stepper-node-technical_design");
    expect(currentNode).toHaveAttribute("data-state", "current");
    expect(currentNode.getAttribute("class")).toBeTruthy();
    expect(screen.getByText("Substate: drafting")).toBeInTheDocument();
    expect(screen.getByTestId("node-stepper-transition-technical_design-task_breakdown")).toHaveAttribute(
      "data-verdict",
      "blocked"
    );
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(currentNode).not.toHaveAttribute("draggable");
  });
});
