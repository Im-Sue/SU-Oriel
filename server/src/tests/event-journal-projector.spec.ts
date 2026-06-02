import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import type { EventJournal } from "@prisma/client";
import { test } from "vitest";

import { eventJournalRowToEnvelope } from "../modules/events/event-journal.projector.js";
import { EVENT_STORE_SCHEMA_VERSION, type EventJournalEventType } from "../modules/events/event-journal.types.js";

const payloadByType: Record<EventJournalEventType, Record<string, unknown>> = {
  codex_receipt_ready: { receipt_ref: "r.md", provider: "codex", receipt_summary: "done", unsolicited_findings: [] },
  user_arbitration_submitted: { decision_ref: "d1", verdict: "continue", notes: "ok", reentry_node: "implementation" },
  session_resumed: { resume_source: "user", waiting_ref: "w1", resumed_by: "claude" },
  state_write_conflict: {
    resource_type: "task_state",
    expected_revision: 1,
    actual_revision: 2,
    writer: "codex",
    primitive: "write_state"
  },
  verification_finished: { result: "passed", build: { ok: true }, test: { ok: true }, artifact_refs: ["log.txt"] },
  batch_cancelled: { reason: "user request", cancelled_by: "claude", affected_task_ids: ["task-1"] },
  tool_call_denied: { tool: "shell", capability: "filesystem.write", reason: "policy", policy_profile: "default" },
  codex_picked_up: { dispatch_id: "dispatch-1", agent_id: "codex-1", workspace_ref: "workspace-1" },
  codex_rejected: { reason: "invalid spec", spec_path: "docs/03_开发计划/spec.md", diagnostics: { field: "mode" } },
  requirement_materialized: {
    requirement_id: "req-1",
    subtask_count: 2,
    plan_spec_path: "docs/03_开发计划/requirement.md",
    draft_hash: "b".repeat(64)
  },
  subtask_planning_inherited: {
    requirement_id: "req-1",
    subtask_id: "subtask-1",
    section_id: "pr1-contract",
    linked_spec_id: "docs/03_开发计划/requirement.md"
  },
  anchor_dispatch_queued: {
    jobId: "job_dispatch_queued",
    command:
      '/ccb:su-flow --payload {"language":"中文","project_id":"project-1","requirement_id":"req-1","step":"design","subject":"requirement"}',
    dispatchPayload: {
      language: "中文",
      project_id: "project-1",
      requirement_id: "req-1",
      step: "design",
      subject: "requirement"
    },
    step: "design"
  },
  anchor_dispatch_submitted: {
    jobId: "job_dispatch_queued",
    traceRef: "trace-1",
    readinessWarning: false
  },
  anchor_dispatch_failed: {
    jobId: "job_dispatch_queued",
    errorCode: "ANCHOR_SOCKET_NOT_READY",
    errorMessage: "anchor socket is not ready"
  },
  slot_bound: {
    slotId: "slot-1",
    requirementId: "req-1",
    reason: "new_requirement"
  },
  slot_released: {
    slotId: "slot-1",
    requirementId: "req-1",
    reason: "manual_release",
    releasedBy: "user",
    operatorReason: "operator requested release"
  },
  slot_queued_request: {
    jobId: "job_slot_queued",
    slotId: null,
    command: "/ccb:su-flow --payload {}",
    dispatchPayload: { subject: "requirement" },
    step: "analysis",
    reason: "no_idle_slot"
  },
  slot_runtime_degraded: {
    slotId: "slot-1",
    reason: "busy_timeout",
    severity: "error"
  },
  slot_stale: {
    requirementId: "req-1",
    lastActivityAt: "2026-05-01T00:00:00.000Z",
    staleDays: 9,
    policyVersion: "slot-stale-policy-v1"
  },
  slot_recovered: {
    slotId: "slot-1",
    recoveredAt: "2026-05-23T00:00:00.000Z",
    recoveryRef: "manual"
  }
};

function row(eventType: string, payload: unknown, overrides: Partial<EventJournal> = {}): EventJournal {
  return {
    id: `evt_${randomUUID()}`,
    eventId: randomUUID(),
    eventType,
    projectId: "project-1",
    subjectType: "subtask",
    subjectId: "task-1",
    subjectKey: "TASK-1",
    payloadJson: JSON.stringify(payload),
    emittedAt: new Date("2026-05-08T12:00:00.000Z"),
    sourceActor: "codex",
    sourceComponent: "primitive_executor",
    causationId: "cause-1",
    correlationId: "corr-1",
    stateRevisionSeen: 7,
    idempotencyKey: "idem-1",
    anchorId: null,
    createdAt: new Date("2026-05-08T12:00:01.000Z"),
    updatedAt: new Date("2026-05-08T12:00:02.000Z"),
    ...overrides
  };
}

test.each(Object.entries(payloadByType))("projects %s EventJournal row to event-store envelope", (eventType, payload) => {
  const event = row(eventType, payload);
  const result = eventJournalRowToEnvelope(event);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.event_id, event.eventId);
  assert.equal(result.value.event_type, eventType);
  assert.equal(result.value.schema_version, EVENT_STORE_SCHEMA_VERSION);
  assert.equal(result.value.project_id, event.projectId);
  assert.equal(result.value.subject_type, event.subjectType);
  assert.equal(result.value.subject_id, event.subjectId);
  assert.equal(result.value.subject_key, event.subjectKey);
  assert.equal(result.value.emitted_at, event.emittedAt.toISOString());
  assert.equal(result.value.source_actor, event.sourceActor);
  assert.equal(result.value.source_component, event.sourceComponent);
  assert.equal(result.value.causation_id, event.causationId);
  assert.equal(result.value.correlation_id, event.correlationId);
  assert.equal(result.value.state_revision_seen, event.stateRevisionSeen);
  assert.equal(result.value.idempotency_key, event.idempotencyKey);
  assert.deepEqual(result.value.payload, payload);
});

test("projects anchor column into optional envelope fields", () => {
  const result = eventJournalRowToEnvelope(
    row("codex_receipt_ready", payloadByType.codex_receipt_ready, {
      anchorId: "anchor-projector-1"
    })
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.anchor_id, "anchor-projector-1");
});

test("omits nullable optional envelope fields when EventJournal row stores null", () => {
  const result = eventJournalRowToEnvelope(
    row("codex_receipt_ready", payloadByType.codex_receipt_ready, {
      causationId: null,
      correlationId: null,
      stateRevisionSeen: null,
      idempotencyKey: null
    })
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal("causation_id" in result.value, false);
  assert.equal("correlation_id" in result.value, false);
  assert.equal("state_revision_seen" in result.value, false);
  assert.equal("idempotency_key" in result.value, false);
});

test("returns payload_parse error for malformed payload JSON", () => {
  const event = row("codex_receipt_ready", payloadByType.codex_receipt_ready, { payloadJson: "{bad-json" });
  const result = eventJournalRowToEnvelope(event);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error.kind, "payload_parse");
  assert.match(result.error.detail, new RegExp(event.eventId));
});

test("returns schema_invalid error for payload that does not match event schema", () => {
  const event = row("codex_receipt_ready", { provider: "codex" });
  const result = eventJournalRowToEnvelope(event);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error.kind, "schema_invalid");
  assert.match(result.error.detail, new RegExp(event.eventId));
});

test("returns unknown_event_type error before payload schema validation", () => {
  const result = eventJournalRowToEnvelope(row("not_canonical", {}));
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error.kind, "unknown_event_type");
  assert.match(result.error.detail, /not_canonical/);
});
