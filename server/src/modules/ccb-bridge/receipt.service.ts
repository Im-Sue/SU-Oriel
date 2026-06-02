import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

import { prisma } from "../../db/prisma.js";
import {
  emitEvent,
  EventJournalProjectMismatchError,
  EventJournalTaskNotFoundError,
  serializeEventJournal
} from "../events/event-journal.service.js";
import type { EmitEventInput } from "../events/event-journal.schemas.js";
import type { SubmitEventJournalResult } from "../events/event-journal.types.js";
import type { CodexReceiptBridgeInput } from "./receipt.schemas.js";

const SOURCE_COMPONENT = "codex-receipt-bridge";
const DEFAULT_RETRY_DELAYS_MS = [250, 1_000] as const;

export interface ReceiptBridgeDeadLetterRecord {
  input: CodexReceiptBridgeInput;
  attempts: number;
  lastError: {
    name: string;
    message: string;
  };
  failedAt: string;
}

export interface ReceiptBridgeDeadLetterResult {
  success: false;
  result: "dead_lettered";
  attempts: number;
  deadLetterId: string;
  lastError: string;
}

export type ReceiptBridgeResult = SubmitEventJournalResult | ReceiptBridgeDeadLetterResult;

export interface ReceiptBridgeDependencies {
  emitEvent?: (input: EmitEventInput) => Promise<SubmitEventJournalResult>;
  findExistingEventByReplyId?: (replyId: string) => Promise<SubmitEventJournalResult | null>;
  writeDeadLetter?: (record: ReceiptBridgeDeadLetterRecord) => Promise<string>;
  retryDelaysMs?: readonly number[];
}

export async function ingestCodexReceipt(
  input: CodexReceiptBridgeInput,
  dependencies: ReceiptBridgeDependencies = {}
): Promise<ReceiptBridgeResult> {
  const existing = await (dependencies.findExistingEventByReplyId ?? findExistingEventByReplyId)(input.reply_id);
  if (existing) {
    return existing;
  }

  const eventInput = buildCodexReceiptEvent(input);
  const emit = dependencies.emitEvent ?? emitEvent;
  const retryDelaysMs = dependencies.retryDelaysMs ?? DEFAULT_RETRY_DELAYS_MS;
  const attempts = retryDelaysMs.length + 1;
  let lastError: unknown = null;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await emit(eventInput);
    } catch (error) {
      if (isNonRetryableEventError(error)) {
        throw error;
      }
      lastError = error;
      if (attempt < attempts) {
        await sleep(retryDelaysMs[attempt - 1] ?? 0);
      }
    }
  }

  const deadLetterRecord = buildDeadLetterRecord(input, attempts, lastError);
  const deadLetterId = await (dependencies.writeDeadLetter ?? writeReceiptDeadLetter)(deadLetterRecord);
  return {
    success: false,
    result: "dead_lettered",
    attempts,
    deadLetterId,
    lastError: deadLetterRecord.lastError.message
  };
}

function buildCodexReceiptEvent(input: CodexReceiptBridgeInput): EmitEventInput {
  const completedAt = input.completed_at ?? new Date().toISOString();
  const payload: {
    receipt_ref: string;
    provider: string;
    receipt_summary: string;
    unsolicited_findings: unknown[];
    job_id: string;
    reply_id: string;
    status: string;
    completed_at: string;
    spec_id?: string;
  } = {
    receipt_ref: input.receipt_ref ?? `ccb://codex-receipts/${input.reply_id}`,
    provider: input.provider,
    receipt_summary: input.receipt_summary ?? summarizeReply(input.reply_text),
    unsolicited_findings: input.unsolicited_findings,
    job_id: input.job_id,
    reply_id: input.reply_id,
    status: input.status,
    completed_at: completedAt
  };
  if (input.spec_id) {
    payload.spec_id = input.spec_id;
  }

  return {
    event_id: stableUuidFromText(`codex-receipt-bridge:${input.reply_id}`),
    event_type: "codex_receipt_ready",
    ...(input.project_id ? { project_id: input.project_id } : {}),
    task_id: input.task_id,
    payload,
    emitted_at: completedAt,
    source_actor: "codex",
    source_component: SOURCE_COMPONENT,
    causation_id: input.job_id,
    correlation_id: input.spec_id ?? input.job_id,
    idempotency_key: input.reply_id
  };
}

async function findExistingEventByReplyId(replyId: string): Promise<SubmitEventJournalResult | null> {
  const event = await prisma.eventJournal.findFirst({
    where: {
      eventType: "codex_receipt_ready",
      idempotencyKey: replyId
    },
    orderBy: {
      emittedAt: "desc"
    }
  });
  return event
    ? {
        success: true,
        result: "already_recorded",
        idempotent: true,
        event: serializeEventJournal(event)
      }
    : null;
}

function summarizeReply(replyText: string | undefined): string {
  const text = replyText?.trim();
  if (!text) {
    return "Codex receipt completed";
  }
  return text.length > 500 ? text.slice(0, 500) : text;
}

function stableUuidFromText(value: string): string {
  const bytes = Buffer.from(createHash("sha256").update(value, "utf8").digest("hex").slice(0, 32), "hex");
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function isNonRetryableEventError(error: unknown): boolean {
  return error instanceof EventJournalTaskNotFoundError || error instanceof EventJournalProjectMismatchError;
}

function buildDeadLetterRecord(
  input: CodexReceiptBridgeInput,
  attempts: number,
  error: unknown
): ReceiptBridgeDeadLetterRecord {
  const normalizedError =
    error instanceof Error
      ? {
          name: error.name,
          message: error.message
        }
      : {
          name: "NonError",
          message: String(error)
        };
  return {
    input,
    attempts,
    lastError: normalizedError,
    failedAt: new Date().toISOString()
  };
}

async function writeReceiptDeadLetter(record: ReceiptBridgeDeadLetterRecord): Promise<string> {
  const dir = resolveDeadLetterDir();
  await mkdir(dir, { recursive: true });
  const safeReplyId = record.input.reply_id.replace(/[^a-zA-Z0-9_.-]/g, "_").slice(0, 120);
  const filePath = join(dir, `${Date.now()}-${safeReplyId}.json`);
  await writeFile(filePath, JSON.stringify(record, null, 2), "utf8");
  return filePath;
}

function resolveDeadLetterDir(startPath = process.env.CCB_PROJECT_ROOT ?? process.cwd()): string {
  let current = resolve(startPath);
  while (true) {
    if (existsSync(join(current, ".ccb"))) {
      return join(current, ".ccb", "bridge-dead-letter", "codex-receipts");
    }
    if (current.endsWith(".ccb")) {
      return join(current, "bridge-dead-letter", "codex-receipts");
    }
    const parent = dirname(current);
    if (parent === current) {
      return join(resolve(startPath), ".ccb", "bridge-dead-letter", "codex-receipts");
    }
    current = parent;
  }
}

function sleep(ms: number): Promise<void> {
  return ms <= 0 ? Promise.resolve() : new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}
