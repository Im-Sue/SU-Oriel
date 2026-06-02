export type NodeId =
  | "requirement_analysis"
  | "technical_design"
  | "task_breakdown"
  | "dispatch"
  | "implementation"
  | "review"
  | "archive";

export type NodeStatus = "done" | "in_progress" | "blocked" | "pending" | "idle" | "archive";

export interface PendingInteraction {
  id?: string;
  kind: "consult_reply" | "review_intent" | "approval" | "approval_record" | "pending_user_decision";
  nodeId: string;
  sourceTable?: string;
  summary: string;
  cta?: string;
  ctaLabel?: string;
  ctaAction?: string;
  createdAt?: string;
  rawRef?: string;
}

export interface TaskDetailNode {
  id: NodeId;
  label: string;
  status: NodeStatus;
}

export interface NodeDetail extends TaskDetailNode {
  substate?: string;
  lastTransitionAt?: string;
}

export interface TaskEvent {
  id: string;
  type: string;
  emittedAt: string;
  nodeId?: string;
  summary?: string;
}

export interface TaskCheckpointSummary {
  id: string;
  taskId: string;
  taskKey: string;
  transitionId: string;
  nodeBefore: string | null;
  nodeAfter: string | null;
  stateRevisionAfter: number;
  stateHash: string;
  snapshotPath: string | null;
  createdAt: string;
}

export interface TaskCheckpointDetail extends TaskCheckpointSummary {
  snapshot: Record<string, unknown> | null;
}
