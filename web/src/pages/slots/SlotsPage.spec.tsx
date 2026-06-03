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
  type ProjectCcbdStatusView,
  type SlotLaneView,
  type SlotProjectionView
} from "../../lib/console-api.js";
import { useProjectStore } from "../../stores/project-store.js";
import { SlotsPage } from "./SlotsPage.js";

vi.mock("../../lib/console-api.js", () => ({
  archiveSlot: vi.fn(),
  cancelSlotCurrentJob: vi.fn(),
  confirmProjectCcbdRestore: vi.fn(),
  fetchProjectCcbdStatus: vi.fn(),
  fetchSlots: vi.fn(),
  releaseSlot: vi.fn(),
  renewSlot: vi.fn()
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
  project: { id: "project-1", name: "SU-CCB" },
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
  generatedAt: "2026-05-22T00:00:00.000Z"
};

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
  });

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
});
