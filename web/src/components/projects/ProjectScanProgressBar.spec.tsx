import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ProjectScanStatusView, ProjectView } from "../../types/project.js";

const silentRefreshProjects = vi.fn().mockResolvedValue(undefined);
const loadProjectData = vi.fn().mockResolvedValue(undefined);

vi.mock("../../lib/console-api.js", () => ({
  fetchProjectScanStatus: vi.fn()
}));

vi.mock("../../stores/project-store.js", () => ({
  useProjectStore: (selector: (state: unknown) => unknown) =>
    selector({ silentRefreshProjects, loadProjectData })
}));

import * as consoleApi from "../../lib/console-api.js";
import { ProjectScanProgressBar } from "./ProjectScanProgressBar.js";

function scanStatus(overrides: Partial<ProjectScanStatusView> = {}): ProjectScanStatusView {
  return {
    projectId: "project-1",
    projectSyncStatus: "scanning",
    status: "running",
    processedCount: 0,
    totalCount: 0,
    errorMessage: null,
    jobId: "job-1",
    updatedAt: null,
    phase: null,
    phaseStatus: null,
    phaseJobId: null,
    phaseErrorMessage: null,
    ...overrides
  };
}

const scanningProject = { id: "project-1", name: "Demo", syncStatus: "scanning" } as unknown as ProjectView;

describe("ProjectScanProgressBar (C+B 诚实进度)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllTimers();
  });

  it("scan 阶段且文件未跑满 → determinate 显示真实 x/y(且 <100%)", async () => {
    vi.mocked(consoleApi.fetchProjectScanStatus).mockResolvedValue(
      scanStatus({ phase: "scan", processedCount: 2, totalCount: 10 })
    );
    render(<ProjectScanProgressBar project={scanningProject} />);
    expect(await screen.findByText(/2\/10 · 20%/)).toBeInTheDocument();
    expect(screen.getByText(/扫描文档/)).toBeInTheDocument();
    // scanning 期间绝不出现 100%
    expect(screen.queryByText(/100%/)).not.toBeInTheDocument();
  });

  it("scan 阶段已跑满(processed==total)但仍 scanning → 切不定态,不显 100%", async () => {
    vi.mocked(consoleApi.fetchProjectScanStatus).mockResolvedValue(
      scanStatus({ phase: "scan", processedCount: 10, totalCount: 10 })
    );
    const { container } = render(<ProjectScanProgressBar project={scanningProject} />);
    await waitFor(() => {
      expect(container.querySelector('[data-indeterminate="true"]')).not.toBeNull();
    });
    expect(screen.queryByText(/100%/)).not.toBeInTheDocument();
  });

  it("后续阶段(如 reconcile) → 不定态 + 阶段中文标签,不显 100%", async () => {
    vi.mocked(consoleApi.fetchProjectScanStatus).mockResolvedValue(
      scanStatus({ phase: "reconcile", processedCount: 0, totalCount: 0 })
    );
    const { container } = render(<ProjectScanProgressBar project={scanningProject} />);
    expect(await screen.findByText(/归并任务/)).toBeInTheDocument();
    expect(container.querySelector('[data-indeterminate="true"]')).not.toBeNull();
    expect(screen.queryByText(/100%/)).not.toBeInTheDocument();
  });

  it("requirement_rollup 阶段 → 显示「汇总状态」(rollup 纳入扫描窗口)", async () => {
    vi.mocked(consoleApi.fetchProjectScanStatus).mockResolvedValue(
      scanStatus({ phase: "requirement_rollup" })
    );
    render(<ProjectScanProgressBar project={scanningProject} />);
    expect(await screen.findByText(/汇总状态/)).toBeInTheDocument();
  });

  it("真正终态(projectSyncStatus=idle) → 显示「扫描完成」", async () => {
    vi.mocked(consoleApi.fetchProjectScanStatus).mockResolvedValue(
      scanStatus({ projectSyncStatus: "idle", status: "success", phase: null, processedCount: 10, totalCount: 10 })
    );
    render(<ProjectScanProgressBar project={scanningProject} />);
    expect(await screen.findByText(/扫描完成/)).toBeInTheDocument();
  });

  it("phaseStatus=failed → 显示「扫描失败」+ phaseErrorMessage", async () => {
    vi.mocked(consoleApi.fetchProjectScanStatus).mockResolvedValue(
      scanStatus({
        phase: "requirement_rollup",
        phaseStatus: "failed",
        phaseErrorMessage: "rollup 失败：聚合异常"
      })
    );
    render(<ProjectScanProgressBar project={scanningProject} />);
    expect(await screen.findByText(/扫描失败/)).toBeInTheDocument();
    expect(await screen.findByText(/rollup 失败：聚合异常/)).toBeInTheDocument();
  });
});
