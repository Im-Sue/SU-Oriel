import { PrismaClient } from "@prisma/client";
import { AsyncLocalStorage } from "node:async_hooks";

import { prisma } from "../../db/prisma.js";

export interface PrimitiveWrapperInput<T> {
  primitive: string;
  mutationType: string;
  idempotencyKey?: string | null;
  run: () => Promise<T>;
}

interface PrimitiveAuditLogger {
  warn: (payload: unknown, message?: string) => void;
}

interface DeferredPrimitiveAudit {
  primitive: string;
  mutationType: string;
  idempotencyKey: string | null;
  status: "completed" | "failed";
  resultJson: string | null;
  errorJson: string | null;
  startedAt: Date;
  completedAt: Date;
  durationMs: number;
}

interface PrimitiveRunContext {
  depth: number;
  deferredAudits: DeferredPrimitiveAudit[];
}

type PrimitiveAuditRecord = { id: string } | null;

type PrimitiveAuditDelegate = Pick<typeof prisma.primitiveAudit, "findUnique" | "create" | "update">;

interface PrimitiveAuditClient {
  primitiveAudit: PrimitiveAuditDelegate;
}

interface PrimitiveTransactionContext {
  auditClient: PrimitiveAuditClient;
}

const RESULT_JSON_MAX_CHARS = 50 * 1024;

const logger: PrimitiveAuditLogger = {
  warn: (payload, message) => console.warn(message ?? "primitive audit warning", payload)
};

const nonCacheablePrimitives = new Set([
  "append_event_journal",
  "consume_review_intent",
  "create_replan_subtask",
  "record_transition_dry_run",
  "revert_epic_status_to_planning"
]);

const primitiveRunContext = new AsyncLocalStorage<PrimitiveRunContext>();
const primitiveTransactionContext = new AsyncLocalStorage<PrimitiveTransactionContext>();
const inFlightIdempotentRuns = new Map<string, Promise<unknown>>();
const TRANSACTION_PATCHED = Symbol.for("ccb.primitiveAudit.transactionPatched");
const isVitest =
  Boolean(process.env.VITEST) ||
  Boolean(process.env.VITEST_POOL_ID) ||
  Boolean(process.env.VITEST_WORKER_ID) ||
  process.env.NODE_ENV === "test";

installTransactionAuditContext();

function serializeResult(result: unknown): string | null {
  const serialized = JSON.stringify(result);
  if (serialized === undefined) {
    return null;
  }
  return serialized.length > RESULT_JSON_MAX_CHARS ? truncateSerializedResult(serialized) : serialized;
}

function truncateSerializedResult(serialized: string): string {
  let previewLength = Math.min(serialized.length, RESULT_JSON_MAX_CHARS);
  while (previewLength > 0) {
    const truncated = JSON.stringify({
      truncated: true,
      originalLength: serialized.length,
      value: serialized.slice(0, previewLength)
    });
    if (truncated.length <= RESULT_JSON_MAX_CHARS) {
      return truncated;
    }
    previewLength -= Math.max(1, truncated.length - RESULT_JSON_MAX_CHARS);
  }

  return JSON.stringify({
    truncated: true,
    originalLength: serialized.length,
    value: ""
  });
}

function serializeError(error: unknown): string {
  if (error instanceof Error) {
    return JSON.stringify({
      name: error.name,
      message: error.message,
      stack: error.stack
    });
  }

  return JSON.stringify({
    name: "NonError",
    message: String(error)
  });
}

function parseCachedResult<T>(value: string): T {
  return JSON.parse(value, (_key, parsedValue: unknown) => {
    if (typeof parsedValue !== "string") {
      return parsedValue;
    }
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(parsedValue)) {
      return parsedValue;
    }
    const date = new Date(parsedValue);
    return Number.isNaN(date.getTime()) ? parsedValue : date;
  }) as T;
}

function shouldUseIdempotency<T>(input: PrimitiveWrapperInput<T>): boolean {
  return Boolean(input.idempotencyKey) && !nonCacheablePrimitives.has(input.primitive);
}

function shouldAuditPrimitive<T>(input: PrimitiveWrapperInput<T>): boolean {
  return !isVitest || input.primitive.startsWith("test_");
}

async function flushAuditRows(audits: DeferredPrimitiveAudit[], warningMessage: string): Promise<void> {
  for (const audit of audits) {
    try {
      await prisma.primitiveAudit.create({
        data: audit
      });
    } catch (error) {
      logger.warn(
        {
          err: error,
          primitive: audit.primitive,
          mutationType: audit.mutationType,
          idempotencyKey: audit.idempotencyKey
        },
        warningMessage
      );
    }
  }
}

