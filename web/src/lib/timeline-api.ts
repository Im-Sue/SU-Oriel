export type TaskEventKind =
  | "codex_picked_up"
  | "codex_receipt_ready"
  | "codex_rejected"
  | "user_arbitration_submitted"
  | "user_arbitration_required"
  | "session_resumed"
  | "verification_finished"
  | "batch_cancelled"
  | "state_write_conflict"
  | "tool_call_denied"
  | "epic_materialized"
  | "subtask_planning_inherited"
  | "review_intent_created"
  | "review_intent_consumed"
  | "review_intent_cancelled"
  | "transition_proposed"
  | "transition_applied"
  | "transition_ineligible"
  | "anchor_mounted"
  | "anchor_destroyed"
  | "anchor_recovering";

export type TaskEventSeverity = "info" | "attention" | "warning";

export interface TaskTimelineEvent {
  id: string;
  kind: TaskEventKind;
  source: string;
  at: string;
  title: string;
  severity: TaskEventSeverity;
  payload: Record<string, unknown>;
  traceRef?: string | null;
  anchorId?: string | null;
}

export interface TaskTimelineResult {
  taskId: string;
  events: TaskTimelineEvent[];
  hasMore: boolean;
}

export async function fetchTaskTimeline(taskId: string): Promise<TaskTimelineResult> {
  const response = await fetch(`/api/tasks/${encodeURIComponent(taskId)}/event-view`);
  if (!response.ok) {
    throw new Error(`时间线加载失败：${response.status} ${response.statusText}`);
  }
  const json = (await response.json()) as Partial<Omit<TaskTimelineResult, "events">> & {
    events?: unknown;
  };
  return {
    ...json,
    taskId: json.taskId ?? taskId,
    events: Array.isArray(json.events) ? (json.events as TaskTimelineEvent[]) : [],
    hasMore: json.hasMore ?? false
  };
}
