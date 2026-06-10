import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./console-api.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./console-api.js")>()),
  fetchProjectOnboardingStatus: vi.fn()
}));

import * as consoleApi from "./console-api.js";
import type { ProjectOnboardingStatusView } from "../types/project.js";
import { useProjectStore } from "../stores/project-store.js";
import { useUIStore } from "../stores/ui-store.js";
import { useProjectOnboardingGate } from "./use-project-onboarding-gate.js";

const fetchStatus = vi.mocked(consoleApi.fetchProjectOnboardingStatus);

function status(overrides: Partial<ProjectOnboardingStatusView> = {}): ProjectOnboardingStatusView {
  return {
    projectId: "p1",
    localPath: "/tmp/p1",
    ccbRuntimeReady: true,
    knowledgeBaseReady: true,
    ccbConfigPath: "/tmp/p1/.ccb/ccb.config",
    knowledgeBaseRootPath: "/tmp/p1/docs/.ccb/index",
    manualCommand: "cd /tmp/p1 && ccb",
    checkedAt: "2026-06-10T00:00:00.000Z",
    ...overrides
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  useProjectStore.setState({ onboardingByProject: {} });
  useUIStore.setState({ modalOpen: false, modalType: null, onboardingRequiredProjectId: null });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("ensureOnboarding", () => {
  it("dedupes concurrent requests for the same project (single fetch)", async () => {
    let resolve!: (v: ProjectOnboardingStatusView) => void;
    fetchStatus.mockReturnValue(new Promise<ProjectOnboardingStatusView>((r) => { resolve = r; }));
    const ensure = useProjectStore.getState().ensureOnboarding;
    const p1 = ensure("p1");
    const p2 = ensure("p1");
    resolve(status());
    await Promise.all([p1, p2]);
    expect(fetchStatus).toHaveBeenCalledTimes(1);
  });

  it("serves from cache within TTL and refetches when forced", async () => {
    fetchStatus.mockResolvedValue(status());
    const ensure = useProjectStore.getState().ensureOnboarding;
    await ensure("p1");
    await ensure("p1");
    expect(fetchStatus).toHaveBeenCalledTimes(1);
    await ensure("p1", { force: true });
    expect(fetchStatus).toHaveBeenCalledTimes(2);
  });

  it("records error without throwing, keeping value null and loading false (no fail-open)", async () => {
    fetchStatus.mockRejectedValue(new Error("boom"));
    const result = await useProjectStore.getState().ensureOnboarding("p1");
    expect(result).toBeNull();
    const entry = useProjectStore.getState().onboardingByProject.p1;
    expect(entry.error).toBe("boom");
    expect(entry.value).toBeNull();
    expect(entry.loading).toBe(false);
  });
});

describe("useProjectOnboardingGate", () => {
  it("ready=true only when both flags green", async () => {
    fetchStatus.mockResolvedValue(status({ ccbRuntimeReady: true, knowledgeBaseReady: true }));
    const { result } = renderHook(() => useProjectOnboardingGate("p1"));
    expect(result.current.ready).toBe(false); // initial: not loaded → locked
    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current.loading).toBe(false);
  });

  it("locked (ready=false) when only ccb runtime ready", async () => {
    fetchStatus.mockResolvedValue(status({ ccbRuntimeReady: true, knowledgeBaseReady: false }));
    const { result } = renderHook(() => useProjectOnboardingGate("p2"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.ready).toBe(false);
  });

  it("locked + error surfaced on fetch failure (no fail-open)", async () => {
    fetchStatus.mockRejectedValue(new Error("offline"));
    const { result } = renderHook(() => useProjectOnboardingGate("p4"));
    await waitFor(() => expect(result.current.error).toBe("offline"));
    expect(result.current.ready).toBe(false);
  });

  it("requireInit opens onboarding-required modal anchored to the projectId", async () => {
    fetchStatus.mockResolvedValue(status({ knowledgeBaseReady: false }));
    const { result } = renderHook(() => useProjectOnboardingGate("p3"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    act(() => result.current.requireInit());
    const ui = useUIStore.getState();
    expect(ui.modalType).toBe("onboarding-required");
    expect(ui.onboardingRequiredProjectId).toBe("p3");
    expect(ui.modalOpen).toBe(true);
  });
});
