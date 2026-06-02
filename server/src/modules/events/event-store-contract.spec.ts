import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { promisify } from "node:util";

import { afterAll, test, vi } from "vitest";

import { buildApp } from "../../app.js";
import { prisma } from "../../db/prisma.js";
import { PrismaProjectStore } from "../project/project.store.prisma.js";
import { resolveCcbProjectRoot } from "../../lib/project-root.js";

vi.setConfig({ testTimeout: 15000, hookTimeout: 15000 });

const execFileAsync = promisify(execFile);
const schemaPath = resolve(resolveCcbProjectRoot(), "docs/.ccb/schemas/event-store-contract-v0.1.json");

const EVENT_TYPES = [
  "codex_receipt_ready",
  "user_arbitration_submitted",
  "session_resumed",
  "state_write_conflict",
  "verification_finished",
  "batch_cancelled",
  "tool_call_denied",
  "codex_picked_up",
  "codex_rejected",
  "requirement_materialized",
  "subtask_planning_inherited"
] as const;

type EventType = (typeof EVENT_TYPES)[number];

async function resetDatabase(): Promise<void> {
  await prisma.$transaction([
    prisma.$executeRawUnsafe('DELETE FROM "EventJournal"'),
    prisma.$executeRawUnsafe('DELETE FROM "ReviewIntent"'),
    prisma.$executeRawUnsafe('DELETE FROM "TaskWorkspace"'),
    prisma.$executeRawUnsafe('DELETE FROM "SyncJob"'),
    prisma.$executeRawUnsafe('DELETE FROM "Requirement"'),
    prisma.$executeRawUnsafe('DELETE FROM "Task"'),
    prisma.$executeRawUnsafe('DELETE FROM "Document"'),
    prisma.$executeRawUnsafe('DELETE FROM "Project"')
  ]);
}

async function createTaskFixture(): Promise<{ projectId: string; taskId: string; taskKey: string; requirementId: string; requirementTitle: string }> {
  const project = await prisma.project.create({
    data: {
      name: `Event Store Project ${randomUUID()}`,
      localPath: join(tmpdir(), `ccb-event-store-${randomUUID()}`),
      updatedAt: new Date()
    }
  });
  const task = await prisma.task.create({
    data: {
      projectId: project.id,
      taskKey: `task-${randomUUID()}`,
      title: "Event store task",
      status: "reviewing",
      currentNode: "implementation",
      nodeSubstate: "executing",
      runtimeState: "waiting_codex",
      lastTransitionId: "dispatch__on_codex_pickup__to__implementation",
      updatedAt: new Date()
    }
  });
  const requirement = await prisma.requirement.create({
    data: {
      projectId: project.id,
      title: `Requirement ${randomUUID()}`,
      description: "Requirement materialization subject",
      status: "planning"
    }
  });

  return {
    projectId: project.id,
    taskId: task.id,
    taskKey: task.taskKey,
    requirementId: requirement.id,
    requirementTitle: requirement.title
  };
}

function validPayloadFor(eventType: EventType): Record<string, unknown> {
  switch (eventType) {
    case "codex_receipt_ready":
      return {
        receipt_ref: "docs/.ccb/state/task.md",
        provider: "codex",
        receipt_summary: "implementation finished",
        unsolicited_findings: []
      };
    case "user_arbitration_submitted":
      return {
        decision_ref: "docs/.ccb/arbitration/decision.md",
        verdict: "approve",
        notes: "continue"
      };
    case "session_resumed":
      return {
        resume_source: "scheduler",
        waiting_ref: "wait:review",
        resumed_by: "system"
      };
    case "state_write_conflict":
      return {
        resource_type: "task_state",
        expected_revision: 4,
        actual_revision: 5,
        writer: "primitive_executor",
        primitive: "apply_transition"
      };
    case "verification_finished":
      return {
        result: "pass",
        build: {
          status: "passed"
        },
        test: {
          status: "passed"
        },
        artifact_refs: ["logs/verification.txt"]
      };
    case "batch_cancelled":
      return {
        reason: "user_cancelled",
        cancelled_by: "claude",
        affected_task_ids: ["task-a", "task-b"]
      };
    case "tool_call_denied":
      return {
        tool: "exec_command",
        capability: "implementation.execute",
        reason: "policy_denied",
        policy_profile: "default"
      };
    case "codex_picked_up":
      return {
        dispatch_id: "dispatch-1",
        agent_id: "codex-1",
        workspace_ref: "worktree:e6-t1"
      };
    case "codex_rejected":
      return {
        reason: "spec_unreadable",
        spec_path: "docs/03_开发计划/e6-t1.md",
        diagnostics: {
          detail: "missing file"
        }
      };
    case "requirement_materialized":
      return {
        requirement_id: "requirement-1",
        subtask_count: 3,
        plan_spec_path: "docs/03_开发计划/requirement-materialized.md",
        draft_hash: "c".repeat(64)
      };
    case "subtask_planning_inherited":
      return {
        requirement_id: "requirement-1",
        subtask_id: "subtask-1",
        section_id: "pr1-contract",
        linked_spec_id: "docs/03_开发计划/requirement-materialized.md"
      };
  }
}

