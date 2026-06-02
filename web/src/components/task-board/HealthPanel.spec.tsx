import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useUIStore } from "../../stores/ui-store.js";
import { useProjectStore } from "../../stores/project-store.js";
import { HealthPanel } from "./HealthPanel.js";

vi.mock("../../lib/console-api.js", () => ({
  dispatchRequirementAnchorCommand: vi.fn(),
  dispatchTaskAnchorCommand: vi.fn()
}));

import * as consoleApi from "../../lib/console-api.js";

describe("HealthPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useUIStore.setState({ toasts: [] });
    useProjectStore.setState({
      documents: [
        {
          id: "doc-reconcile-1",
          projectId: "project-1",
          taskKey: null,
          path: "docs/.ccb/reconcile/2026-05/reconcile-20260522.md",
          kind: "other",
          title: "Reconcile 2026-05-22",
          status: null,
          summary: "2 drift detected",
          parseStatus: "success",
          mtime: "2026-05-22T10:00:00.000Z",
          updatedAt: "2026-05-22T10:00:00.000Z",
          governance: { tier: "生效中", requirementId: null, entityStatus: null, taskId: null, healthFlags: { parseError: false } }
        }
      ],
      requirements: [
        {
          id: "req-1",
          projectId: "project-1",
          title: "Req One",
          description: "Requirement",
          status: "planning",
          source: "manual",
          outputMode: "requirement_only",
          generatedTaskId: null,
          verbatimSource: null,
          claudeInterpretation: null,
          ambiguities: null,
          fidelityDiff: null,
          analysisInputHash: null,
          analysisStaleAt: null,
          createdAt: "2026-05-22T09:00:00.000Z",
          updatedAt: "2026-05-22T09:00:00.000Z"
        }
      ],
      tasks: []
    });
  });

  it("renders latest reconcile report and dispatches detect through anchor", async () => {
    vi.mocked(consoleApi.dispatchRequirementAnchorCommand).mockResolvedValue({
      jobId: "job-1",
      anchorId: "anchor-1",
      status: "pending"
    });

    render(<HealthPanel onTaskSelect={vi.fn()} projectId="project-1" />);

    fireEvent.click(await screen.findByRole("button", { name: /Reconcile 报告/ }));
    expect(screen.getByText("Reconcile 2026-05-22")).toBeInTheDocument();
    expect(screen.getByText("docs/.ccb/reconcile/2026-05/reconcile-20260522.md")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "生成 Reconcile 报告" }));

    await waitFor(() =>
      expect(consoleApi.dispatchRequirementAnchorCommand).toHaveBeenCalledWith("project-1", "req-1", {
        command: "su-reconcile",
        payload: {
          mode: "detect",
          scope: "project",
          source: "health-panel"
        }
      })
    );
  });
});
