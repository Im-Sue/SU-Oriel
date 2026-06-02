import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { test } from "vitest";

import { buildApp } from "../../app.js";
import { prisma } from "../../db/prisma.js";
import { resolveCcbProjectRoot } from "../../lib/project-root.js";

type JsonSchema = {
  required?: string[];
  properties?: Record<string, JsonSchema>;
  items?: JsonSchema;
};

async function loadSchema(path: string): Promise<JsonSchema> {
  return JSON.parse(await readFile(resolve(process.cwd(), path), "utf-8")) as JsonSchema;
}

function assertRequiredFields(schema: JsonSchema, value: Record<string, unknown>): void {
  for (const field of schema.required ?? []) {
    assert.ok(field in value, `missing required field ${field}`);
  }
}

function assertNodeRunMatchesSchema(schema: JsonSchema, value: Record<string, unknown>): void {
  assertRequiredFields(schema, value);
  assert.equal(value.version, "noderun-v0.1");
  assert.ok(Array.isArray(value.transitions));
  assert.ok(Array.isArray(value.capability_decisions));

  const transitionSchema = schema.properties?.transitions?.items;
  const capabilityDecisionSchema = schema.properties?.capability_decisions?.items;
  assert.ok(transitionSchema);
  assert.ok(capabilityDecisionSchema);

  for (const transition of value.transitions as Record<string, unknown>[]) {
    assertRequiredFields(transitionSchema, transition);
  }
  for (const decision of value.capability_decisions as Record<string, unknown>[]) {
    assertRequiredFields(capabilityDecisionSchema, decision);
  }
}

async function clearNodeRuns(): Promise<void> {
  try {
    await prisma.$executeRawUnsafe('DELETE FROM "NodeRun"');
  } catch (error) {
    if (!(error instanceof Error) || !error.message.includes("no such table")) {
      throw error;
    }
  }
}

async function insertNodeRun(input: {
  id: string;
  taskId: string;
  nodeId: string;
  enteredAt: string;
  exitedAt: string | null;
  transitions: unknown[];
  capabilityDecisions: unknown[];
}): Promise<void> {
  await prisma.$executeRawUnsafe(
    `INSERT INTO "NodeRun"
      ("id", "taskId", "version", "nodeId", "enteredAt", "exitedAt", "transitionsJson", "capabilityDecisionsJson", "createdAt", "updatedAt")
      VALUES (?, ?, 'noderun-v0.1', ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
    input.id,
    input.taskId,
    input.nodeId,
    input.enteredAt,
    input.exitedAt,
    JSON.stringify(input.transitions),
    JSON.stringify(input.capabilityDecisions)
  );
}

test("GET /api/noderuns/:taskId returns NodeRun timeline sorted by entered_at", async () => {
  const schema = await loadSchema(resolve(resolveCcbProjectRoot(), "docs/.ccb/schemas/noderun-timeline-v0.1.json"));
  const app = buildApp();
  const taskId = "task-noderun-t8";
  await clearNodeRuns();

  await insertNodeRun({
    id: "run-late",
    taskId,
    nodeId: "technical_design",
    enteredAt: "2026-05-02T09:10:00.000Z",
    exitedAt: null,
    transitions: [
      {
        from_node: "requirement_analysis",
        to_node: "technical_design",
        transition_id: "requirement_analysis__on_done__to__technical_design",
        triggered_at: "2026-05-02T09:10:00.000Z"
      }
    ],
    capabilityDecisions: []
  });
  await insertNodeRun({
    id: "run-early",
    taskId,
    nodeId: "requirement_analysis",
    enteredAt: "2026-05-02T09:00:00.000Z",
    exitedAt: "2026-05-02T09:09:00.000Z",
    transitions: [
      {
        from_node: null,
        to_node: "requirement_analysis",
        transition_id: "__entry__to__requirement_analysis",
        triggered_at: "2026-05-02T09:00:00.000Z"
      }
    ],
    capabilityDecisions: [
      {
        capability_requested: "analysis.consult",
        resolved_binding: "codex_consult",
        decision_at: "2026-05-02T09:01:30.000Z"
      }
    ]
  });

  const response = await app.inject({
    method: "GET",
    url: `/api/noderuns/${taskId}`
  });

  assert.equal(response.statusCode, 200);
  const body = response.json() as Record<string, unknown>[];
  assert.equal(body.length, 2);
  assert.deepEqual(
    body.map((item) => item.node_id),
    ["requirement_analysis", "technical_design"]
  );
  assertNodeRunMatchesSchema(schema, body[0]);

  await app.close();
});

test("GET /api/noderuns/:taskId returns an empty timeline for an unknown task", async () => {
  const app = buildApp();
  await clearNodeRuns();

  const response = await app.inject({
    method: "GET",
    url: "/api/noderuns/task-without-runs"
  });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), []);

  await app.close();
});
