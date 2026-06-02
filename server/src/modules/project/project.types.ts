export type ProjectInitStatus = "not_initialized" | "initialized" | "error";
export type ProjectSyncStatus = "idle" | "running" | "scanning" | "failed" | "partial";

export interface ProjectRecord {
  id: string;
  name: string;
  localPath: string;
  summary: string | null;
  initStatus: ProjectInitStatus;
  docsRoot: string | null;
  lastScanAt: string | null;
  syncStatus: ProjectSyncStatus;
  ownerUserId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateProjectInput {
  name: string;
  localPath: string;
  summary?: string;
}

export interface ProjectStore {
  list(): Promise<ProjectRecord[]>;
  create(input: CreateProjectInput): Promise<ProjectRecord>;
}
