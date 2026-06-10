export interface ProjectView {
  id: string;
  name: string;
  localPath: string;
  summary: string | null;
  initStatus: "not_initialized" | "initialized" | "error";
  syncStatus: "idle" | "running" | "scanning" | "failed" | "partial";
  lastScanAt: string | null;
}

export interface ProjectScanStatusView {
  projectId: string;
  projectSyncStatus: ProjectView["syncStatus"];
  status: string;
  processedCount: number;
  totalCount: number;
  errorMessage: string | null;
  jobId: string | null;
  updatedAt: string | null;
  phase: string | null;
  phaseStatus: string | null;
  phaseJobId: string | null;
  phaseErrorMessage: string | null;
}

export interface ProjectIndexHealthView {
  projectId: string;
  lastScanAt: string | null;
  documentCount: number;
  taskCount: number;
  requirementCount: number;
  parseFailureCount: number;
  partialParseCount: number;
  freshness: boolean;
}

export interface ProjectOnboardingStatusView {
  projectId: string;
  localPath: string;
  ccbRuntimeReady: boolean;
  knowledgeBaseReady: boolean;
  ccbConfigPath: string;
  knowledgeBaseRootPath: string;
  manualCommand: string;
  checkedAt: string;
}

export interface ProjectKnowledgeBaseInitResponse {
  jobId: string;
  claudeAgentName: string;
  submittedAt: string;
}

export interface ProjectInitJobStatusView {
  jobId: string;
  status: "queued" | "running" | "completed" | "failed";
  reason?: string;
  updatedAt: string;
}

export interface CreateProjectFormValue {
  name: string;
  localPath: string;
  summary: string;
}
