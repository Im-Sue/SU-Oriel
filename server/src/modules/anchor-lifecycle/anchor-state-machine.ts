export const ANCHOR_ALLOCATION_STATES = [
  "planned",
  "worktree_creating",
  "configuring",
  "mounting",
  "ready",
  "busy",
  "archiving",
  "destroyed",
  "mount_failed",
  "recovering",
  "orphaned",
  "cleanup_required"
] as const;

export type AnchorAllocationState = (typeof ANCHOR_ALLOCATION_STATES)[number];

export const ANCHOR_TERMINAL_STATES = ["destroyed"] as const;

export type AnchorTerminalState = (typeof ANCHOR_TERMINAL_STATES)[number];

export type AnchorTransition = {
  from: AnchorAllocationState;
  to: AnchorAllocationState;
  reason: string;
};

export const ANCHOR_ALLOWED_TRANSITIONS: AnchorTransition[] = [
  { from: "planned", to: "worktree_creating", reason: "create worktree" },
  { from: "worktree_creating", to: "configuring", reason: "worktree created" },
  { from: "configuring", to: "mounting", reason: "anchor config written" },
  { from: "mounting", to: "ready", reason: "ccbd socket ready" },
  { from: "ready", to: "busy", reason: "subtask started" },
  { from: "ready", to: "archiving", reason: "archive idle anchor" },
  { from: "archiving", to: "destroyed", reason: "anchor destroyed" },
  { from: "mount_failed", to: "recovering", reason: "retry mount" },
  { from: "orphaned", to: "recovering", reason: "reattach orphan" },
  { from: "recovering", to: "mounting", reason: "restart ccbd" },
  { from: "cleanup_required", to: "archiving", reason: "explicit cleanup" },
  { from: "worktree_creating", to: "cleanup_required", reason: "worktree failed" },
  { from: "configuring", to: "cleanup_required", reason: "config failed" },
  { from: "mounting", to: "mount_failed", reason: "ccbd mount failed" },
  { from: "ready", to: "orphaned", reason: "console lost anchor ownership" },
  { from: "busy", to: "orphaned", reason: "console lost active anchor ownership" },
  { from: "busy", to: "cleanup_required", reason: "active anchor cleanup required" }
];

export function canTransitionAnchor(from: AnchorAllocationState, to: AnchorAllocationState): boolean {
  if (ANCHOR_TERMINAL_STATES.includes(from as AnchorTerminalState)) {
    return false;
  }

  return ANCHOR_ALLOWED_TRANSITIONS.some((transition) => transition.from === from && transition.to === to);
}

export function assertAnchorTransition(from: AnchorAllocationState, to: AnchorAllocationState): void {
  if (!canTransitionAnchor(from, to)) {
    throw new Error(`Anchor transition not allowed: ${from} -> ${to}`);
  }
}
