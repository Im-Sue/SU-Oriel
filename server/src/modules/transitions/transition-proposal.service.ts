import { prisma } from "../../db/prisma.js";
import { getEventJournalByEventId } from "../events/event-journal.service.js";
import type {
  EligibleTransitionProposal,
  IneligibleTransitionProposal,
  ProposalEnvelope,
  TransitionProposalDependencies,
  TransitionProposalInput,
  TransitionProposalReason,
  TransitionProposalSourceNode,
  TransitionProposalTargetNode,
  TransitionProposalTransitionId
} from "./transition-proposal.types.js";
import {
  TRANSITION_PROPOSAL_EVENT_TYPE,
  TRANSITION_PROPOSAL_MAPPINGS,
  TRANSITION_PROPOSAL_SOURCE_NODE,
  TRANSITION_PROPOSAL_TARGET_NODE,
  TRANSITION_PROPOSAL_TRANSITION_ID
} from "./transition-proposal.types.js";

// 这是 su-ccb-claude-plugin/references/kernel/registries/transition-table.md 的适配层，不是新的 transition 定义（This is not a new transition definition）。
// canonical 同步由 transition-proposal-routes.spec.ts 的 AC8 校验。
const CODEX_RECEIPT_READY_MAPPING = {
  eventType: TRANSITION_PROPOSAL_EVENT_TYPE,
  transitionId: TRANSITION_PROPOSAL_TRANSITION_ID,
  sourceNode: TRANSITION_PROPOSAL_SOURCE_NODE,
  targetNode: TRANSITION_PROPOSAL_TARGET_NODE
} as const;

type TaskProjectionForProposal = {
  id: string;
  currentNode: string | null;
  reviewStatus: string | null;
};

type ProposalMapping = {
  transitionId: TransitionProposalTransitionId;
  sourceNode: TransitionProposalSourceNode;
  targetNode: TransitionProposalTargetNode;
};

function buildIneligibleProposal(
  eventId: string,
  reason: Exclude<TransitionProposalReason, "eligible">
): IneligibleTransitionProposal {
  return {
    eligible: false,
    reason,
    eventId,
    transitionId: null
  };
}

export function validateMappingSync(): boolean {
  return true;
}

function asPayloadRecord(payload: unknown): Record<string, unknown> {
  return payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
}

function normalize(value: string | null | undefined): string {
  return value?.trim().toLowerCase() ?? "";
}

function buildEligibleProposal(eventId: string, mapping: ProposalMapping): EligibleTransitionProposal {
  return {
    eligible: true,
    reason: "eligible",
    eventId,
    transitionId: mapping.transitionId,
    sourceNode: mapping.sourceNode,
    targetNode: mapping.targetNode
  };
}

function readStringPayloadField(payload: unknown, field: string): string {
  const record = asPayloadRecord(payload);
  const value = record[field];
  return typeof value === "string" ? normalize(value) : "";
}

function resolveReviewReplanMapping(reentryNode: string): ProposalMapping | null {
  switch (normalize(reentryNode)) {
    case "implementation":
      return TRANSITION_PROPOSAL_MAPPINGS.review_replan_to_implementation;
    case "task_breakdown":
      return TRANSITION_PROPOSAL_MAPPINGS.review_replan_to_task_breakdown;
    case "technical_design":
      return TRANSITION_PROPOSAL_MAPPINGS.review_replan_to_technical_design;
    case "requirement_analysis":
      return TRANSITION_PROPOSAL_MAPPINGS.review_replan_to_requirement_analysis;
    default:
      return null;
  }
}

function resolveReviewMapping(task: TaskProjectionForProposal, payload?: unknown): ProposalMapping {
  const payloadReentryNode = payload ? readStringPayloadField(payload, "reentry_node") : "";
  const payloadMapping = resolveReviewReplanMapping(payloadReentryNode);
  if (payloadMapping) {
    return payloadMapping;
  }

  const reviewStatus = normalize(task.reviewStatus);
  if (reviewStatus === "passed") {
    return TRANSITION_PROPOSAL_MAPPINGS.review_pass;
  }
  if (reviewStatus === "design_conflict") {
    return TRANSITION_PROPOSAL_MAPPINGS.review_replan_to_technical_design;
  }
  if (reviewStatus === "requirement_conflict" || reviewStatus === "requirement_analysis") {
    return TRANSITION_PROPOSAL_MAPPINGS.review_replan_to_requirement_analysis;
  }
  if (reviewStatus === "task_breakdown") {
    return TRANSITION_PROPOSAL_MAPPINGS.review_replan_to_task_breakdown;
  }
  return TRANSITION_PROPOSAL_MAPPINGS.review_replan_to_implementation;
}

function resolveMappingForEvent(
  event: { eventType: string; payload: unknown },
  task: TaskProjectionForProposal
): ProposalMapping | Exclude<TransitionProposalReason, "eligible"> {
  const currentNode = normalize(task.currentNode);

  if (event.eventType === "codex_receipt_ready") {
    return currentNode === CODEX_RECEIPT_READY_MAPPING.sourceNode
      ? CODEX_RECEIPT_READY_MAPPING
      : "task_not_in_implementation";
  }

  if (event.eventType === "codex_picked_up") {
    return currentNode === "dispatch" ? TRANSITION_PROPOSAL_MAPPINGS.codex_picked_up : "task_not_in_dispatch";
  }

  if (event.eventType === "verification_finished") {
    if (currentNode !== "review") {
      return "task_not_in_review";
    }
    const payload = asPayloadRecord(event.payload);
    if (typeof payload.result === "string" && payload.result.toLowerCase() !== "pass") {
      return "verification_not_passed";
    }
    return normalize(task.reviewStatus) === "passed"
      ? TRANSITION_PROPOSAL_MAPPINGS.verification_finished
      : "review_not_passed";
  }

  if (event.eventType === "user_arbitration_submitted") {
    return currentNode === "review" ? resolveReviewMapping(task, event.payload) : "task_not_in_review";
  }

  if (event.eventType === "session_resumed") {
    return "session_resumed_not_a_transition_trigger";
  }

  return "event_not_codex_receipt_ready";
}

export async function resolveTransitionProposal(
  input: TransitionProposalInput,
  dependencies: TransitionProposalDependencies = {
    validateMappingSync
  }
): Promise<ProposalEnvelope> {
  const event = await getEventJournalByEventId(input.eventId);

  if (!event) {
    return buildIneligibleProposal(input.eventId, "event_not_found");
  }

  if (input.taskId && input.taskId !== event.taskId) {
    return buildIneligibleProposal(input.eventId, "event_task_mismatch");
  }

  if (!dependencies.validateMappingSync()) {
    return buildIneligibleProposal(input.eventId, "transition_id_canonical_drift");
  }

  const task = await prisma.task.findUnique({
    where: {
      id: event.taskId
    },
    select: {
      id: true,
      currentNode: true,
      reviewStatus: true
    }
  });

  if (!task) {
    return buildIneligibleProposal(input.eventId, "task_not_found");
  }

  const mapping = resolveMappingForEvent(event, task);
  if (typeof mapping === "string") {
    return buildIneligibleProposal(input.eventId, mapping);
  }

  return buildEligibleProposal(input.eventId, mapping);
}

export const transitionProposalService = {
  propose: resolveTransitionProposal
};
