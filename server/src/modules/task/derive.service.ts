import type { PrismaClient, Task } from "@prisma/client";

import {
  buildRequirementDispatchCommand,
  readStructuredDispatchPayload
} from "../anchor-broker/structured-dispatch.js";
import { JobSlotRouter, type JobSlotRouterResult } from "../slot-binding/job-slot-router.js";
import type { DeriveTaskInput } from "./derive.schemas.js";

const DERIVE_DISPATCH_COMMAND = "su-flow";
const DERIVE_DISPATCH_STEP = "breakdown_draft";

type SourceTask = Pick<Task, "id" | "projectId" | "taskKey" | "title" | "requirementId" | "currentNode">;

export interface DeriveDispatchResult {
  kind: "dispatch";
  dispatch: {
    jobId: string;
    job_id: string;
    anchorId: string | null;
    slotId: string | null;
    subjectId: string;
    requirementId: string;
    sourceTaskId: string;
    sourceTaskKey: string;
    followupType: "subtask" | "requirement";
    command: typeof DERIVE_DISPATCH_COMMAND;
    status: JobSlotRouterResult["status"];
    queuedAt: string;
    dispatchPayload: Record<string, unknown>;
  };
}

export class DeriveTaskError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number
  ) {
    super(message);
    this.name = "DeriveTaskError";
  }
}

export async function deriveFromTask(
  db: PrismaClient,
  sourceTaskId: string,
  input: DeriveTaskInput
): Promise<DeriveDispatchResult> {
  if (input.type === "decision") {
    throw new DeriveTaskError("decision derivation not implemented yet", 400);
  }

  const source = await db.task.findUnique({
    where: { id: sourceTaskId },
    select: {
      id: true,
      projectId: true,
      taskKey: true,
      title: true,
      requirementId: true,
      currentNode: true
    }
  });
  if (!source) {
    throw new DeriveTaskError("source task not found", 404);
  }
  if (!source.projectId) {
    throw new DeriveTaskError("source task has no projectId", 409);
  }
  if (!source.requirementId) {
    throw new DeriveTaskError("derive followup requires source task requirementId", 409);
  }

  const command = buildDeriveFollowupCommand(source, input);
  const dispatchPayload = readStructuredDispatchPayload(command);
  const queued = await new JobSlotRouter({ prismaClient: db }).enqueue({
    projectId: source.projectId,
    requirementId: source.requirementId,
    subjectType: "requirement",
    subjectId: source.requirementId,
    command,
    dispatchPayload,
    step: DERIVE_DISPATCH_STEP
  });

  return {
    kind: "dispatch",
    dispatch: {
      jobId: queued.jobId,
      job_id: queued.jobId,
      anchorId: queued.slotId,
      slotId: queued.slotId,
      subjectId: source.requirementId,
      requirementId: source.requirementId,
      sourceTaskId: source.id,
      sourceTaskKey: source.taskKey,
      followupType: input.type,
      command: DERIVE_DISPATCH_COMMAND,
      status: queued.status,
      queuedAt: queued.queuedAt.toISOString(),
      dispatchPayload
    }
  };
}

function buildDeriveFollowupCommand(source: SourceTask, input: DeriveTaskInput): string {
  if (!source.requirementId) {
    throw new DeriveTaskError("derive followup requires source task requirementId", 409);
  }
  return buildRequirementDispatchCommand({
    projectId: source.projectId,
    requirementId: source.requirementId,
    command: DERIVE_DISPATCH_COMMAND,
    payload: {
      step: DERIVE_DISPATCH_STEP,
      action: "derive_followup",
      source_task_id: source.id,
      source_task_key: source.taskKey,
      source_task_title: source.title,
      source_task_current_node: source.currentNode,
      followup: {
        type: input.type,
        title: input.title,
        ...(input.description ? { description: input.description } : {})
      }
    }
  });
}
