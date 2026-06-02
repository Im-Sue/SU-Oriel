export type TaskEventSource =
  | "event_journal"
  | "review_intent"
  | "event_consumption"
  | "slot_allocation";

export type TaskEventKind =
  // EventJournal 9 种
  | "codex_picked_up"
  | "codex_receipt_ready"
  | "codex_rejected"
  | "user_arbitration_submitted"
  | "session_resumed"
  | "verification_finished"
  | "batch_cancelled"
  | "state_write_conflict"
  | "tool_call_denied"
  | "requirement_materialized"
  | "subtask_planning_inherited"
  // ReviewIntent
  | "review_intent_created"
  | "review_intent_consumed"
  | "review_intent_cancelled"
  | "user_arbitration_required"
  // transition
  | "transition_proposed"
  | "transition_applied"
  | "transition_ineligible"
  // anchor lifecycle (TA4 · cross-anchor-timeline)
  | "anchor_mounted"
  | "anchor_destroyed"
  | "anchor_recovering";

export interface TaskEventView {
  id: string;
  kind: TaskEventKind;
  source: TaskEventSource;
  at: string; // ISO timestamp
  title: string;
  severity: "info" | "attention" | "warning";
  payload: Record<string, unknown>;
  traceRef?: string | null;
  /** TA4: 标识事件所属 anchor；主 anchor 默认 null */
  anchorId?: string | null;
}

export interface TaskTimelineResult {
  taskId: string;
  events: TaskEventView[];
  // 是否还有可加载（v0.5 全量返回，未来分页可启用）
  hasMore: boolean;
}
