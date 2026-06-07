import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  archiveSlot,
  cancelSlotCurrentJob,
  confirmProjectCcbdRestore,
  fetchProjectCcbdStatus,
  fetchSlots,
  releaseSlot,
  renewSlot,
  resizeSlots,
  type ProjectCcbdStatusView,
  type SlotLaneView,
  type SlotProjectionView,
  type SlotResizeResponse
} from "../../lib/console-api.js";
import { useProjectStore } from "../../stores/project-store.js";
import { useUIStore } from "../../stores/ui-store.js";
import { SlotsPage } from "./SlotsPage.js";

vi.mock("../../lib/console-api.js", () => ({
  archiveSlot: vi.fn(),
  cancelSlotCurrentJob: vi.fn(),
  confirmProjectCcbdRestore: vi.fn(),
  fetchProjectCcbdStatus: vi.fn(),
  fetchSlots: vi.fn(),
  releaseSlot: vi.fn(),
  renewSlot: vi.fn(),
  resizeSlots: vi.fn()
}));

function slot(slotId: string, overrides: Partial<SlotLaneView> = {}): SlotLaneView {
  return {
    slotId,
    state: "idle",
    requirement: null,
    boundAt: null,
    busySince: null,
    lastActivityAt: null,
    stale: null,
    unhealthy: null,
    queued: [],
    ...overrides
  };
}

const projection: SlotProjectionView = {
  project: { id: "project-1", name: "SU-CCB", slotCount: 3 },
  slotCount: 3,
  main: { slotId: "main", lane: "coordination", state: "available", canBindBusiness: false },
  slots: [
    slot("slot-1", {
      state: "bound",
      requirement: { id: "req-1", title: "Bound Requirement" },
      lastActivityAt: "2026-05-20T00:00:00.000Z"
    }),
    slot("slot-2", {
      state: "busy",
      requirement: { id: "req-2", title: "Busy Requirement" },
      busySince: "2026-05-21T00:00:00.000Z"
    }),
    slot("slot-3", {
      state: "unhealthy",
      requirement: { id: "req-3", title: "Unhealthy Requirement" },
      stale: { detectedAt: "2026-05-18T00:00:00.000Z", notifiedCount: 1 },
      unhealthy: { degradedReason: "busy_timeout", severity: "error", emittedAt: "2026-05-21T04:00:00.000Z" }
    })
  ],
  queue: [
    {
      jobId: "job-queued-1",
      slotId: null,
      subjectType: "requirement",
      subjectId: "req-queued",
      requirementId: "req-queued",
      requirementTitle: "Queued Requirement",
      title: "Queued Requirement",
      command: "/ccb:su-flow --payload {}",
      queuedAt: "2026-05-22T00:00:00.000Z"
    }
  ],
  shrinkEligibility: {
    projectId: "project-1",
    slotCount: 3,
    tailSlotId: "slot-3",
    canShrink: true,
    eligible: false,
    checks: {
      slotBindingIdle: false,
      queueClear: true,
      runtimeIdle: true
    },
    reasons: ["slot_not_idle"],
    details: {}
  },
  generatedAt: "2026-05-22T00:00:00.000Z"
};

function topologyProjection(slotCount: number): SlotProjectionView {
  return {
    ...projection,
    project: { ...projection.project, slotCount },
    slotCount,
    slots: Array.from({ length: slotCount }, (_, index) => slot(`slot-${index + 1}`)),
    queue: [],
    shrinkEligibility: {
      projectId: "project-1",
      slotCount,
      tailSlotId: `slot-${slotCount}`,
      canShrink: slotCount > 1,
      eligible: true,
      checks: { slotBindingIdle: true, queueClear: true, runtimeIdle: true },
      reasons: [],
      details: {}
    }
  };
}

const fourSlotProjection = topologyProjection(4);
const sixSlotProjection = topologyProjection(6);

const projectCcbdReady: ProjectCcbdStatusView = {
  projectId: "project-1",
  projectRoot: "/tmp/su-ccb",
  socketPath: "/tmp/su-ccb/.ccb/ccbd/ccbd.sock",
  tmuxSocketPath: "/tmp/su-ccb/.ccb/ccbd/tmux.sock",
  startupBlocked: false,
  config: {
    path: "/tmp/su-ccb/.ccb/ccb.config",
    exists: true,
    coreSignature: "sig",
    drift: null
  }
};

