import { prisma } from "../../db/prisma.js";
import {
  taskNodeFlowResponseSchema,
  type TaskNodeFlowApplicableAction,
  type TaskNodeFlowResponse,
  type TaskNodeFlowTransition
} from "./task-node-flow.schemas.js";

interface TransitionDefinition {
  transition_id: string;
  source_node: string;
  target_node: string;
  label: string;
}

interface GuardEvaluation {
  guard_status: TaskNodeFlowApplicableAction["guard_status"];
  guard_reason?: string;
}

interface NodeFlowTaskState {
  id: string;
  currentNode: string | null;
  nodeSubstate: string | null;
  runtimeState: string | null;
  lastTransitionId: string | null;
  status: string;
  blockedReason: string | null;
  reviewStatus: string | null;
}

interface GuardContext {
  latestCodexReceiptEventId: string | null;
  latestCodexRejectedEventId: string | null;
}

export class TaskNodeFlowNotFoundError extends Error {
  public constructor() {
    super("任务不存在");
  }
}

// Canonical mirror of su-ccb-claude-plugin/references/kernel/registries/transition-table.md for Console projection only.
// This endpoint does not define or apply transitions.
const TRANSITION_DEFINITIONS: TransitionDefinition[] = [
  {
    transition_id: "requirement_analysis__on_done__to__technical_design",
    source_node: "requirement_analysis",
    target_node: "technical_design",
    label: "进入技术设计"
  },
  {
    transition_id: "requirement_analysis__escalate__to__terminal",
    source_node: "requirement_analysis",
    target_node: "__terminal__",
    label: "需求升级"
  },
  {
    transition_id: "technical_design__on_done__to__task_breakdown",
    source_node: "technical_design",
    target_node: "task_breakdown",
    label: "进入任务拆分"
  },
  {
    transition_id: "technical_design__escalate__to__terminal",
    source_node: "technical_design",
    target_node: "__terminal__",
    label: "设计升级"
  },
  {
    transition_id: "task_breakdown__on_done__to__dispatch",
    source_node: "task_breakdown",
    target_node: "dispatch",
    label: "进入派工"
  },
  {
    transition_id: "task_breakdown__escalate__to__terminal",
    source_node: "task_breakdown",
    target_node: "__terminal__",
    label: "拆分升级"
  },
  {
    transition_id: "dispatch__on_codex_pickup__to__implementation",
    source_node: "dispatch",
    target_node: "implementation",
    label: "Codex 已接单"
  },
  {
    transition_id: "dispatch__codex_unavailable__to__terminal",
    source_node: "dispatch",
    target_node: "__terminal__",
    label: "Codex 不可用"
  },
  {
    transition_id: "dispatch__codex_rejected__to__terminal",
    source_node: "dispatch",
    target_node: "__terminal__",
    label: "Codex 拒绝任务"
  },
  {
    transition_id: "implementation__on_receipt_ready__to__review",
    source_node: "implementation",
    target_node: "review",
    label: "进入评审"
  },
  {
    transition_id: "implementation__codex_blocked__to__terminal",
    source_node: "implementation",
    target_node: "__terminal__",
    label: "执行阻塞升级"
  },
  {
    transition_id: "review__pass__to__archive",
    source_node: "review",
    target_node: "archive",
    label: "评审通过并归档"
  },
  {
    transition_id: "review__replan_to_implementation__to__implementation",
    source_node: "review",
    target_node: "implementation",
    label: "回到执行实现"
  },
  {
    transition_id: "review__replan_to_task_breakdown__to__task_breakdown",
    source_node: "review",
    target_node: "task_breakdown",
    label: "回到任务拆分"
  },
  {
    transition_id: "review__replan_to_technical_design__to__technical_design",
    source_node: "review",
    target_node: "technical_design",
    label: "回到技术设计"
  },
  {
    transition_id: "review__replan_to_requirement_analysis__to__requirement_analysis",
    source_node: "review",
    target_node: "requirement_analysis",
    label: "回到需求分析"
  },
  {
    transition_id: "review__escalate__to__terminal",
    source_node: "review",
    target_node: "__terminal__",
    label: "评审升级"
  },
  {
    transition_id: "archive__on_complete__to__terminal",
    source_node: "archive",
    target_node: "__terminal__",
    label: "完成归档"
  }
];

const TRANSITION_BY_ID = new Map(TRANSITION_DEFINITIONS.map((definition) => [definition.transition_id, definition]));
const REPLAN_REVIEW_STATUSES = new Set(["needs_followup", "design_conflict", "request_replan"]);

function normalizeNode(value: string | null | undefined): string {
  return value?.trim() || "unknown";
}

function normalizeStatus(value: string | null | undefined): string {
  return value?.trim().toLowerCase() ?? "";
}

function satisfied(guard_reason?: string): GuardEvaluation {
  return {
    guard_status: "satisfied",
    ...(guard_reason ? { guard_reason } : {})
  };
}

function blocked(guard_reason: string): GuardEvaluation {
  return {
    guard_status: "blocked",
    guard_reason
  };
}

function isTaskBlocked(task: NodeFlowTaskState): boolean {
  const runtimeState = normalizeStatus(task.runtimeState);
  return runtimeState === "blocked" || Boolean(task.blockedReason?.trim());
}

