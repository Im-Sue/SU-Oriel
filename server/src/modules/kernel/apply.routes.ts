import { randomUUID } from "node:crypto";

import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { prisma } from "../../db/prisma.js";
import { emitEvent } from "../events/event-journal.service.js";
import { emitEventSchema } from "../events/event-journal.schemas.js";
import { primitiveExecutor } from "../primitive/primitive-wrapper.js";
import {
  assertTaskRunTransition,
  type TaskRunState
} from "../task-run/task-run.state-machine.js";

export const CONSOLE_WORKTREE_APPLY_DISABLED_MESSAGE =
  "Console TaskRun worktree 入口已关闭；per-需求 worktree 由 CCB plugin 生命周期管理";

const createReviewIntentApplySchema = z
  .object({
    taskId: z.string().trim().min(1),
    intentType: z.enum(["mark_review_pass", "request_replan", "request_escalate"]),
    payload: z.string().trim().max(1000).optional()
  })
  .strict();

const cancelReviewIntentApplySchema = z
  .object({
    intentId: z.string().trim().min(1)
  })
  .strict();

const dispatchTaskApplySchema = z
  .object({
    taskId: z.string().trim().min(1),
    attempt_n: z.number().int().min(1).default(1)
  })
  .strict();

const taskRunTransitionApplySchema = z
  .object({
    taskId: z.string().trim().min(1)
  })
  .strict();

export class KernelApplyNotFoundError extends Error {
  public constructor(message: string) {
    super(message);
  }
}

export class KernelApplyValidationError extends Error {
  public constructor(public readonly issues: z.ZodIssue[]) {
    super("kernel apply payload 不合法");
  }
}

export class KernelApplyConflictError extends Error {
  public constructor(message: string) {
    super(message);
  }
}

export class KernelApplyGoneError extends Error {
  public constructor(message: string) {
    super(message);
  }
}

interface KernelApplyContext {
  applyId: string;
  primitive: string;
}

interface KernelApplyOutcome {
  result: unknown;
  projectId: string;
  taskId: string;
  causationId?: string;
}

interface KernelApplyDefinition {
  schema: z.ZodTypeAny;
  apply: (payload: unknown, context: KernelApplyContext) => Promise<KernelApplyOutcome>;
}

function parseReviewPayload(value: string | null): string | null {
  if (!value) {
    return null;
  }
  try {
    const parsed = JSON.parse(value) as unknown;
    return typeof parsed === "string" ? parsed : null;
  } catch {
    return value;
  }
}

function serializeReviewIntent(intent: {
  id: string;
  projectId: string;
  taskId: string;
  taskKey: string;
  intentType: string;
  payloadJson: string | null;
  status: string;
  actor: string | null;
  consumedAt: Date | null;
  consumedBy: string | null;
  attemptCount: number;
  lastError: string | null;
  lastAttemptAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: intent.id,
    projectId: intent.projectId,
    taskId: intent.taskId,
    taskKey: intent.taskKey,
    intentType: intent.intentType,
    payload: parseReviewPayload(intent.payloadJson),
    status: intent.status,
    actor: intent.actor,
    consumedAt: intent.consumedAt?.toISOString() ?? null,
    consumedBy: intent.consumedBy,
    attemptCount: intent.attemptCount,
    lastError: intent.lastError,
    lastAttemptAt: intent.lastAttemptAt?.toISOString() ?? null,
    createdAt: intent.createdAt.toISOString(),
    updatedAt: intent.updatedAt.toISOString()
  };
}