function primeProject() {
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

describe("SlotsPage", () => {
  beforeEach(() => {
    primeProject();
    vi.mocked(fetchSlots).mockResolvedValue(projection);
    vi.mocked(releaseSlot).mockResolvedValue({ ...projection, slot: slot("slot-1") });
    vi.mocked(fetchProjectCcbdStatus).mockResolvedValue(projectCcbdReady);
    vi.mocked(confirmProjectCcbdRestore).mockResolvedValue({
      runtime: { status: "ready" },
      status: projectCcbdReady
    });
    vi.mocked(renewSlot).mockResolvedValue({ ...projection, slot: slot("slot-3", { state: "bound" }) });
    vi.mocked(archiveSlot).mockResolvedValue({
      jobId: "job-archive",
      slotId: "slot-3",
      requirementId: "req-3",
      status: "queued",
      queuedAt: "2026-05-22T00:00:00.000Z"
    });
    vi.mocked(cancelSlotCurrentJob).mockResolvedValue({
      ...projection,
      slot: slot("slot-3", { state: "bound" }),
      cancelledJobId: "job-current"
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    useProjectStore.setState({ projects: [], selectedProjectId: null });
    useUIStore.setState({ toasts: [] });
  });

  function lastToastMessage(): string | null {
    const toasts = useUIStore.getState().toasts;
    return toasts.length > 0 ? toasts[toasts.length - 1]!.message : null;
  }

  it("renders main lane, three slot rows, bound requirement, queue, and health badges", async () => {
    render(
      <MemoryRouter>
        <SlotsPage />
      </MemoryRouter>
    );

    expect(fetchSlots).toHaveBeenCalledWith("project-1");
    expect(await screen.findByText("main")).toBeInTheDocument();
    expect(screen.getByText("协调通道")).toBeInTheDocument();
    expect(screen.getAllByTestId("slot-row")).toHaveLength(3);
    expect(screen.getByText("Bound Requirement")).toBeInTheDocument();
    expect(screen.getByText("Queued Requirement")).toBeInTheDocument();
    expect(screen.getByText("stale")).toBeInTheDocument();
    expect(screen.getByText("unhealthy")).toBeInTheDocument();
  });

  it("requires force confirmation text and reason before releasing a busy slot", async () => {
    render(
      <MemoryRouter>
        <SlotsPage />
      </MemoryRouter>
    );

    const forceButton = await screen.findByRole("button", { name: /强制释放 slot-2/ });
    fireEvent.click(forceButton);

    fireEvent.click(screen.getByRole("button", { name: "确认强制释放" }));
    expect(releaseSlot).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText("强制释放原因"), {
      target: { value: "busy timeout confirmed" }
    });
    fireEvent.change(screen.getByLabelText("确认文本"), {
      target: { value: "RELEASE slot-2" }
    });
    fireEvent.click(screen.getByRole("button", { name: "确认强制释放" }));

    await waitFor(() =>
      expect(releaseSlot).toHaveBeenCalledWith("project-1", "slot-2", {
        confirm: true,
        force: true,
        reason: "busy timeout confirmed"
      })
    );
  });

  it("shows project ccbd drift and confirms managed config restore", async () => {
    vi.mocked(fetchProjectCcbdStatus).mockResolvedValueOnce({
      ...projectCcbdReady,
      startupBlocked: true,
      config: {
        ...projectCcbdReady.config,
        drift: {
          kind: "core_drift",
          diff: '+ main = "main_claude:claude; main_codex:codex"',
          requiresUserConfirmation: true
        }
      }
    }).mockResolvedValue(projectCcbdReady);

    render(
      <MemoryRouter>
        <SlotsPage />
      </MemoryRouter>
    );

    expect(await screen.findByText("Project ccbd 启动已阻断")).toBeInTheDocument();
    expect(screen.getByText(/\+ main = "main_claude:claude; main_codex:codex"/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "确认恢复并启动" }));

    await waitFor(() => expect(confirmProjectCcbdRestore).toHaveBeenCalledWith("project-1"));
    expect(fetchProjectCcbdStatus).toHaveBeenCalledTimes(2);
  });

  it("offers stale renew, release, and archive actions", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);

    render(
      <MemoryRouter>
        <SlotsPage />
      </MemoryRouter>
    );

    await screen.findByText("Unhealthy Requirement");
    fireEvent.click(screen.getByRole("button", { name: "续期 slot-3" }));
    await waitFor(() => expect(renewSlot).toHaveBeenCalledWith("project-1", "slot-3"));

    fireEvent.click(screen.getByRole("button", { name: "归档 slot-3" }));
    await waitFor(() => expect(archiveSlot).toHaveBeenCalledWith("project-1", "slot-3", { confirm: true }));
  });

  it("offers unhealthy cancel, wait, and force release actions", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);

    render(
      <MemoryRouter>
        <SlotsPage />
      </MemoryRouter>
    );

    await screen.findByText("Unhealthy Requirement");
    fireEvent.click(screen.getByRole("button", { name: "取消当前 job slot-3" }));
    await waitFor(() => expect(cancelSlotCurrentJob).toHaveBeenCalledWith("project-1", "slot-3", { confirm: true }));

    fireEvent.click(screen.getByRole("button", { name: "等待 slot-3" }));
    expect(await screen.findByText("已保留 slot-3，等待下一次检测或人工处理")).toBeInTheDocument();

    expect(screen.getByRole("button", { name: /强制释放 slot-3/ })).toBeInTheDocument();
  });

  it("renders four dynamic slot lanes with topology-aware subtitle", async () => {
    vi.mocked(fetchSlots).mockResolvedValue(fourSlotProjection);

    render(
      <MemoryRouter>
        <SlotsPage />
      </MemoryRouter>
    );

    expect(await screen.findByText("main")).toBeInTheDocument();
    expect(screen.getAllByTestId("slot-row")).toHaveLength(4);
    expect(screen.getByTestId("slot-count")).toHaveTextContent("4 个 slot");
    expect(screen.getByText(/slot-1 到 slot-4 承载 requirement/)).toBeInTheDocument();
    expect(screen.queryByTestId("slot-resource-hint")).not.toBeInTheDocument();
  });

  it("grows directly from the + control and reports the new topology", async () => {
    const grown: SlotResizeResponse = {
      ...fourSlotProjection,
      resize: {
        ok: true,
        direction: "grow",
        mode: "reloaded",
        projectId: "project-1",
        previousSlotCount: 3,
        nextSlotCount: 4,
        reload: null,
        reset: null
      }
    };
    vi.mocked(resizeSlots).mockResolvedValue(grown);

    render(
      <MemoryRouter>
        <SlotsPage />
      </MemoryRouter>
    );

    await screen.findByText("main");
    fireEvent.click(screen.getByRole("button", { name: "扩容" }));

    await waitFor(() => expect(resizeSlots).toHaveBeenCalledWith("project-1", { direction: "grow" }));
    await waitFor(() => expect(screen.getAllByTestId("slot-row")).toHaveLength(4));
    expect(lastToastMessage()).toBe("已扩容至 4 个 slot，slot-4 已就绪");
  });

  it("opens the shrink confirmation dialog with tail slot and three eligibility checks", async () => {
    render(
      <MemoryRouter>
        <SlotsPage />
      </MemoryRouter>
    );

    await screen.findByText("main");
    fireEvent.click(screen.getByRole("button", { name: "缩容" }));

    expect(await screen.findByText("缩容确认：回收 slot-3")).toBeInTheDocument();
    const checklist = screen.getByRole("list", { name: "缩容资格检查" });
    expect(checklist).toHaveTextContent("绑定空闲");
    expect(checklist).toHaveTextContent("队列清空");
    expect(checklist).toHaveTextContent("运行时空闲");
    expect(screen.getByText(/当前资格快照不满足/)).toHaveTextContent("尾部 slot 仍被 requirement 占用");

    vi.mocked(resizeSlots).mockResolvedValue({
      ...projection,
      resize: {
        ok: true,
        direction: "shrink",
        mode: "reloaded",
        projectId: "project-1",
        previousSlotCount: 3,
        nextSlotCount: 2,
        reload: null,
        reset: null
      }
    });
    fireEvent.click(screen.getByRole("button", { name: "确认缩容" }));
    await waitFor(() => expect(resizeSlots).toHaveBeenCalledWith("project-1", { direction: "shrink" }));
    expect(lastToastMessage()).toBe("已缩容至 2 个 slot");
  });

  it("surfaces structured shrink rejection including pending su-cancel queue rows", async () => {
    const apiError = Object.assign(new Error("调整 Slot 数量失败"), {
      status: 409,
      payload: {
        ok: false,
        direction: "shrink",
        projectId: "project-1",
        previousSlotCount: 3,
        reason: "queue_not_empty",
        details: {
          slotId: "slot-3",
          queueRows: [{ jobId: "job-9", status: "pending", command: "/ccb:su-cancel job_123" }]
        }
      }
    });
    vi.mocked(resizeSlots).mockRejectedValue(apiError);

    render(
      <MemoryRouter>
        <SlotsPage />
      </MemoryRouter>
    );

    await screen.findByText("main");
    fireEvent.click(screen.getByRole("button", { name: "缩容" }));
    fireEvent.click(await screen.findByRole("button", { name: "确认缩容" }));

    await waitFor(() =>
      expect(lastToastMessage()).toBe(
        "缩容失败：尾部 slot 队列未清空（队列中存在待执行的 su-cancel 取消指令，缩容已被阻断）"
      )
    );
  });

  it("reports resize lock wait timeout as a structured failure", async () => {
    const lockError = Object.assign(new Error("调整 Slot 数量失败"), {
      status: 409,
      payload: {
        code: "SLOT_RESIZE_LOCK_TIMEOUT",
        message: "slot resize lock wait timed out after 2000ms",
        projectId: "project-1",
        timeoutMs: 2000
      }
    });
    vi.mocked(resizeSlots).mockRejectedValue(lockError);

    render(
      <MemoryRouter>
        <SlotsPage />
      </MemoryRouter>
    );

    await screen.findByText("main");
    fireEvent.click(screen.getByRole("button", { name: "扩容" }));

    await waitFor(() =>
      expect(lastToastMessage()).toBe("扩容失败：resize 锁等待超时，存在并发拓扑变更，请稍后重试")
    );
  });

  it("shows the resource hint once slotCount exceeds five", async () => {
    vi.mocked(fetchSlots).mockResolvedValue(sixSlotProjection);

    render(
      <MemoryRouter>
        <SlotsPage />
      </MemoryRouter>
    );

    await screen.findByText("main");
    expect(screen.getByTestId("slot-resource-hint")).toHaveTextContent(
      "当前 6 个 slot：每个 slot 常驻 claude+codex 两个 agent 进程"
    );
  });
});
