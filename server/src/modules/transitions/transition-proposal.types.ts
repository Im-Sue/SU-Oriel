export const TRANSITION_PROPOSAL_EVENT_TYPE = "codex_receipt_ready" as const;
export const TRANSITION_PROPOSAL_TRANSITION_ID = "implementation__on_receipt_ready__to__review" as const;
export const TRANSITION_PROPOSAL_SOURCE_NODE = "implementation" as const;
export const TRANSITION_PROPOSAL_TARGET_NODE = "review" as const;

export const TRANSITION_PROPOSAL_MAPPINGS = {
  codex_receipt_ready: {
    eventType: "codex_receipt_ready",
    transitionId: "implementation__on_receipt_ready__to__review",
    sourceNode: "implementation",
    targetNode: "review"
  },
  codex_picked_up: {
    eventType: "codex_picked_up",
    transitionId: "dispatch__on_codex_pickup__to__implementation",
    sourceNode: "dispatch",
    targetNode: "implementation"
  },
  verification_finished: {
    eventType: "verification_finished",
    transitionId: "review__pass__to__archive",
    sourceNode: "review",
    targetNode: "archive"
  },
  review_pass: {
    eventType: "user_arbitration_submitted",
    transitionId: "review__pass__to__archive",
    sourceNode: "review",
    targetNode: "archive"
  },
  review_replan_to_implementation: {
    eventType: "user_arbitration_submitted",
    transitionId: "review__replan_to_implementation__to__implementation",
    sourceNode: "review",
    targetNode: "implementation"
  },
  review_replan_to_task_breakdown: {
    eventType: "user_arbitration_submitted",
    transitionId: "review__replan_to_task_breakdown__to__task_breakdown",
    sourceNode: "review",
    targetNode: "task_breakdown"
  },
  review_replan_to_technical_design: {
    eventType: "user_arbitration_submitted",
    transitionId: "review__replan_to_technical_design__to__technical_design",
    sourceNode: "review",
    targetNode: "technical_design"
  },
  review_replan_to_requirement_analysis: {
    eventType: "user_arbitration_submitted",
    transitionId: "review__replan_to_requirement_analysis__to__requirement_analysis",
    sourceNode: "review",
    targetNode: "requirement_analysis"
  }
} as const;

export type TransitionProposalMapping = (typeof TRANSITION_PROPOSAL_MAPPINGS)[keyof typeof TRANSITION_PROPOSAL_MAPPINGS];
export type TransitionProposalTransitionId = TransitionProposalMapping["transitionId"];
export type TransitionProposalSourceNode = TransitionProposalMapping["sourceNode"];
export type TransitionProposalTargetNode = TransitionProposalMapping["targetNode"];

export type TransitionProposalReason =
  | "eligible"
  | "event_not_found"
  | "event_not_codex_receipt_ready"
  | "event_task_mismatch"
  | "task_not_found"
  | "task_not_in_implementation"
  | "task_not_in_dispatch"
  | "task_not_in_review"
  | "review_not_passed"
  | "verification_not_passed"
  | "session_resumed_not_a_transition_trigger"
  | "transition_apply_not_supported"
  | "dev_task_conflict"
  | "transition_id_canonical_drift";

export interface EligibleTransitionProposal {
  eligible: true;
  reason: "eligible";
  eventId: string;
  transitionId: TransitionProposalTransitionId;
  sourceNode: TransitionProposalSourceNode;
  targetNode: TransitionProposalTargetNode;
}

export interface IneligibleTransitionProposal {
  eligible: false;
  reason: Exclude<TransitionProposalReason, "eligible">;
  eventId: string;
  transitionId: null;
}

export type ProposalEnvelope = EligibleTransitionProposal | IneligibleTransitionProposal;

export interface TransitionProposalInput {
  eventId: string;
  taskId?: string;
}

export interface TransitionProposalDependencies {
  validateMappingSync: () => boolean;
}