async function flushDeferredAudits(context: PrimitiveRunContext): Promise<void> {
  await flushAuditRows(context.deferredAudits.splice(0), "primitive deferred audit insert failed");
}

function startAuditInsert<T>(
  auditClient: PrimitiveAuditClient,
  input: PrimitiveWrapperInput<T>,
  idempotencyKey: string | null
): Promise<PrimitiveAuditRecord> {
  return auditClient.primitiveAudit
    .create({
      data: {
        primitive: input.primitive,
        mutationType: input.mutationType,
        idempotencyKey,
        status: "running"
      },
      select: {
        id: true
      }
    })
    .catch((error: unknown) => {
      logger.warn(
        {
          err: error,
          primitive: input.primitive,
          mutationType: input.mutationType,
          idempotencyKey
        },
        "primitive audit insert failed"
      );
      return null;
    });
}

async function markAuditCompleted<T>(
  auditClient: PrimitiveAuditClient,
  audit: PrimitiveAuditRecord,
  input: PrimitiveWrapperInput<T>,
  result: T,
  startedAt: number
): Promise<void> {
  if (!audit) {
    return;
  }
  try {
    await auditClient.primitiveAudit.update({
      where: {
        id: audit.id
      },
      data: {
        status: "completed",
        resultJson: serializeResult(result),
        completedAt: new Date(),
        durationMs: Date.now() - startedAt
      }
    });
  } catch (error) {
    logger.warn(
      {
        err: error,
        auditId: audit.id,
        primitive: input.primitive,
        mutationType: input.mutationType
      },
      "primitive audit completed update failed"
    );
  }
}

async function markAuditFailed<T>(
  auditClient: PrimitiveAuditClient,
  audit: PrimitiveAuditRecord,
  input: PrimitiveWrapperInput<T>,
  error: unknown,
  startedAt: number
): Promise<void> {
  if (!audit) {
    return;
  }
  try {
    await auditClient.primitiveAudit.update({
      where: {
        id: audit.id
      },
      data: {
        status: "failed",
        errorJson: serializeError(error),
        completedAt: new Date(),
        durationMs: Date.now() - startedAt
      }
    });
  } catch (auditError) {
    logger.warn(
      {
        err: auditError,
        auditId: audit.id,
        primitive: input.primitive,
        mutationType: input.mutationType
      },
      "primitive audit failed update failed"
    );
  }
}

async function runWithDeferredAudit<T>(
  input: PrimitiveWrapperInput<T>,
  context: PrimitiveRunContext
): Promise<T> {
  const startedAt = Date.now();
  context.depth += 1;
  try {
    const result = await input.run();
    context.deferredAudits.push({
      primitive: input.primitive,
      mutationType: input.mutationType,
      idempotencyKey: null,
      status: "completed",
      resultJson: serializeResult(result),
      errorJson: null,
      startedAt: new Date(startedAt),
      completedAt: new Date(),
      durationMs: Date.now() - startedAt
    });
    return result;
  } catch (error) {
    context.deferredAudits.push({
      primitive: input.primitive,
      mutationType: input.mutationType,
      idempotencyKey: null,
      status: "failed",
      resultJson: null,
      errorJson: serializeError(error),
      startedAt: new Date(startedAt),
      completedAt: new Date(),
      durationMs: Date.now() - startedAt
    });
    throw error;
  } finally {
    context.depth -= 1;
  }
}

async function runWithTransactionAudit<T>(
  input: PrimitiveWrapperInput<T>,
  context: PrimitiveTransactionContext
): Promise<T> {
  const auditIdempotencyKey = shouldUseIdempotency(input) ? (input.idempotencyKey ?? null) : null;
  if (auditIdempotencyKey) {
    const cached = await context.auditClient.primitiveAudit.findUnique({
      where: {
        idempotencyKey: auditIdempotencyKey
      }
    });

    if (cached?.status === "completed" && cached.resultJson) {
      return parseCachedResult<T>(cached.resultJson);
    }
  }

  const startedAt = Date.now();
  const audit = await startAuditInsert(context.auditClient, input, auditIdempotencyKey);
  try {
    const result = await input.run();
    await markAuditCompleted(context.auditClient, audit, input, result, startedAt);
    return result;
  } catch (error) {
    await markAuditFailed(context.auditClient, audit, input, error, startedAt);
    throw error;
  }
}

