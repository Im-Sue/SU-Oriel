import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { promisify } from "node:util";

import { afterEach, test } from "vitest";

import { prisma } from "../../db/prisma.js";
import { resolveCcbProjectRoot } from "../../lib/project-root.js";

const execFileAsync = promisify(execFile);
const schemaPath = resolve(resolveCcbProjectRoot(), "docs/.ccb/schemas/executor-profile-v0.1.json");
const createdProjectIds: string[] = [];

type ExecutorProfileClient = {
  create: (input: { data: Record<string, unknown> }) => Promise<Record<string, unknown>>;
  findUnique: (input: { where: Record<string, unknown> }) => Promise<Record<string, unknown> | null>;
  update: (input: { where: Record<string, unknown>; data: Record<string, unknown> }) => Promise<Record<string, unknown>>;
};

async function validateProfile(profile: Record<string, unknown>): Promise<void> {
  await execFileAsync("python3", [
    "-c",
    [
      "import json,jsonschema,sys",
      "schema=json.load(open(sys.argv[1]))",
      "profile=json.loads(sys.argv[2])",
      "jsonschema.Draft202012Validator(schema).validate(profile)"
    ].join(";"),
    schemaPath,
    JSON.stringify(profile)
  ]);
}

function validProfile(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    version: "executor-profile-v0.1",
    provider: "codex",
    model: "gpt-5.3-codex",
    runtime: "external",
    permission: "write",
    capability_binding: {
      capability_id: "implementation.execute"
    },
    last_updated: "2026-05-03T00:00:00.000Z",
    ...overrides
  };
}

async function createProject(): Promise<string> {
  const suffix = randomUUID();
  const project = await prisma.project.create({
    data: {
      name: `executor-profile-${suffix}`,
      localPath: `/tmp/ccb-executor-profile-${suffix}`
    }
  });
  createdProjectIds.push(project.id);
  return project.id;
}

function executorProfileClient(): ExecutorProfileClient {
  const client = (prisma as unknown as { executorProfile?: ExecutorProfileClient }).executorProfile;
  assert.ok(client, "Prisma executorProfile model should exist");
  return client;
}

afterEach(async () => {
  for (const projectId of createdProjectIds.splice(0)) {
    await prisma.project.deleteMany({
      where: {
        id: projectId
      }
    });
  }
});

test("executor-profile schema accepts a reference-only valid profile", async () => {
  await validateProfile(validProfile());
});

test("executor-profile schema rejects invalid permission values", async () => {
  await assert.rejects(validateProfile(validProfile({ permission: "owner" })), /owner/);
});

test("ExecutorProfile Prisma model supports project-scoped CRUD", async () => {
  const projectId = await createProject();
  const client = executorProfileClient();

  const created = await client.create({
    data: {
      projectId,
      name: "default-codex",
      provider: "codex",
      model: "gpt-5.3-codex",
      runtime: "external",
      permission: "write",
      capabilityBindingJson: JSON.stringify({
        capability_id: "implementation.execute"
      }),
      version: "executor-profile-v0.1",
      metaJson: JSON.stringify({
        prompt_template_ref: "docs/.ccb/templates/prompts/codex-default.md"
      })
    }
  });

  assert.equal(created.provider, "codex");
  assert.equal(created.permission, "write");

  const loaded = await client.findUnique({
    where: {
      projectId_name: {
        projectId,
        name: "default-codex"
      }
    }
  });
  assert.ok(loaded);
  assert.deepEqual(JSON.parse(String(loaded.capabilityBindingJson)), {
    capability_id: "implementation.execute"
  });

  const updated = await client.update({
    where: {
      id: String(created.id)
    },
    data: {
      permission: "admin"
    }
  });
  assert.equal(updated.permission, "admin");
});
