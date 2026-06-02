import type { EventJournal } from "@prisma/client";
import { z } from "zod";

import { prisma } from "../../db/prisma.js";

const nonEmptyStringSchema = z.string().trim().min(1);

export const activityRecentQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(50).default(10)
  })
  .strict();

export const activityEventSchema = z
  .object({
    event_id: nonEmptyStringSchema,
    event_type: nonEmptyStringSchema,
    subject_type: nonEmptyStringSchema.optional(),
    subject_id: nonEmptyStringSchema.optional(),
    task_id: nonEmptyStringSchema.optional(),
    project_id: nonEmptyStringSchema.optional(),
    at: z.string().datetime(),
    summary: nonEmptyStringSchema.optional(),
    payload: z.record(z.unknown()).optional()
  })
  .strict();

export const activityRecentResponseSchema = z
  .object({
    events: z.array(activityEventSchema)
  })
  .strict();

export type ActivityRecentQuery = z.infer<typeof activityRecentQuerySchema>;
export type ActivityEvent = z.infer<typeof activityEventSchema>;
export type ActivityRecentResponse = z.infer<typeof activityRecentResponseSchema>;

export async function getRecentActivity(query: ActivityRecentQuery): Promise<ActivityRecentResponse> {
  const events = await prisma.eventJournal.findMany({
    orderBy: [
      {
        emittedAt: "desc"
      },
      {
        createdAt: "desc"
      }
    ],
    take: query.limit
  });

  return activityRecentResponseSchema.parse({
    events: events.map((event) => ({
      event_id: event.eventId,
      event_type: event.eventType,
      subject_type: event.subjectType,
      subject_id: event.subjectId,
      task_id: event.subjectType === "subtask" ? event.subjectId : undefined,
      project_id: event.projectId,
      at: event.emittedAt.toISOString(),
      summary: buildActivitySummary(event),
      payload: parsePayloadRecord(event.payloadJson)
    }))
  });
}

function buildActivitySummary(event: EventJournal): string {
  const taskLabel = event.subjectKey || event.subjectId;
  const payload = parsePayloadRecord(event.payloadJson);

  if (event.eventType === "codex_receipt_ready") {
    return `${taskLabel} receipt ready (codex)`;
  }

  if (event.eventType === "transition.applied") {
    const source = readString(payload.source) ?? readString(payload.source_node);
    const target = readString(payload.target) ?? readString(payload.target_node);
    const route = source && target ? ` (${source}->${target})` : "";
    return `${taskLabel} transition apply${route}`;
  }

  if (event.eventType === "capability.fallback") {
    const capability = readString(payload.cap_id) ?? readString(payload.capability) ?? "unknown";
    const provider = readString(payload.provider) ?? readString(payload.resolved_binding) ?? "fallback";
    return `${taskLabel} capability fallback (${capability} -> ${provider})`;
  }

  if (event.eventType === "capability.missing") {
    const capability = readString(payload.cap_id) ?? readString(payload.capability) ?? "unknown";
    return `${taskLabel} capability missing (${capability})`;
  }

  return `${taskLabel} ${event.eventType}`;
}

function parsePayloadRecord(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return {
      value: parsed
    };
  } catch {
    return {
      value
    };
  }
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export const activityService = {
  getRecentActivity
};
