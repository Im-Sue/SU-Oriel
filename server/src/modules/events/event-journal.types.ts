export const EVENT_STORE_SCHEMA_VERSION = "event-store-v0.1" as const;

export const EVENT_JOURNAL_ALLOWED_EVENT_TYPE = "codex_receipt_ready" as const;

export const EVENT_JOURNAL_EVENT_TYPES = [
  "codex_receipt_ready",
  "user_arbitration_submitted",
  "session_resumed",
  "state_write_conflict",
  "verification_finished",
  "batch_cancelled",
  "tool_call_denied",
  "codex_picked_up",
  "codex_rejected",
  "requirement_materialized",
  "subtask_planning_inherited",
  "anchor_dispatch_queued",
  "anchor_dispatch_submitted",
  "anchor_dispatch_failed",
  "slot_bound",
  "slot_released",
  "slot_queued_request",
  "slot_runtime_degraded",
  "slot_stale",
  "slot_recovered"
] as const;

export type EventJournalEventType = (typeof EVENT_JOURNAL_EVENT_TYPES)[number];

export interface CodexReceiptReadyPayload {
  receipt_ref: string;
  provider: string;
  receipt_summary: string;
  unsolicited_findings: unknown[];
  job_id?: string;
  reply_id?: string;
  spec_id?: string;
  status?: string;
  completed_at?: string;
}

export interface UserArbitrationSubmittedPayload {
  decision_ref: string;
  verdict: string;
  notes?: string;
  reentry_node?: "implementation" | "task_breakdown" | "technical_design" | "requirement_analysis";
}

export interface SessionResumedPayload {
  resume_source: string;
  waiting_ref: string;
  resumed_by: string;
}

export interface StateWriteConflictPayload {
  resource_type: string;
  expected_revision: number;
  actual_revision: number;
  writer: string;
  primitive: string;
}

export interface VerificationFinishedPayload {
  result: string;
  build: Record<string, unknown>;
  test: Record<string, unknown>;
  artifact_refs: string[];
}

export interface BatchCancelledPayload {
  reason: string;
  cancelled_by: string;
  affected_task_ids: string[];
}

export interface ToolCallDeniedPayload {
  tool: string;
  capability: string;
  reason: string;
  policy_profile: string;
}

export interface CodexPickedUpPayload {
  dispatch_id: string;
  agent_id: string;
  workspace_ref?: string;
}

export interface CodexRejectedPayload {
  reason: string;
  spec_path: string;
  diagnostics?: Record<string, unknown>;
}

export interface RequirementMaterializedPayload {
  requirement_id: string;
  subtask_count: number;
  plan_spec_path: string;
  draft_hash: string;
}

export interface SubtaskPlanningInheritedPayload {
  requirement_id: string;
  subtask_id: string;
  section_id: string;
  linked_spec_id: string;
}

export interface AnchorDispatchQueuedPayload {
  jobId: string;
  command: string;
  dispatchPayload?: Record<string, unknown>;
  step?: string;
}

export interface AnchorDispatchSubmittedPayload {
  jobId: string;
  traceRef?: string;
  readinessWarning?: boolean;
}

export interface AnchorDispatchFailedPayload {
  jobId: string;
  errorCode: string;
  errorMessage: string;
}

export interface SlotBoundPayload {
  slotId: string;
  requirementId: string;
  reason: "new_requirement" | "startup_recovery" | "manual_rebind";
}

export interface SlotReleasedPayload {
  slotId: string;
  requirementId: string;
  reason: "requirement_archived" | "manual_release" | "force_release";
  releasedBy: "system" | "user";
  operatorReason?: string | null;
}

export interface SlotQueuedRequestPayload {
  jobId: string;
  slotId?: string | null;
  command: string;
  dispatchPayload?: Record<string, unknown>;
  step?: string;
  reason: "no_idle_slot" | "sticky_slot_unavailable" | "slot_recovering";
}

export interface SlotRuntimeDegradedPayload {
  slotId: string;
  reason: "socket_lost" | "pane_dead" | "busy_timeout" | "provider_unready";
  severity: "warning" | "error";
}

export interface SlotStalePayload {
  requirementId: string;
  lastActivityAt: string;
  staleDays: number;
  policyVersion: string;
}

export interface SlotRecoveredPayload {
  slotId: string;
  recoveredAt: string;
  recoveryRef?: string;
}

export type EventJournalPayload =
  | CodexReceiptReadyPayload
  | UserArbitrationSubmittedPayload
  | SessionResumedPayload
  | StateWriteConflictPayload
  | VerificationFinishedPayload
  | BatchCancelledPayload
  | ToolCallDeniedPayload
  | CodexPickedUpPayload
  | CodexRejectedPayload
  | RequirementMaterializedPayload
  | SubtaskPlanningInheritedPayload
  | AnchorDispatchQueuedPayload
  | AnchorDispatchSubmittedPayload
  | AnchorDispatchFailedPayload
  | SlotBoundPayload
  | SlotReleasedPayload
  | SlotQueuedRequestPayload
  | SlotRuntimeDegradedPayload
  | SlotStalePayload
  | SlotRecoveredPayload;

export interface EventJournalView {
  id: string;
  eventId: string;
  eventType: EventJournalEventType;
  schemaVersion: typeof EVENT_STORE_SCHEMA_VERSION;
  projectId: string;
  subjectType: string;
  subjectId: string;
  subjectKey: string | null;
  taskId: string;
  taskKey: string | null;
  anchorId: string | null;
  slotId: string | null;
  payload: EventJournalPayload;
  emittedAt: string;
  sourceActor: string | null;
  sourceComponent: string | null;
  causationId: string | null;
  correlationId: string | null;
  stateRevisionSeen: number | null;
  idempotencyKey: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SubmitEventJournalResult {
  success: true;
  result: "created" | "already_recorded";
  idempotent: boolean;
  event: EventJournalView;
}

export interface ListEventJournalResult {
  items: EventJournalView[];
  pageInfo: {
    limit: number;
    offset: number;
    count: number;
  };
}

export interface TimelineProjectionEvent {
  kind: "event_projection";
  at: string;
  label: string;
  details: {
    eventId: string;
    eventType: EventJournalEventType;
    payloadPreview: string;
    projectionOnly: true;
  };
}
