import { randomUUID } from "node:crypto";

import type { Prisma, PrismaClient, Task } from "@prisma/client";
import { z, type ZodError } from "zod";

import { prisma } from "../../db/prisma.js";
import { primitiveExecutor } from "../primitive/primitive-wrapper.js";
import { deriveFromTask, DeriveTaskError, type DeriveDispatchResult } from "../task/derive.service.js";
import { deriveTaskSchema } from "../task/derive.schemas.js";
import { mapNodeToPhase } from "../task/phase-derive.js";
import { getAiToolDefinition, AI_TOOL_REGISTRY, type AiToolDefinition } from "./tool-registry.js";

const SOURCE_COMPONENT = "ai-tool-registry";
const DEFAULT_ACTOR = "ai:unknown";

const invokeSchema = z
  .object({
    tool_name: z.string().trim().min(1),
    input: z.record(z.unknown()),
    actor: z.string().trim().min(1).max(120).optional()
  })
  .strict();

const fetchTaskStateInputSchema = z
  .object({
    taskId: z.string().trim().min(1)
  })
  .strict();

const sourceTaskIdCarrierSchema = z
  .object({
    sourceTaskId: z.string().trim().min(1)
  })
  .passthrough();

export type AiToolInvokeRequest = z.infer<typeof invokeSchema>;

export interface AiToolErrorBody {
  error: {
    type: string;
    message: string;
    retry_suggested: boolean;
    issues?: unknown;
  };
  event_id?: string;
  invocation_id?: string;
}

export class AiToolInvokeError extends Error {
  constructor(
    public readonly type: string,
    message: string,
    public readonly statusCode: number,
    public readonly retrySuggested: boolean,
    public readonly issues?: unknown,
    public readonly auditEventId?: string,
    public readonly invocationId?: string
  ) {
    super(message);
    this.name = "AiToolInvokeError";
  }

  toResponse(): AiToolErrorBody {
    return {
      error: {
        type: this.type,
        message: this.message,
        retry_suggested: this.retrySuggested,
        ...(this.issues ? { issues: this.issues } : {})
      },
      ...(this.auditEventId ? { event_id: this.auditEventId } : {}),
      ...(this.invocationId ? { invocation_id: this.invocationId } : {})
    };
  }
}

export interface AiToolInvokeResult {
  result: unknown;
  event_id: string;
  invocation_id: string;
}

interface AuditTarget {
  projectId: string;
  taskId: string;
  taskKey: string;
}

interface ToolExecution {
  result: unknown;
  auditTarget: AuditTarget;
}

export function listAiTools(): { tools: AiToolDefinition[] } {
  return {
    tools: AI_TOOL_REGISTRY
  };
}

export function parseAiToolInvokeRequest(value: unknown): AiToolInvokeRequest {
  const parsed = invokeSchema.safeParse(value);
  if (!parsed.success) {
    throw new AiToolInvokeError("invalid_request", "ai tool invoke payload invalid", 400, false, parsed.error.issues);
  }
  return parsed.data;
}

export async function invokeAiTool(
  db: PrismaClient,
  request: AiToolInvokeRequest
): Promise<AiToolInvokeResult> {
  const tool = getAiToolDefinition(request.tool_name);
  if (!tool) {
    throw new AiToolInvokeError("unknown_tool", `unknown ai tool: ${request.tool_name}`, 400, false);
  }

  const invocationId = randomUUID();
  const actor = request.actor ?? DEFAULT_ACTOR;
  let auditTarget: AuditTarget | null = null;

  try {
    const execution = await executeTool(db, request, actor);
    auditTarget = execution.auditTarget;
    const auditEventId = await appendAiToolAuditEvent(db, {
      target: auditTarget,
      invocationId,
      toolName: request.tool_name,
      actor,
      input: request.input,
      result: execution.result,
      success: true
    });
    return {
      result: execution.result,
      event_id: auditEventId,
      invocation_id: invocationId
    };
  } catch (error) {
    if (error instanceof AiToolInvokeError) {
      throw error;
    }

    auditTarget = await resolveBestEffortAuditTarget(db, request).catch(() => null);
    const normalized = normalizeExecutionError(error);
    const auditEventId = auditTarget
      ? await appendAiToolAuditEvent(db, {
          target: auditTarget,
          invocationId,
          toolName: request.tool_name,
          actor,
          input: request.input,
          result: normalized.message,
          success: false
        })
      : undefined;

    throw new AiToolInvokeError(
      normalized.type,
      normalized.message,
      normalized.statusCode,
      normalized.retrySuggested,
      undefined,
      auditEventId,
      invocationId
    );
  }
}

async function executeTool(db: PrismaClient, request: AiToolInvokeRequest, actor: string): Promise<ToolExecution> {
  void actor;
  switch (request.tool_name) {
    case "derive_followup":
      return await executeDeriveFollowup(db, request.input);
    case "fetch_task_state":
      return await executeFetchTaskState(db, request.input);
    default:
      throw new AiToolInvokeError("unknown_tool", `unknown ai tool: ${request.tool_name}`, 400, false);
  }
}

async function executeDeriveFollowup(db: PrismaClient, rawInput: Record<string, unknown>): Promise<ToolExecution> {
  const carrier = sourceTaskIdCarrierSchema.safeParse(rawInput);
  if (!carrier.success) {
    throw invalidInput(carrier.error);
  }
  const { sourceTaskId, ...deriveRawInput } = carrier.data;
  const deriveParsed = deriveTaskSchema.safeParse(deriveRawInput);
  if (!deriveParsed.success) {
    throw invalidInput(deriveParsed.error);
  }
  const deriveInput = deriveParsed.data;
  const result = await deriveFromTask(db, sourceTaskId, deriveInput);
  const source = await db.task.findUniqueOrThrow({ where: { id: sourceTaskId } });
  return {
    result: serializeDeriveResult(result),
    auditTarget: targetFromTask(source)
  };
}

