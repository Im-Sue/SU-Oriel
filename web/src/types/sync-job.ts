export interface SyncJobView {
  id: string;
  projectId: string;
  jobType: string;
  status: string;
  processedCount: number;
  totalCount: number;
  startedAt: string;
  finishedAt: string | null;
  logSummary: string | null;
  errorMessage: string | null;
  updatedAt: string;
}
