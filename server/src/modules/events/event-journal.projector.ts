import type { EventJournal } from "@prisma/client";

import { emitEventSchema, type ParsedEmitEventInput } from "./event-journal.schemas.js";
import { EVENT_JOURNAL_EVENT_TYPES, EVENT_STORE_SCHEMA_VERSION } from "./event-journal.types.js";

export type EmittedEvent = ParsedEmitEventInput;
export type ProjectionError = {
  kind: "payload_parse" | "schema_invalid" | "unknown_event_type";
  detail: string;
};
export type Result<T, E> = { ok: true; value: T } | { ok: false; error: E };

function err(kind: ProjectionError["kind"], detail: string): Result<never, ProjectionError> {
  return { ok: false, error: { kind, detail } };
}

export function eventJournalRowToEnvelope(row: EventJournal): Result<EmittedEvent, ProjectionError> {
  let payload: unknown;
  try {
    payload = JSON.parse(row.payloadJson);
  } catch (error) {
    return err(
      "payload_parse",
      `EventJournal ${row.eventId} payloadJson parse failed: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  if (!(EVENT_JOURNAL_EVENT_TYPES as readonly string[]).includes(row.eventType)) {
    return err("unknown_event_type", `EventJournal ${row.eventId} has unsupported eventType: ${row.eventType}`);
  }

  const envelope = {
    event_id: row.eventId,
    event_type: row.eventType,
    schema_version: EVENT_STORE_SCHEMA_VERSION,
    project_id: row.projectId,
    subject_type: row.subjectType,
    subject_id: row.subjectId,
    subject_key: row.subjectKey,
    payload,
    emitted_at: row.emittedAt.toISOString(),
    ...Object.fromEntries(
      [
        ["source_actor", row.sourceActor],
        ["source_component", row.sourceComponent],
        ["anchor_id", row.anchorId],
        ["causation_id", row.causationId],
        ["correlation_id", row.correlationId],
        ["state_revision_seen", row.stateRevisionSeen],
        ["idempotency_key", row.idempotencyKey]
      ].filter(([, value]) => value !== null && value !== undefined)
    )
  };

  const parsed = emitEventSchema.safeParse(envelope);
  return parsed.success
    ? { ok: true, value: parsed.data }
    : err("schema_invalid", `EventJournal ${row.eventId} envelope schema invalid: ${parsed.error.message}`);
}
