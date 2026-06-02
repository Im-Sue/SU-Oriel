import type { EventJournal, ReviewIntent } from "@prisma/client";

import { prisma } from "../../db/prisma.js";
import {
  taskConsultationResponseSchema,
  type TaskConsultationEvent,
  type TaskConsultationResponse
} from "./task-consultation.schemas.js";

const PAYLOAD_PREVIEW_MAX_LENGTH = 500;

interface ConsultationTaskProjection {
  id: string;
  currentNode: string | null;
}

interface RoundMetadata {
  roundNumber: number;
  nodeId?: string;
  intent?: string;
  intentScore?: number;
  tokensIn?: number;
  tokensOut?: number;
  payloadPreview?: string;
}

interface RoundAccumulator {
  round_number: number;
  node_id: string;
  events: TaskConsultationEvent[];
}

export class TaskConsultationNotFoundError extends Error {
  public constructor() {
    super("任务不存在");
  }
}

export async function getTaskConsultation(taskId: string): Promise<TaskConsultationResponse> {
  const task = await prisma.task.findUnique({
    where: {
      id: taskId
    },
    select: {
      id: true,
      currentNode: true
    }
  });

  if (!task) {
    throw new TaskConsultationNotFoundError();
  }

  const [reviewIntents, codexEvents] = await Promise.all([
    prisma.reviewIntent.findMany({
      where: {
        taskId
      },
      orderBy: {
        createdAt: "asc"
      }
    }),
    prisma.eventJournal.findMany({
      where: {
        subjectType: "subtask",
        subjectId: taskId,
        eventType: {
          startsWith: "codex_"
        }
      },
      orderBy: {
        emittedAt: "asc"
      }
    })
  ]);

  const rounds = new Map<number, RoundAccumulator>();
  const intentMetadataById = new Map<string, RoundMetadata>();

  reviewIntents.forEach((intent, index) => {
    const metadata = extractReviewIntentMetadata(intent, index);
    intentMetadataById.set(intent.id, metadata);
    const round = ensureRound(rounds, metadata.roundNumber, metadata.nodeId ?? task.currentNode ?? "unknown");
    round.events.push(buildReviewIntentEvent(intent, metadata));
  });

  codexEvents.forEach((event, index) => {
    const matchedIntentMetadata = findMatchedIntentMetadata(event, intentMetadataById);
    const eventMetadata = extractEventMetadata(event, index, matchedIntentMetadata);
    const round = ensureRound(rounds, eventMetadata.roundNumber, eventMetadata.nodeId ?? task.currentNode ?? "unknown");
    round.events.push(buildCodexEvent(event, eventMetadata));
  });

  return taskConsultationResponseSchema.parse({
    rounds: Array.from(rounds.values())
      .map((round) => ({
        ...round,
        events: round.events.sort((left, right) => new Date(left.at).getTime() - new Date(right.at).getTime())
      }))
      .sort((left, right) => right.round_number - left.round_number)
  });
}

function ensureRound(
  rounds: Map<number, RoundAccumulator>,
  roundNumber: number,
  nodeId: string
): RoundAccumulator {
  const existing = rounds.get(roundNumber);
  if (existing) {
    if (existing.node_id === "unknown" && nodeId !== "unknown") {
      existing.node_id = nodeId;
    }
    return existing;
  }

  const round = {
    round_number: roundNumber,
    node_id: nodeId,
    events: []
  };
  rounds.set(roundNumber, round);
  return round;
}

function buildReviewIntentEvent(intent: ReviewIntent, metadata: RoundMetadata): TaskConsultationEvent {
  return {
    event_id: `review_intent:${intent.id}`,
    sender: "claude",
    receiver: "codex",
    intent: metadata.intent ?? intent.intentType,
    ...(metadata.intentScore !== undefined ? { intent_score: metadata.intentScore } : {}),
    ...(metadata.tokensIn !== undefined ? { tokens_in: metadata.tokensIn } : {}),
    ...(metadata.tokensOut !== undefined ? { tokens_out: metadata.tokensOut } : {}),
    at: intent.createdAt.toISOString(),
    ...(metadata.payloadPreview ? { payload_preview: metadata.payloadPreview } : {})
  };
}

function buildCodexEvent(event: EventJournal, metadata: RoundMetadata): TaskConsultationEvent {
  return {
    event_id: event.eventId,
    sender: "codex",
    receiver: "claude",
    intent: metadata.intent ?? event.eventType,
    ...(metadata.intentScore !== undefined ? { intent_score: metadata.intentScore } : {}),
    ...(metadata.tokensIn !== undefined ? { tokens_in: metadata.tokensIn } : {}),
    ...(metadata.tokensOut !== undefined ? { tokens_out: metadata.tokensOut } : {}),
    at: event.emittedAt.toISOString(),
    payload_preview: buildPayloadPreview(parseJson(event.payloadJson))
  };
}

function findMatchedIntentMetadata(
  event: EventJournal,
  intentMetadataById: Map<string, RoundMetadata>
): RoundMetadata | null {
  if (event.correlationId && intentMetadataById.has(event.correlationId)) {
    return intentMetadataById.get(event.correlationId) ?? null;
  }

  if (event.causationId && intentMetadataById.has(event.causationId)) {
    return intentMetadataById.get(event.causationId) ?? null;
  }

  return null;
}

function extractReviewIntentMetadata(intent: ReviewIntent, index: number): RoundMetadata {
  const payload = parseJson(intent.payloadJson);
  const objectPayload = asRecord(payload);
  return {
    roundNumber: readPositiveInt(objectPayload?.round_number) ?? index + 1,
    nodeId: readString(objectPayload?.node_id),
    intent: readString(objectPayload?.intent),
    intentScore: readNumber(objectPayload?.intent_score),
    tokensIn: readNonNegativeInt(objectPayload?.tokens_in),
    tokensOut: readNonNegativeInt(objectPayload?.tokens_out),
    payloadPreview: buildPayloadPreview(payload)
  };
}

function extractEventMetadata(
  event: EventJournal,
  index: number,
  matchedIntentMetadata: RoundMetadata | null
): RoundMetadata {
  const payload = asRecord(parseJson(event.payloadJson));
  return {
    roundNumber: readPositiveInt(payload?.round_number) ?? matchedIntentMetadata?.roundNumber ?? index + 1,
    nodeId: readString(payload?.node_id) ?? matchedIntentMetadata?.nodeId,
    intent: readString(payload?.intent) ?? event.eventType,
    intentScore: readNumber(payload?.intent_score) ?? matchedIntentMetadata?.intentScore,
    tokensIn: readNonNegativeInt(payload?.tokens_in) ?? matchedIntentMetadata?.tokensIn,
    tokensOut: readNonNegativeInt(payload?.tokens_out) ?? matchedIntentMetadata?.tokensOut
  };
}

function parseJson(value: string | null): unknown {
  if (!value) {
    return null;
  }

  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }

  return null;
}

function buildPayloadPreview(value: unknown): string | undefined {
  if (value === null || value === undefined) {
    return undefined;
  }

  const serialized = typeof value === "string" ? value : JSON.stringify(value);
  return serialized.length > PAYLOAD_PREVIEW_MAX_LENGTH
    ? serialized.slice(0, PAYLOAD_PREVIEW_MAX_LENGTH)
    : serialized;
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function readNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function readPositiveInt(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : undefined;
}

function readNonNegativeInt(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : undefined;
}

export const taskConsultationService = {
  getTaskConsultation
};
