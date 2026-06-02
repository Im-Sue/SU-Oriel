export const TASK_RUN_STATUSES = [
  "pending",
  "dispatched",
  "running",
  "paused",
  "completed",
  "cancelled",
  "failed"
] as const;

export const TASK_RUN_TERMINAL_STATES = ["completed", "cancelled", "failed-terminal"] as const;

export type TaskRunStatus = (typeof TASK_RUN_STATUSES)[number];
export type TaskRunTerminalState = (typeof TASK_RUN_TERMINAL_STATES)[number];
export type TaskRunState = TaskRunStatus | TaskRunTerminalState;

export type TaskRunTransition = {
  from: TaskRunState;
  to: TaskRunState;
  reason: string;
  attemptChange: "same" | "increment";
};

export const TASK_RUN_ALLOWED_TRANSITIONS: TaskRunTransition[] = [
  { from: "pending", to: "dispatched", reason: "initial dispatch", attemptChange: "same" },
  { from: "dispatched", to: "running", reason: "worker accepted run", attemptChange: "same" },
  { from: "running", to: "paused", reason: "pause requested", attemptChange: "same" },
  { from: "paused", to: "running", reason: "resume requested", attemptChange: "same" },
  { from: "running", to: "completed", reason: "run completed", attemptChange: "same" },
  { from: "running", to: "failed", reason: "run failed and may retry", attemptChange: "same" },
  { from: "failed", to: "dispatched", reason: "retry dispatch", attemptChange: "increment" },
  { from: "pending", to: "cancelled", reason: "cancel before dispatch", attemptChange: "same" },
  { from: "dispatched", to: "cancelled", reason: "cancel before pickup", attemptChange: "same" },
  { from: "running", to: "cancelled", reason: "cancel active run", attemptChange: "same" },
  { from: "paused", to: "cancelled", reason: "cancel paused run", attemptChange: "same" },
  { from: "failed", to: "cancelled", reason: "cancel retryable failure", attemptChange: "same" },
  { from: "failed", to: "failed-terminal", reason: "max retry exhausted", attemptChange: "same" }
];

export function canTransitionTaskRun(from: TaskRunState, to: TaskRunState): boolean {
  if (TASK_RUN_TERMINAL_STATES.includes(from as TaskRunTerminalState)) {
    return false;
  }

  return TASK_RUN_ALLOWED_TRANSITIONS.some((transition) => transition.from === from && transition.to === to);
}

export function assertTaskRunTransition(from: TaskRunState, to: TaskRunState): void {
  if (!canTransitionTaskRun(from, to)) {
    throw new Error(`TaskRun transition not allowed: ${from} -> ${to}`);
  }
}