async function executeFetchTaskState(db: PrismaClient, rawInput: Record<string, unknown>): Promise<ToolExecution> {
  const parsed = fetchTaskStateInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    throw invalidInput(parsed.error);
  }
  const task = await db.task.findUnique({
    where: { id: parsed.data.taskId }
  });
  if (!task) {
    throw new AiToolInvokeError("task_not_found", "task not found", 404, false);
  }
  const documents = await db.document.findMany({
    where: {
      projectId: task.projectId,
      taskKey: task.taskKey,
      kind: "dev_task"
    },
    orderBy: { path: "asc" }
  });
  const devTask = documents[0] ?? null;
  return {
    result: {
      task: serializeTask(task),
      documents: {
        dev_task: devTask ? serializeDocument(devTask) : null
      }
    },
    auditTarget: targetFromTask(task)
  };
}

function invalidInput(error: ZodError): AiToolInvokeError {
  return new AiToolInvokeError("invalid_input", "ai tool input invalid", 400, false, error.issues);
}

function serializeTask(task: Task) {
  return {
    id: task.id,
    projectId: task.projectId,
    taskKey: task.taskKey,
    title: task.title,
    summary: task.summary,
    kind: "subtask",
    requirementId: task.requirementId,
    status: task.status,
    phase: mapNodeToPhase(task.currentNode),
    currentNode: task.currentNode,
    nodeSubstate: task.nodeSubstate,
    runtimeState: task.runtimeState,
    lastTransitionId: task.lastTransitionId,
    priority: task.priority,
    progress: task.progress,
    blockedReason: task.blockedReason,
    reviewStatus: task.reviewStatus,
    updatedAt: task.updatedAt.toISOString()
  };
}

function serializeDeriveResult(result: DeriveDispatchResult) {
  return result;
}

function serializeDocument(document: {
  id: string;
  path: string;
  kind: string;
  title: string;
  status: string | null;
  frontmatterJson: string | null;
  updatedAt: Date;
}) {
  return {
    id: document.id,
    path: document.path,
    kind: document.kind,
    title: document.title,
    status: document.status,
    frontmatter: parseJsonObject(document.frontmatterJson),
    updatedAt: document.updatedAt.toISOString()
  };
}

function targetFromTask(task: Pick<Task, "id" | "projectId" | "taskKey">): AuditTarget {
  return {
    projectId: task.projectId,
    taskId: task.id,
    taskKey: task.taskKey
  };
}

async function resolveBestEffortAuditTarget(db: PrismaClient, request: AiToolInvokeRequest): Promise<AuditTarget | null> {
  const taskId = typeof request.input.taskId === "string" ? request.input.taskId : typeof request.input.sourceTaskId === "string" ? request.input.sourceTaskId : null;
  if (taskId) {
    const task = await db.task.findUnique({ where: { id: taskId } });
    return task ? targetFromTask(task) : null;
  }
  const projectId = typeof request.input.projectId === "string" ? request.input.projectId : null;
  if (projectId) {
    return {
      projectId,
      taskId: `project:${projectId}`,
      taskKey: `project:${projectId}`
    };
  }
  return null;
}

function normalizeExecutionError(error: unknown): {
  type: string;
  message: string;
  statusCode: number;
  retrySuggested: boolean;
} {
  if (error instanceof DeriveTaskError) {
    return {
      type: "tool_execution_failed",
      message: error.message,
      statusCode: error.statusCode >= 500 ? 500 : error.statusCode,
      retrySuggested: error.statusCode >= 500
    };
  }
  if (error instanceof Error) {
    return {
      type: "tool_execution_failed",
      message: error.message,
      statusCode: 500,
      retrySuggested: true
    };
  }
  return {
    type: "tool_execution_failed",
    message: String(error),
    statusCode: 500,
    retrySuggested: true
  };
}

async function appendAiToolAuditEvent(
  db: PrismaClient,
  input: {
    target: AuditTarget;
    invocationId: string;
    toolName: string;
    actor: string;
    input: unknown;
    result: unknown;
    success: boolean;
  }
): Promise<string> {
  const eventId = `ai-tool:${input.invocationId}`;
  await primitiveExecutor.run({
    primitive: "append_ai_tool_invoked_event",
    mutationType: "prisma.eventJournal.create",
    idempotencyKey: eventId,
    run: async () =>
      await db.eventJournal.create({
        data: {
          eventId,
          eventType: "ai_tool_invoked",
          projectId: input.target.projectId,
          subjectType: "subtask",
          subjectId: input.target.taskId,
          subjectKey: input.target.taskKey,
          payloadJson: JSON.stringify({
            tool_name: input.toolName,
            actor: input.actor,
            input_summary: summarizeValue(input.input),
            result_summary: summarizeValue(input.result),
            success: input.success
          }),
          emittedAt: new Date(),
          sourceActor: input.actor,
          sourceComponent: SOURCE_COMPONENT,
          idempotencyKey: eventId
        }
      })
  });
  return eventId;
}

function summarizeValue(value: unknown): unknown {
  const json = JSON.stringify(value);
  if (!json) {
    return null;
  }
  if (json.length <= 1000) {
    return value;
  }
  return {
    truncated: true,
    preview: json.slice(0, 1000)
  };
}

function parseJsonObject(value: string | null): Record<string, unknown> | null {
  if (!value) {
    return null;
  }
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export async function invokeAiToolWithDefaultDb(request: AiToolInvokeRequest): Promise<AiToolInvokeResult> {
  return await invokeAiTool(prisma, request);
}
