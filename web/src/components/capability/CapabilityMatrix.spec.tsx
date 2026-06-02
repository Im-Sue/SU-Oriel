import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { CapabilityMatrix } from "./CapabilityMatrix.js";

describe("CapabilityMatrix", () => {
  it("maps resolved, fallback, missing and skip cells to visible grid states", () => {
    render(
      <CapabilityMatrix
        nodes={["requirement_analysis", "technical_design", "review", "archive"]}
        capabilities={[
          { id: "governance.escalation", label: "Escalation", criticality: "critical" },
          { id: "analysis.deep", label: "Deep analysis" }
        ]}
        cells={[
          {
            nodeId: "requirement_analysis",
            capabilityId: "governance.escalation",
            status: "resolved",
            tooltip: "provider: codex"
          },
          {
            nodeId: "technical_design",
            capabilityId: "governance.escalation",
            status: "fallback",
            tooltip: "fallback: claude_native"
          },
          {
            nodeId: "review",
            capabilityId: "governance.escalation",
            status: "missing",
            tooltip: "missing blocking"
          },
          {
            nodeId: "archive",
            capabilityId: "governance.escalation",
            status: "skip",
            tooltip: "not required"
          }
        ]}
      />
    );

    expect(screen.getByTestId("capability-cell-requirement_analysis-governance.escalation")).toHaveAttribute(
      "data-status",
      "resolved"
    );
    expect(screen.getByTestId("capability-cell-technical_design-governance.escalation")).toHaveAttribute(
      "data-status",
      "fallback"
    );
    expect(screen.getByTestId("capability-cell-review-governance.escalation")).toHaveAttribute(
      "data-status",
      "missing"
    );
    expect(screen.getByTestId("capability-cell-archive-governance.escalation")).toHaveAttribute("data-status", "skip");
    expect(screen.getByLabelText("Escalation at requirement_analysis: provider: codex")).toBeInTheDocument();
  });
});