function evaluateGuard(
  task: NodeFlowTaskState,
  definition: TransitionDefinition,
  context: GuardContext
): GuardEvaluation {
  const runtimeState = normalizeStatus(task.runtimeState);
  const reviewStatus = normalizeStatus(task.reviewStatus);

  if (definition.transition_id === "implementation__on_receipt_ready__to__review") {
    return context.latestCodexReceiptEventId
      ? satisfied("codex_receipt_ready event available")
      : blocked("waiting for codex_receipt_ready event");
  }

  if (definition.transition_id === "review__pass__to__archive") {
    return reviewStatus === "passed" ? satisfied("review_status=passed") : blocked("review_status must be passed");
  }

  if (definition.transition_id.startsWith("review__replan_")) {
    if (REPLAN_REVIEW_STATUSES.has(reviewStatus)) {
      return satisfied(`review_status=${reviewStatus}`);
    }
    if (task.blockedReason?.trim()) {
      return satisfied("blocked_reason present; replan available");
    }
    return blocked("requires review follow-up signal");
  }

  if (definition.transition_id.endsWith("__escalate__to__terminal")) {
    return runtimeState === "escalated" ? satisfied("runtime_state=escalated") : blocked("runtime_state must be escalated");
  }

  if (definition.transition_id === "dispatch__codex_unavailable__to__terminal") {
    return isTaskBlocked(task) ? satisfied("dispatch blocked or paused") : blocked("Codex unavailable signal missing");
  }

  if (definition.transition_id === "dispatch__codex_rejected__to__terminal") {
    return context.latestCodexRejectedEventId
      ? satisfied("codex_rejected event available")
      : blocked("codex_rejected event missing");
  }

  if (definition.transition_id === "implementation__codex_blocked__to__terminal") {
    return isTaskBlocked(task) ? satisfied("implementation blocked") : blocked("codex_blocked signal missing");
  }

  if (definition.transition_id === "archive__on_complete__to__terminal") {
    return runtimeState === "completed" || normalizeStatus(task.status) === "done"
      ? satisfied("archive completion state present")
      : blocked("archive completion state missing");
  }

  return isTaskBlocked(task) ? blocked("task is blocked") : satisfied("source node matches currentNode");
}

function parseTransitionEndpoints(transitionId: string): { source_node: string; target_node: string } {
  const definition = TRANSITION_BY_ID.get(transitionId);
  if (definition) {
    return {
      source_node: definition.source_node,
      target_node: definition.target_node
    };
  }

  const [sourceNode] = transitionId.split("__");
  const targetNode = transitionId.includes("__to__") ? transitionId.split("__to__").at(-1) : "unknown";
  return {
    source_node: sourceNode || "unknown",
    target_node: targetNode || "unknown"
  };
}

function serializeCheckpointTransition(checkpoint: {
  id: string;
  transitionId: string;
  nodeBefore: string | null;
  nodeAfter: string | null;
  createdAt: Date;
}): TaskNodeFlowTransition {
  const endpoints = parseTransitionEndpoints(checkpoint.transitionId);
  return {
    transition_id: checkpoint.transitionId,
    source_node: checkpoint.nodeBefore ?? endpoints.source_node,
    target_node: checkpoint.nodeAfter ?? endpoints.target_node,
    verdict: "pass",
    at: checkpoint.createdAt.toISOString(),
    evidence_ref: checkpoint.id
  };
}

function buildApplicableActions(task: NodeFlowTaskState, context: GuardContext): TaskNodeFlowApplicableAction[] {
  const currentNode = normalizeNode(task.currentNode);
  return TRANSITION_DEFINITIONS.filter((definition) => definition.source_node === currentNode).map((definition) => {
    const guard = evaluateGuard(task, definition, context);
    return {
      transition_id: definition.transition_id,
      label: definition.label,
      guard_status: guard.guard_status,
      applicability: "system_only",
      ...(guard.guard_reason ? { guard_reason: guard.guard_reason } : {})
    };
  });
}

async function findLatestCodexReceiptEventId(taskId: string): Promise<string | null> {
  const event = await prisma.eventJournal.findFirst({
    where: {
      subjectType: "subtask",
      subjectId: taskId,
      eventType: "codex_receipt_ready"
    },
    orderBy: {
      emittedAt: "desc"
    },
    select: {
      eventId: true
    }
  });
  return event?.eventId ?? null;
}

async function findLatestCodexRejectedEventId(taskId: string): Promise<string | null> {
  const event = await prisma.eventJournal.findFirst({
    where: {
      subjectType: "subtask",
      subjectId: taskId,
      eventType: "codex_rejected"
    },
    orderBy: {
      emittedAt: "desc"
    },
    select: {
      eventId: true
    }
  });
  return event?.eventId ?? null;
}

export async function getTaskNodeFlow(taskId: string): Promise<TaskNodeFlowResponse> {
  const task = await prisma.task.findUnique({
    where: {
      id: taskId
    },
    select: {
      id: true,
      currentNode: true,
      nodeSubstate: true,
      runtimeState: true,
      lastTransitionId: true,
      status: true,
      blockedReason: true,
      reviewStatus: true
    }
  });

  if (!task) {
    throw new TaskNodeFlowNotFoundError();
  }

  const [checkpoints, latestCodexReceiptEventId, latestCodexRejectedEventId] = await Promise.all([
    prisma.taskCheckpoint.findMany({
      where: {
        taskId
      },
      orderBy: {
        createdAt: "asc"
      }
    }),
    findLatestCodexReceiptEventId(taskId),
    findLatestCodexRejectedEventId(taskId)
  ]);
  const transitions = checkpoints.map((checkpoint) => serializeCheckpointTransition(checkpoint));
  const lastTransitionAt = transitions.at(-1)?.at ?? null;

  return taskNodeFlowResponseSchema.parse({
    currentNode: normalizeNode(task.currentNode),
    nodeSubstate: normalizeNode(task.nodeSubstate),
    runtimeState: normalizeNode(task.runtimeState),
    lastTransitionId: task.lastTransitionId,
    lastTransitionAt,
    transitions,
    applicable_actions: buildApplicableActions(task, {
      latestCodexReceiptEventId,
      latestCodexRejectedEventId
    })
  });
}