function installTransactionAuditContext(): void {
  type MutableTransactionTarget = {
    [TRANSACTION_PATCHED]?: true;
    $transaction: (...args: unknown[]) => Promise<unknown>;
  };

  patchTransactionTarget(PrismaClient.prototype as unknown as MutableTransactionTarget);
  patchTransactionTarget(prisma as unknown as MutableTransactionTarget);
}

function patchTransactionTarget(target: {
  [TRANSACTION_PATCHED]?: true;
  $transaction: (...args: unknown[]) => Promise<unknown>;
}): void {
  if (target[TRANSACTION_PATCHED]) {
    return;
  }
  const originalTransaction = target.$transaction;
  target.$transaction = async function patchedPrimitiveAuditTransaction(
    this: unknown,
    ...args: unknown[]
  ): Promise<unknown> {
    const boundTransaction = originalTransaction.bind(this);
    const callback = args[0];
    if (typeof callback !== "function") {
      return await boundTransaction(...args);
    }

    const wrappedCallback = async (tx: unknown): Promise<unknown> => {
      const existingContext = primitiveTransactionContext.getStore();
      const context = existingContext ?? { auditClient: tx as PrimitiveAuditClient };
      return await primitiveTransactionContext.run(context, async () => await callback(tx));
    };

    return await boundTransaction(wrappedCallback, ...args.slice(1));
  };
  target[TRANSACTION_PATCHED] = true;
}

export const primitiveExecutor = {
  async run<T>(input: PrimitiveWrapperInput<T>): Promise<T> {
    // Stage 1 · setup
    if (!input.primitive || !input.mutationType) {
      throw new Error("primitive_wrapper input requires primitive and mutationType");
    }

    if (!shouldAuditPrimitive(input)) {
      return await input.run();
    }

    const activeContext = primitiveRunContext.getStore();
    if (activeContext && activeContext.depth > 0) {
      return await runWithDeferredAudit(input, activeContext);
    }

    const activeTransactionContext = primitiveTransactionContext.getStore();
    if (activeTransactionContext) {
      return await runWithTransactionAudit(input, activeTransactionContext);
    }

    const context: PrimitiveRunContext = { depth: 0, deferredAudits: [] };
    return await primitiveRunContext.run(context, async () => await runPrimitiveWithAudit(input, context));
  }
};

async function runPrimitiveWithAudit<T>(input: PrimitiveWrapperInput<T>, context: PrimitiveRunContext): Promise<T> {
  context.depth += 1;
  try {
    const auditIdempotencyKey = shouldUseIdempotency(input) ? (input.idempotencyKey ?? null) : null;
    // Stage 2 · before
    if (auditIdempotencyKey) {
      const cached = await prisma.primitiveAudit.findUnique({
        where: {
          idempotencyKey: auditIdempotencyKey
        }
      });

      if (cached?.status === "completed" && cached.resultJson) {
        return parseCachedResult<T>(cached.resultJson);
      }

      const inFlight = inFlightIdempotentRuns.get(auditIdempotencyKey);
      if (inFlight) {
        return (await inFlight) as T;
      }
    }

    if (!auditIdempotencyKey) {
      return await executePrimitiveWithAudit(input, context, null);
    }

    const runPromise = executePrimitiveWithAudit(input, context, auditIdempotencyKey);
    inFlightIdempotentRuns.set(auditIdempotencyKey, runPromise);
    try {
      return await runPromise;
    } finally {
      if (inFlightIdempotentRuns.get(auditIdempotencyKey) === runPromise) {
        inFlightIdempotentRuns.delete(auditIdempotencyKey);
      }
    }
  } finally {
    context.depth -= 1;
  }
}

async function executePrimitiveWithAudit<T>(
  input: PrimitiveWrapperInput<T>,
  context: PrimitiveRunContext,
  auditIdempotencyKey: string | null
): Promise<T> {
  const startedAt = Date.now();

  // Stage 3 · audit insert
  const audit = await startAuditInsert(prisma, input, auditIdempotencyKey);

  try {
    // Stage 4 · run
    const result = await input.run();

    // Stage 5 · after
    await flushDeferredAudits(context);
    await markAuditCompleted(prisma, audit, input, result, startedAt);

    return result;
  } catch (error) {
    // Stage 6 · cleanup
    await markAuditFailed(prisma, audit, input, error, startedAt);

    throw error;
  }
}
