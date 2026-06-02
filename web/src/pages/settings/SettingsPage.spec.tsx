import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ProjectSettingsView } from "../../types/settings.js";
import { fetchProjectSettings, updateProjectSettings } from "../../lib/console-api.js";
import { useProjectStore } from "../../stores/project-store.js";
import { SettingsPage } from "./SettingsPage.js";

vi.mock("../../lib/console-api.js", () => ({
  fetchProjectSettings: vi.fn(),
  updateProjectSettings: vi.fn()
}));

const baselineSettings: ProjectSettingsView = {
  project_id: "project-1",
  scan_strategy: {
    enabled: true,
    paths: ["docs", "references"],
    exclude_patterns: ["node_modules", ".git"]
  },
  parsing_rules: {
    strict_frontmatter: true,
    allowed_categories: ["01", "04"]
  },
  path_config: {
    docs_root: "docs",
    kernel_ref: "references/kernel"
  },
  updated_at: "2026-05-03T00:00:00.000Z"
};

function primeSelectedProject() {
  useProjectStore.setState({
    projects: [
      {
        id: "project-1",
        name: "SU-CCB",
        localPath: "/tmp/su-ccb",
        summary: "test project",
        initStatus: "initialized",
        syncStatus: "idle",
        lastScanAt: null
      }
    ],
    selectedProjectId: "project-1"
  });
}

describe("SettingsPage", () => {
  beforeEach(() => {
    vi.mocked(fetchProjectSettings).mockResolvedValue(baselineSettings);
    vi.mocked(updateProjectSettings).mockResolvedValue(baselineSettings);
    primeSelectedProject();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    useProjectStore.setState({
      projects: [],
      selectedProjectId: null,
      documents: [],
      tasks: [],
      requirements: [],
      syncJobs: [],
      indexHealth: null,
      loadingProjects: false,
      loadingData: false,
      savingTask: false
    });
  });

  it("renders the three project settings fields from the GET response", async () => {
    render(<SettingsPage />);

    expect(await screen.findByLabelText("文件自动扫描")).toBeChecked();
    expect(await screen.findByLabelText(/扫描路径/)).toHaveValue("docs\nreferences");
    expect(screen.getByLabelText(/排除规则/)).toHaveValue("node_modules\n.git");
    expect(screen.getByLabelText(/允许分类/)).toHaveValue("01\n04");
    expect(screen.getByLabelText("Kernel 引用路径 path_config.kernel_ref")).toHaveValue("references/kernel");
    expect(fetchProjectSettings).toHaveBeenCalledWith("project-1");
  });

  it("submits the edited three-field form to the settings API", async () => {
    render(<SettingsPage />);

    const docsRootInput = await screen.findByLabelText("文档根目录 path_config.docs_root");
    fireEvent.click(screen.getByLabelText("文件自动扫描"));
    fireEvent.change(docsRootInput, {
      target: {
        value: "knowledge"
      }
    });
    fireEvent.click(screen.getByRole("button", { name: "保存设置" }));

    await waitFor(() => expect(updateProjectSettings).toHaveBeenCalledTimes(1));
    expect(updateProjectSettings).toHaveBeenCalledWith("project-1", {
      scan_strategy: {
        ...baselineSettings.scan_strategy,
        enabled: false
      },
      parsing_rules: baselineSettings.parsing_rules,
      path_config: {
        docs_root: "knowledge",
        kernel_ref: "references/kernel"
      }
    });
    expect(await screen.findByText("设置已保存")).toBeInTheDocument();
  });

  it("shows an error state when the GET request fails", async () => {
    vi.mocked(fetchProjectSettings).mockRejectedValue(new Error("加载设置失败"));

    render(<SettingsPage />);

    expect(await screen.findByText("加载设置失败")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "重试" })).toBeInTheDocument();
  });

  it("blocks submit when path_config validation fails", async () => {
    render(<SettingsPage />);

    const kernelRefInput = await screen.findByLabelText("Kernel 引用路径 path_config.kernel_ref");
    fireEvent.change(kernelRefInput, {
      target: {
        value: ""
      }
    });
    fireEvent.click(screen.getByRole("button", { name: "保存设置" }));

    expect(await screen.findByText("路径配置不能为空")).toBeInTheDocument();
    expect(updateProjectSettings).not.toHaveBeenCalled();
  });
});