function parseTransitionJson(value: string | null): unknown[] {
  if (!value) {
    return [];
  }

  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function serializeTaskRun(
  run: {
    id: string;
    taskId: string;
    status: string;
    attemptN: number;
    dispatchedAt: Date | null;
    completedAt: Date | null;
    errorSummary: string | null;
    transitionsJson: string;
    workspacePath: string | null;
    worktreeBranch: string | null;
    createdAt: Date;
    updatedAt: Date;
  },
  options: { idempotent: boolean }
) {
  return {
    id: run.id,
    task_id: run.taskId,
    status: run.status,
    attempt_n: run.attemptN,
    dispatched_at: run.dispatchedAt?.toISOString() ?? null,
    completed_at: run.completedAt?.toISOString() ?? null,
    error_summary: run.errorSummary,
    workspace_path: run.workspacePath,
    worktree_branch: run.worktreeBranch,
    transitions: parseTransitionJson(run.transitionsJson),
    idempotent: options.idempotent,
    created_at: run.createdAt.toISOString(),
    updated_at: run.updatedAt.toISOString()
  };
}

function appendTaskRunDispatchTransition(input: {
  transitionsJson: string | null;
  from: TaskRunState;
  attempt_n: number;
  idempotencyKey: string;
  triggeredAt: Date;
}): string {
  const transitions = parseTransitionJson(input.transitionsJson);
  transitions.push({
    from: input.from,
    to: "dispatched",
    attempt_n: input.attempt_n,
    transition_id: `task-run:${input.from}->dispatched`,
    triggered_at: input.triggeredAt.toISOString(),
    idempotency_key: input.idempotencyKey
  });
  return JSON.stringify(transitions);
}

function appendTaskRunStateTransition(input: {
  transitionsJson: string | null;
  from: TaskRunState;
  to: TaskRunState;
  attempt_n: number;
  idempotencyKey: string;
  triggeredAt: Date;
}): string {
  const transitions = parseTransitionJson(input.transitionsJson);
  transitions.push({
    from: input.from,
    to: input.to,
    attempt_n: input.attempt_n,
    transition_id: `task-run:${input.from}->${input.to}`,
    triggered_at: input.triggeredAt.toISOString(),
    idempotency_key: input.idempotencyKey
  });
  return JSON.stringify(transitions);
}

async function applyTaskRunStateTransition(input: {
  taskId: string;
  primitive: "pause_task" | "resume_task" | "cancel_task";
  to: TaskRunState;
}): Promise<KernelApplyOutcome> {
  const task = await prisma.task.findUnique({
    where: {
      id: input.taskId
    },
    select: {
      id: true,
      projectId: true
    }
  });

  if (!task) {
    throw new KernelApplyNotFoundError("任务不存在");
  }

  const latestRun = await prisma.taskRun.findFirst({
    where: {
      taskId: task.id
    },
    orderBy: [{ attemptN: "desc" }, { createdAt: "desc" }]
  });

  if (!latestRun) {
    throw new KernelApplyConflictError("TaskRun 不存在");
  }

  const from = latestRun.status as TaskRunState;
  try {
    assertTaskRunTransition(from, input.to);
  } catch (error) {
    throw new KernelApplyConflictError(error instanceof Error ? error.message : "TaskRun transition not allowed");
  }

  const triggeredAt = new Date();
  const idempotencyKey = `task-run:${task.id}:attempt_n:${latestRun.attemptN}:${input.primitive}`;
  const transitionsJson = appendTaskRunStateTransition({
    transitionsJson: latestRun.transitionsJson,
    from,
    to: input.to,
    attempt_n: latestRun.attemptN,
    idempotencyKey,
    triggeredAt
  });
  const updatedRun = await primitiveExecutor.run({
    primitive: input.primitive,
    mutationType: "prisma.taskRun.update",
    idempotencyKey,
    run: async () => {
      if (input.to === "cancelled") {
        return await prisma.taskRun.update({
          where: {
            id: latestRun.id
          },
          data: {
            status: input.to,
            completedAt: triggeredAt,
            transitionsJson
          }
        });
      }

      return await prisma.taskRun.update({
        where: {
          id: latestRun.id
        },
        data: {
          status: input.to,
          transitionsJson
        }
      });
    }
  });
  return {
    result: serializeTaskRun(updatedRun, { idempotent: false }),
    projectId: task.projectId,
    taskId: task.id
  };
}

const publicKernelApplyRegistry = {
  append_event_journal: {
    schema: emitEventSchema,
    apply: async (payload: unknown): Promise<KernelApplyOutcome> => {
      const result = await emitEvent(payload as z.output<typeof emitEventSchema>);
      return {
        result,
        projectId: result.event.projectId,
        taskId: result.event.taskId,
        causationId: result.event.eventId
      };
    }
  },
  create_review_intent: {
    schema: createReviewIntentApplySchema,
    apply: async (payload: unknown, context: KernelApplyContext): Promise<KernelApplyOutcome> => {
      const input = payload as z.output<typeof createReviewIntentApplySchema>;
      const task = await prisma.task.findUnique({
        where: {
          id: input.taskId
        },
        select: {
          id: true,
          projectId: true,
          taskKey: true
        }
      });

      if (!task) {
        throw new KernelApplyNotFoundError("任务不存在");
      }

      const intent = await primitiveExecutor.run({
        primitive: "create_review_intent",
        mutationType: "prisma.reviewIntent.create",
        idempotencyKey: `${context.applyId}:create_review_intent:${task.id}`,
        run: async () =>
          await prisma.reviewIntent.create({
            data: {
              projectId: task.projectId,
              taskId: task.id,
              taskKey: task.taskKey,
              intentType: input.intentType,
              payloadJson: input.payload ? JSON.stringify(input.payload) : null,
              status: "pending"
            }
          })
      });

      return {
        result: serializeReviewIntent(intent),
        projectId: task.projectId,
        taskId: task.id
      };
    }
  },
  dispatch_task: {
    schema: dispatchTaskApplySchema,
    apply: async (): Promise<KernelApplyOutcome> => {
      throw new KernelApplyGoneError(CONSOLE_WORKTREE_APPLY_DISABLED_MESSAGE);
    }
  },
  pause_task: {
    schema: taskRunTransitionApplySchema,
    apply: async (payload: unknown): Promise<KernelApplyOutcome> => {
      const input = payload as z.output<typeof taskRunTransitionApplySchema>;
      return await applyTaskRunStateTransition({
        taskId: input.taskId,
        primitive: "pause_task",
        to: "paused"
      });
    }
  },
  resume_task: {
    schema: taskRunTransitionApplySchema,
    apply: async (payload: unknown): Promise<KernelApplyOutcome> => {
      const input = payload as z.output<typeof taskRunTransitionApplySchema>;
      return await applyTaskRunStateTransition({
        taskId: input.taskId,
        primitive: "resume_task",
        to: "running"
      });
    }
  },
  cancel_task: {
    schema: taskRunTransitionApplySchema,
    apply: async (payload: unknown): Promise<KernelApplyOutcome> => {
      const input = payload as z.output<typeof taskRunTransitionApplySchema>;
      return await applyTaskRunStateTransition({
        taskId: input.taskId,
        primitive: "cancel_task",
        to: "cancelled"
      });
    }
  },
  cancel_review_intent: {
    schema: cancelReviewIntentApplySchema,
    apply: async (payload: unknown, context: KernelApplyContext): Promise<KernelApplyOutcome> => {
      const input = payload as z.output<typeof cancelReviewIntentApplySchema>;
      const intent = await prisma.reviewIntent.findUnique({
        where: {
          id: input.intentId
        }
      });

      if (!intent) {
        throw new KernelApplyNotFoundError("review intent 不存在");
      }

      const updatedIntent = await primitiveExecutor.run({
        primitive: "cancel_review_intent",
        mutationType: "prisma.reviewIntent.update",
        idempotencyKey: `${context.applyId}:cancel_review_intent:${intent.id}`,
        run: async () =>
          await prisma.reviewIntent.update({
            where: {
              id: intent.id
            },
            data: {
              status: "cancelled"
            }
          })
      });

      return {
        result: serializeReviewIntent(updatedIntent),
        projectId: updatedIntent.projectId,
        taskId: updatedIntent.taskId
      };
    }
  }
} satisfies Record<string, KernelApplyDefinition>;

export const PUBLIC_KERNEL_APPLY_PRIMITIVES = Object.freeze(Object.keys(publicKernelApplyRegistry));

async function emitApplySuccessEvent(
  context: KernelApplyContext,
  outcome: KernelApplyOutcome
): Promise<void> {
  try {
    await emitEvent({
      event_id: randomUUID(),
      event_type: "verification_finished",
      project_id: outcome.projectId,
      task_id: outcome.taskId,
      emitted_at: new Date().toISOString(),
      source_actor: "system",
      source_component: "console",
      causation_id: outcome.causationId ?? context.applyId,
      correlation_id: context.applyId,
      idempotency_key: `${context.applyId}:verification_finished`,
      payload: {
        result: "pass",
        build: {
          status: "not_run",
          source: "kernel_apply_endpoint",
          primitive: context.primitive
        },
        test: {
          status: "not_run",
          source: "kernel_apply_endpoint",
          primitive: context.primitive
        },
        artifact_refs: []
      }
    });
  } catch {
    // K1 apply result is returned from the primitive wrapper; event projection is best-effort.
  }
}

export async function kernelApply(
  primitive: string,
  payload: unknown
): Promise<{ success: true; applyId: string; primitive: string; result: unknown }> {
  const definition = publicKernelApplyRegistry[primitive as keyof typeof publicKernelApplyRegistry];

  if (!definition) {
    throw new KernelApplyNotFoundError("primitive 不在公开白名单");
  }

  const parsed = definition.schema.safeParse(payload ?? {});
  if (!parsed.success) {
    throw new KernelApplyValidationError(parsed.error.issues);
  }

  const context = {
    applyId: randomUUID(),
    primitive
  };
  const outcome = await definition.apply(parsed.data, context);
  await emitApplySuccessEvent(context, outcome);

  return {
    success: true,
    applyId: context.applyId,
    primitive,
    result: outcome.result
  };
}

export async function registerKernelApplyRoutes(app: FastifyInstance): Promise<void> {
  app.post("/api/kernel/apply/:primitive", async (request, reply) => {
    const primitive = (request.params as { primitive?: string }).primitive ?? "";

    try {
      return await kernelApply(primitive, request.body ?? {});
    } catch (error) {
      if (error instanceof KernelApplyNotFoundError) {
        reply.status(404);
        return {
          message: error.message,
          primitives: PUBLIC_KERNEL_APPLY_PRIMITIVES
        };
      }
      if (error instanceof KernelApplyValidationError) {
        reply.status(400);
        return {
          message: error.message,
          issues: error.issues
        };
      }
      if (error instanceof KernelApplyConflictError) {
        reply.status(409);
        return {
          message: error.message
        };
      }
      if (error instanceof KernelApplyGoneError) {
        reply.status(410);
        return {
          message: error.message
        };
      }

      throw error;
    }
  });
}
