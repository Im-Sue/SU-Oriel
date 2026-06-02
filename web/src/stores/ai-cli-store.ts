import { create } from "zustand";

import {
  createAiCliSession,
  deleteAiCliRecording,
  deleteAiCliSession,
  deleteAiCliSetting,
  fetchAiCliRecordings,
  fetchAiCliSessions,
  fetchAiCliSettings,
  fetchAiCliTools,
  launchAiCliExternal,
  upsertAiCliSetting,
  AiCliApiError
} from "../lib/ai-cli-api.js";
import type {
  AiCliLaunchMode,
  AiCliLaunchResult,
  AiCliSettingView,
  AiCliToolId,
  AiCliToolView,
  CreateSessionResult,
  PtySessionDescriptorView,
  RecordingMetaView
} from "../types/ai-cli.js";

const MODE_STORAGE_KEY = "ai-cli.mode.v1";
const LAYOUT_STORAGE_KEY = "ai-cli.layout.v1";

export type EmbeddedLayout = "tabs" | "cols-2" | "cols-3";

function readStoredMode(): AiCliLaunchMode {
  if (typeof window === "undefined") {
    return "external";
  }
  try {
    const value = window.localStorage.getItem(MODE_STORAGE_KEY);
    if (value === "external" || value === "embedded") {
      return value;
    }
  } catch {
    // localStorage 不可用时按 external 兜底
  }
  return "external";
}

function persistMode(mode: AiCliLaunchMode): void {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.localStorage.setItem(MODE_STORAGE_KEY, mode);
  } catch {
    // 忽略隐私模式下的写入失败
  }
}

function readStoredLayout(): EmbeddedLayout {
  if (typeof window === "undefined") {
    return "cols-2";
  }
  try {
    const value = window.localStorage.getItem(LAYOUT_STORAGE_KEY);
    if (value === "tabs" || value === "cols-2" || value === "cols-3") {
      return value;
    }
  } catch {
    // ignore
  }
  return "cols-2";
}

function persistLayout(layout: EmbeddedLayout): void {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.localStorage.setItem(LAYOUT_STORAGE_KEY, layout);
  } catch {
    // ignore
  }
}

interface AiCliStoreState {
  tools: AiCliToolView[];
  settings: AiCliSettingView[];
  mode: AiCliLaunchMode;
  layout: EmbeddedLayout;
  loadingTools: boolean;
  loadingSettings: boolean;
  launchingToolId: AiCliToolId | null;
  sessions: PtySessionDescriptorView[];
  activeSessionId: string | null;
  loadingSessions: boolean;
  recordings: RecordingMetaView[];
  loadingRecordings: boolean;
  setMode: (mode: AiCliLaunchMode) => void;
  setLayout: (layout: EmbeddedLayout) => void;
  loadTools: (projectId: string | null) => Promise<void>;
  loadSettings: () => Promise<void>;
  launchExternal: (toolId: AiCliToolId, projectId: string | null) => Promise<AiCliLaunchResult>;
  saveSetting: (input: {
    scope: "global" | "project";
    projectId: string | null;
    toolId: AiCliToolId;
    command: string | null;
    extraArgs: string[];
    defaultMode: AiCliLaunchMode | null;
  }) => Promise<void>;
  removeSetting: (input: {
    scope: "global" | "project";
    projectId: string | null;
    toolId: AiCliToolId;
  }) => Promise<void>;
  loadSessions: () => Promise<void>;
  setActiveSession: (sessionId: string | null) => void;
  createSession: (input: {
    toolId: AiCliToolId;
    projectId: string | null;
    cols?: number;
    rows?: number;
  }) => Promise<CreateSessionResult>;
  closeSession: (sessionId: string) => Promise<void>;
  loadRecordings: () => Promise<void>;
  removeRecording: (id: string) => Promise<void>;
}

export const useAiCliStore = create<AiCliStoreState>()((set, get) => ({
  tools: [],
  settings: [],
  mode: readStoredMode(),
  layout: readStoredLayout(),
  loadingTools: false,
  loadingSettings: false,
  launchingToolId: null,
  sessions: [],
  activeSessionId: null,
  loadingSessions: false,
  recordings: [],
  loadingRecordings: false,
  setMode: (mode) => {
    persistMode(mode);
    set({ mode });
  },
  setLayout: (layout) => {
    persistLayout(layout);
    set({ layout });
  },
  loadTools: async (projectId) => {
    set({ loadingTools: true });
    try {
      const items = await fetchAiCliTools(projectId);
      set({ tools: items });
    } finally {
      set({ loadingTools: false });
    }
  },
  loadSettings: async () => {
    set({ loadingSettings: true });
    try {
      const items = await fetchAiCliSettings();
      set({ settings: items });
    } finally {
      set({ loadingSettings: false });
    }
  },
  launchExternal: async (toolId, projectId) => {
    set({ launchingToolId: toolId });
    try {
      return await launchAiCliExternal({ toolId, projectId });
    } finally {
      set({ launchingToolId: null });
    }
  },
  saveSetting: async (input) => {
    await upsertAiCliSetting(input);
    await Promise.all([get().loadSettings(), get().loadTools(input.projectId)]);
  },
  removeSetting: async (input) => {
    await deleteAiCliSetting(input);
    await Promise.all([get().loadSettings(), get().loadTools(input.projectId)]);
  },
  loadSessions: async () => {
    set({ loadingSessions: true });
    try {
      const sessions = await fetchAiCliSessions();
      set((state) => ({
        sessions,
        // 如果当前 active session 已经不存在了，回退到第一条 running
        activeSessionId:
          state.activeSessionId && sessions.some((session) => session.id === state.activeSessionId)
            ? state.activeSessionId
            : sessions.find((session) => session.status !== "exited")?.id ?? null
      }));
    } finally {
      set({ loadingSessions: false });
    }
  },
  setActiveSession: (sessionId) => {
    set({ activeSessionId: sessionId });
  },
  createSession: async (input) => {
    const result = await createAiCliSession({ ...input, shellWrap: true, record: true });
    set((state) => ({
      sessions: [...state.sessions.filter((session) => session.id !== result.descriptor.id), result.descriptor],
      activeSessionId: result.descriptor.id
    }));
    return result;
  },
  closeSession: async (sessionId) => {
    try {
      await deleteAiCliSession(sessionId);
    } catch {
      // 后端 404 / 已退出的也算关闭成功
    }
    set((state) => {
      const remaining = state.sessions.filter((session) => session.id !== sessionId);
      const nextActive =
        state.activeSessionId === sessionId
          ? remaining.find((session) => session.status !== "exited")?.id ?? null
          : state.activeSessionId;
      return { sessions: remaining, activeSessionId: nextActive };
    });
  },
  loadRecordings: async () => {
    set({ loadingRecordings: true });
    try {
      const recordings = await fetchAiCliRecordings();
      set({ recordings });
    } finally {
      set({ loadingRecordings: false });
    }
  },
  removeRecording: async (id) => {
    await deleteAiCliRecording(id);
    set((state) => ({ recordings: state.recordings.filter((item) => item.id !== id) }));
  }
}));

export { AiCliApiError };
