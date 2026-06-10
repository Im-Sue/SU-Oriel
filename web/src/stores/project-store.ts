import { create } from "zustand";

import {
  createProject as createProjectRequest,
  createRequirement as createRequirementRequest,
  fetchDocuments,
  fetchProjectIndexHealth,
  fetchProjectOnboardingStatus,
  fetchProjects,
  fetchRequirements,
  fetchSyncJobs,
  fetchTasks,
  scanProject as scanProjectRequest,
  updateTask as updateTaskRequest
} from "../lib/console-api.js";
import type {
  CreateProjectFormValue,
  ProjectIndexHealthView,
  ProjectOnboardingStatusView,
  ProjectView
} from "../types/project.js";
import type { RequirementFormValue, RequirementView } from "../types/requirement.js";
import type { SyncJobView } from "../types/sync-job.js";
import type { TaskView, UpdateTaskInput } from "../types/task.js";
import type { DocumentView } from "../types/document.js";

const MISSING_PROJECT_MESSAGE = "项目不存在，请重新创建或选择项目";

const ONBOARDING_TTL_MS = 30_000;

export interface OnboardingEntry {
  value: ProjectOnboardingStatusView | null;
  fetchedAt: number;
  loading: boolean;
  error: string | null;
}

// 同一项目并发 ensureOnboarding 共享同一请求(in-flight 去重);Promise 不放进 store state(只存可序列化数据)。
const onboardingInflight = new Map<string, Promise<ProjectOnboardingStatusView | null>>();

interface ProjectStore {
  projects: ProjectView[];
  selectedProjectId: string | null;
  documents: DocumentView[];
  tasks: TaskView[];
  requirements: RequirementView[];
  syncJobs: SyncJobView[];
  indexHealth: ProjectIndexHealthView | null;
  onboardingByProject: Record<string, OnboardingEntry>;
  loadingProjects: boolean;
  loadingData: boolean;
  savingTask: boolean;
  loadProjects: () => Promise<void>;
  silentRefreshProjects: () => Promise<void>;
  syncSelectedProjectFromUrl: (id: string | null) => void;
  loadProjectData: (projectId: string) => Promise<void>;
  createProject: (input: CreateProjectFormValue) => Promise<ProjectView>;
  scanProject: () => Promise<void>;
  createRequirement: (input: RequirementFormValue) => Promise<RequirementView>;
  updateTask: (taskId: string, input: UpdateTaskInput) => Promise<TaskView>;
  ensureOnboarding: (projectId: string, options?: { force?: boolean }) => Promise<ProjectOnboardingStatusView | null>;
}

function resolveSelectedProjectId(projects: ProjectView[], selectedProjectId: string | null): string | null {
  if (selectedProjectId && projects.some((project) => project.id === selectedProjectId)) {
    return selectedProjectId;
  }
  return null;
}

function emptyProjectData() {
  return {
    documents: [],
    tasks: [],
    requirements: [],
    syncJobs: [],
    indexHealth: null
  };
}

