import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { test } from "vitest";

import { buildApp } from "../../../app.js";
import { prisma } from "../../../db/prisma.js";
import { resolveCcbProjectRoot } from "../../../lib/project-root.js";

type JsonSchema = {
  required?: string[];
  properties?: Record<string, JsonSchema & { enum?: string[] }>;
  items?: JsonSchema;
};

async function loadSchema(path: string): Promise<JsonSchema> {
  return JSON.parse(await readFile(resolve(process.cwd(), path), "utf-8")) as JsonSchema;
}

function assertCapabilityMatrixMatchesSchema(schema: JsonSchema, value: Record<string, unknown>): void {
  for (const field of schema.required ?? []) {
    assert.ok(field in value, `missing required field ${field}`);
  }
  assert.equal(value.version, "cap-matrix-v0.1");
  assert.ok(Array.isArray(value.capabilities));

  const itemSchema = schema.properties?.capabilities?.items;
  assert.ok(itemSchema);
  const bindingSources = itemSchema.properties?.binding_source?.enum ?? [];
  const statuses = itemSchema.properties?.status?.enum ?? [];
  for (const capability of value.capabilities as Record<string, unknown>[]) {
    for (const field of itemSchema.required ?? []) {
      assert.ok(field in capability, `missing capability field ${field}`);
    }
    assert.ok(bindingSources.includes(String(capability.binding_source)));
    assert.ok(statuses.includes(String(capability.status)));
  }
}

async function clearCapabilityStatuses(): Promise<void> {
  try {
    await prisma.$executeRawUnsafe('DELETE FROM "CapabilityStatus"');
  } catch (error) {
    if (!(error instanceof Error) || !error.message.includes("no such table")) {
      throw error;
    }
  }
}

async function insertCapabilityStatus(input: {
  id: string;
  name: string;
  bindingSource: string;
  status: string;
  lastUsedAt: string | null;
}): Promise<void> {
  await prisma.$executeRawUnsafe(
    `INSERT INTO "CapabilityStatus"
      ("id", "version", "name", "bindingSource", "status", "lastUsedAt", "createdAt", "updatedAt")
      VALUES (?, 'cap-matrix-v0.1', ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
    input.id,
    input.name,
    input.bindingSource,
    input.status,
    input.lastUsedAt
  );
}

test("GET /api/capabilities/status returns the capability status matrix", async () => {
  const schema = await loadSchema(resolve(resolveCcbProjectRoot(), "docs/.ccb/schemas/capability-status-matrix-v0.1.json"));
  const app = buildApp();
  await clearCapabilityStatuses();
  await insertCapabilityStatus({
    id: "cap-active",
    name: "analysis.consult",
    bindingSource: "project",
    status: "active",
    lastUsedAt: "2026-05-02T10:15:00.000Z"
  });
  await insertCapabilityStatus({
    id: "cap-deprecated",
    name: "analysis.depth_hint",
    bindingSource: "global",
    status: "deprecated",
    lastUsedAt: null
  });

  const response = await app.inject({
    method: "GET",
    url: "/api/capabilities/status"
  });

  assert.equal(response.statusCode, 200);
  const body = response.json() as Record<string, unknown>;
  assertCapabilityMatrixMatchesSchema(schema, body);
  assert.deepEqual(body, {
    version: "cap-matrix-v0.1",
    capabilities: [
      {
        name: "analysis.consult",
        binding_source: "project",
        status: "active",
        last_used_at: "2026-05-02T10:15:00.000Z"
      },
      {
        name: "analysis.depth_hint",
        binding_source: "global",
        status: "deprecated",
        last_used_at: null
      }
    ]
  });

  await app.close();
});
