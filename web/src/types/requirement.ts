export interface RequirementView {
  id: string;
  projectId: string;
  title: string;
  description: string;
  status: string;
  source: string;
  outputMode: "requirement_only";
  splitMode?: "direct_pr";
  generatedTaskId: string | null;
  verbatimSource: string | null;
  claudeInterpretation: string | null;
  ambiguities: string | null;
  fidelityDiff: string | null;
  analysisInputHash: string | null;
  analysisStaleAt: string | null;
  currentPlanningNode?: string | null;
  currentPlanningStep?: "analysis" | "design" | "breakdown_draft" | "ready_to_materialize" | string | null;
  planningSubstate?: string | null;
  planningRuntimeState?: "idle" | "running" | "blocked" | "failed" | string | null;
  lastPlanningTransitionId?: string | null;
  planRevision?: number;
  planDocPath?: string | null;
  breakdownDraftPath?: string | null;
  planningAnchorId?: string | null;
  rollupProgress?: number;
  rollupStatus?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface RequirementDetailView extends RequirementView {
  /** md 文件内容 sha256 hex；当 md 文件缺失时为 null（编辑禁用） */
  mdHash: string | null;
}

export interface RequirementEditInput {
  title?: string;
  description?: string;
  changeReason?: string;
  expectedMdHash: string;
}

export interface RequirementReanalyzeStartResponse {
  jobId: string;
  job_id?: string;
  status: "pending";
  requirementId?: string;
  anchorTaskId?: string;
  anchorId?: string;
}

export interface RequirementReanalyzeJobStatus {
  status: "pending" | "running" | "completed" | "failed" | "timeout";
  error?: string;
}

export interface RequirementReindexIssue {
  path: string;
  reason: string;
  detail?: string;
}

export interface RequirementReindexResponse {
  reindexed: boolean;
  deduped: boolean;
  status: "success" | "partial";
  projectId: string;
  requirementId: string;
  issues: RequirementReindexIssue[];
}

export const EDITABLE_REQUIREMENT_STATUSES = new Set(["drafting", "planning", "delivering", "deferred"]);

export function isRequirementEditable(status: string): boolean {
  return EDITABLE_REQUIREMENT_STATUSES.has(status);
}

export interface RequirementFormValue {
  title: string;
  description: string;
  outputMode: "requirement_only";
  splitMode?: "direct_pr";
  assetTmpUuid?: string;
  verbatimSource: string;
  claudeInterpretation: string;
  ambiguities: string;
  fidelityDiff: string;
}