export const useProjectStore = create<ProjectStore>()((set, get) => ({
  projects: [],
  selectedProjectId: null,
  documents: [],
  tasks: [],
  requirements: [],
  syncJobs: [],
  indexHealth: null,
  onboardingByProject: {},
  loadingProjects: false,
  loadingData: false,
  savingTask: false,
  loadProjects: async () => {
    set({ loadingProjects: true });
    try {
      const projects = await fetchProjects();
      set((state) => {
        const selectedProjectId = resolveSelectedProjectId(projects, state.selectedProjectId);
        return {
          projects,
          ...(selectedProjectId === state.selectedProjectId ? {} : emptyProjectData())
        };
      });
    } finally {
      set({ loadingProjects: false });
    }
  },
  // ADR-0012 后端可能在 file-watcher 触发后改 DB；前端无 push 通道，改用 silent refresh
  // 30s 轮询比对 lastScanAt。silent 表示不动 loadingProjects/loadingData，避免 UI 闪 skeleton。
  silentRefreshProjects: async () => {
    try {
      const projects = await fetchProjects();
      set((state) => {
        const selectedProjectId = resolveSelectedProjectId(projects, state.selectedProjectId);
        return {
          projects,
          ...(selectedProjectId === state.selectedProjectId ? {} : emptyProjectData())
        };
      });
    } catch {
      // polling 失败不打扰用户；下一次心跳会重试
    }
  },
  syncSelectedProjectFromUrl: (id) => {
    set({ selectedProjectId: id });
  },
  loadProjectData: async (projectId) => {
    set({ loadingData: true });
    try {
      const [documents, tasks, requirements, syncJobs, indexHealth] = await Promise.all([
        fetchDocuments(projectId),
        fetchTasks(projectId),
        fetchRequirements(projectId),
        fetchSyncJobs(projectId),
        fetchProjectIndexHealth(projectId)
      ]);
      set({ documents, tasks, requirements, syncJobs, indexHealth });
    } finally {
      set({ loadingData: false });
    }
  },
  createProject: async (input) => {
    const createdProject = await createProjectRequest(input);
    const projects = await fetchProjects();
    set({
      projects
    });
    return createdProject;
  },
  scanProject: async () => {
    const projectId = get().selectedProjectId;
    if (!projectId) {
      throw new Error("当前没有选中的项目");
    }
    if (!get().projects.some((project) => project.id === projectId)) {
      set(emptyProjectData());
      throw new Error(MISSING_PROJECT_MESSAGE);
    }

    await scanProjectRequest(projectId);
    set((state) => ({
      projects: state.projects.map((project) =>
        project.id === projectId ? { ...project, syncStatus: "scanning" } : project
      )
    }));
    await get().silentRefreshProjects();
  },
  createRequirement: async (input) => {
    const projectId = get().selectedProjectId;
    if (!projectId) {
      throw new Error("当前没有选中的项目");
    }

    const requirement = await createRequirementRequest(projectId, input);
    await get().loadProjectData(projectId);
    return requirement;
  },
  updateTask: async (taskId, input) => {
    set({ savingTask: true });
    try {
      const updatedTask = await updateTaskRequest(taskId, input);
      set((state) => ({
        tasks: state.tasks.map((task) => (task.id === taskId ? { ...task, ...updatedTask } : task))
      }));
      return updatedTask;
    } finally {
      set({ savingTask: false });
    }
  },
  // onboarding 接入状态单一数据源:导航门控、概览引导、banner 共读同一份。
  // loading / error / 未就绪一律由消费方按「未就绪」门控,不 fail-open。
  ensureOnboarding: async (projectId, options = {}) => {
    const { force = false } = options;
    const existing = get().onboardingByProject[projectId];
    if (!force && existing?.value && Date.now() - existing.fetchedAt <= ONBOARDING_TTL_MS) {
      return existing.value;
    }
    const inflight = onboardingInflight.get(projectId);
    if (inflight && !force) {
      return await inflight;
    }

    const request = (async (): Promise<ProjectOnboardingStatusView | null> => {
      set((state) => ({
        onboardingByProject: {
          ...state.onboardingByProject,
          [projectId]: {
            value: state.onboardingByProject[projectId]?.value ?? null,
            fetchedAt: state.onboardingByProject[projectId]?.fetchedAt ?? 0,
            loading: true,
            error: null
          }
        }
      }));
      try {
        const value = await fetchProjectOnboardingStatus(projectId);
        set((state) => ({
          onboardingByProject: {
            ...state.onboardingByProject,
            [projectId]: { value, fetchedAt: Date.now(), loading: false, error: null }
          }
        }));
        return value;
      } catch (error) {
        set((state) => ({
          onboardingByProject: {
            ...state.onboardingByProject,
            [projectId]: {
              value: state.onboardingByProject[projectId]?.value ?? null,
              fetchedAt: state.onboardingByProject[projectId]?.fetchedAt ?? 0,
              loading: false,
              error: error instanceof Error ? error.message : "加载项目接入状态失败"
            }
          }
        }));
        return null;
      } finally {
        onboardingInflight.delete(projectId);
      }
    })();

    onboardingInflight.set(projectId, request);
    return await request;
  }
}));