function buildEventStorePayload(
  fixture: { projectId: string; taskId: string; taskKey: string; requirementId: string; requirementTitle: string },
  eventType: EventType,
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  const subject =
    eventType === "requirement_materialized"
      ? {
          subject_type: "requirement",
          subject_id: fixture.requirementId,
          subject_key: fixture.requirementTitle
        }
      : {
          subject_type: "subtask",
          subject_id: fixture.taskId,
          subject_key: fixture.taskKey
        };
  return {
    event_id: randomUUID(),
    event_type: eventType,
    schema_version: "event-store-v0.1",
    project_id: fixture.projectId,
    ...subject,
    payload: validPayloadFor(eventType),
    emitted_at: "2026-05-03T00:00:00.000Z",
    source_actor: "system",
    source_component: "console",
    causation_id: "event-prev",
    correlation_id: "corr-e6-t1",
    state_revision_seen: 12,
    idempotency_key: `event-store:${eventType}`,
    ...overrides
  };
}

async function validateWithJsonSchema(event: Record<string, unknown>): Promise<void> {
  await execFileAsync("python3", [
    "-c",
    [
      "import json,jsonschema,sys",
      "schema=json.load(open(sys.argv[1]))",
      "event=json.loads(sys.argv[2])",
      "jsonschema.Draft202012Validator.check_schema(schema)",
      "jsonschema.Draft202012Validator(schema).validate(event)"
    ].join(";"),
    schemaPath,
    JSON.stringify(event)
  ]);
}

test("event-store contract schema is Draft 2020-12 with oneOf for canonical event types", async () => {
  await resetDatabase();
  const fixture = await createTaskFixture();

  const schema = JSON.parse(await readFile(schemaPath, "utf8")) as { $schema: string; oneOf: unknown[] };
  assert.equal(schema.$schema, "https://json-schema.org/draft/2020-12/schema");
  assert.equal(schema.oneOf.length, EVENT_TYPES.length);
  const serialized = JSON.stringify(schema);
  for (const eventType of EVENT_TYPES) {
    assert.match(serialized, new RegExp(`"const":"${eventType}"`));
    await validateWithJsonSchema(buildEventStorePayload(fixture, eventType));
    await assert.rejects(
      validateWithJsonSchema(
        buildEventStorePayload(fixture, eventType, {
          payload: {}
        })
      )
    );
  }
});

test("event-store contract accepts optional nullable anchor envelope fields", async () => {
  await resetDatabase();
  const fixture = await createTaskFixture();

  await validateWithJsonSchema(
    buildEventStorePayload(fixture, "codex_receipt_ready", {
      anchor_id: "anchor-contract-1"
    })
  );
  await validateWithJsonSchema(
    buildEventStorePayload(fixture, "codex_receipt_ready", {
      anchor_id: null
    })
  );
});

for (const eventType of EVENT_TYPES) {
  test(`emitEvent accepts valid ${eventType}`, async () => {
    const app = buildApp({
      projectStore: new PrismaProjectStore(prisma)
    });

    await resetDatabase();
    const fixture = await createTaskFixture();
    const response = await app.inject({
      method: "POST",
      url: "/api/event-journal/events",
      payload: buildEventStorePayload(fixture, eventType)
    });

    assert.equal(response.statusCode, 201, response.body);
    assert.equal(response.json().event.eventType, eventType);
    assert.equal(response.json().event.schemaVersion, "event-store-v0.1");
    assert.equal(response.json().event.projectId, fixture.projectId);
    assert.equal(
      response.json().event.subjectId,
      eventType === "requirement_materialized" ? fixture.requirementId : fixture.taskId
    );

    const query =
      eventType === "requirement_materialized"
        ? `subject_type=requirement&subject_id=${fixture.requirementId}`
        : `task_id=${fixture.taskId}`;
    const queryResponse = await app.inject({
      method: "GET",
      url: `/api/event-journal/events?${query}&event_type=${eventType}`
    });
    assert.equal(queryResponse.statusCode, 200, queryResponse.body);
    assert.equal(queryResponse.json().items.length, 1);
    assert.equal(queryResponse.json().items[0].eventType, eventType);

    await app.close();
  });

  test(`emitEvent rejects invalid ${eventType} payload`, async () => {
    const app = buildApp({
      projectStore: new PrismaProjectStore(prisma)
    });

    await resetDatabase();
    const fixture = await createTaskFixture();
    const response = await app.inject({
      method: "POST",
      url: "/api/event-journal/events",
      payload: buildEventStorePayload(fixture, eventType, {
        payload: {}
      })
    });

    assert.equal(response.statusCode, 400, response.body);
    assert.equal(response.json().message, "event journal 参数不合法");

    await app.close();
  });
}

test("legacy D3 A1 codex_receipt_ready submit remains compatible", async () => {
  const app = buildApp({
    projectStore: new PrismaProjectStore(prisma)
  });

  await resetDatabase();
  const fixture = await createTaskFixture();
  const eventId = randomUUID();
  const response = await app.inject({
    method: "POST",
    url: "/api/event-journal/events",
    payload: {
      event_id: eventId,
      event_type: "codex_receipt_ready",
      task_id: fixture.taskId,
      payload: validPayloadFor("codex_receipt_ready"),
      emitted_at: "2026-04-28T00:00:00.000Z",
      source_actor: "codex",
      source_component: "primitive_executor"
    }
  });

  assert.equal(response.statusCode, 201, response.body);
  assert.equal(response.json().event.eventType, "codex_receipt_ready");
  assert.equal(response.json().event.schemaVersion, "event-store-v0.1");

  const queryResponse = await app.inject({
    method: "GET",
    url: `/api/event-journal/events?task_id=${fixture.taskId}&event_type=codex_receipt_ready`
  });
  assert.equal(queryResponse.statusCode, 200, queryResponse.body);
  assert.equal(queryResponse.json().items[0].eventId, eventId);
  assert.equal(queryResponse.json().items[0].schemaVersion, "event-store-v0.1");

  await app.close();
});

afterAll(async () => {
  await resetDatabase();
  await prisma.$disconnect();
});
