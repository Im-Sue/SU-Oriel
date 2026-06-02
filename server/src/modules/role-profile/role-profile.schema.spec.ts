import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { promisify } from "node:util";

import { afterEach, test } from "vitest";

import { prisma } from "../../db/prisma.js";
import { resolveCcbProjectRoot } from "../../lib/project-root.js";

const execFileAsync = promisify(execFile);
const schemaPath = resolve(resolveCcbProjectRoot(), "docs/.ccb/schemas/role-profile-v0.1.json");
const createdProjectIds: string[] = [];

type ExecutorProfileClient = {
  create: (input: { data: Record<string, unknown> }) => Promise<Record<string, unknown>>;
};

type RoleProfileClient = {
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

function validRoleProfile(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    version: "role-profile-v0.1",
    name: "codex-implementer",
    executor_profile_id: "executor-profile-id",
    prompt_template_ref: "docs/.ccb/templates/prompts/codex-implementer.md",
    variable_overrides: {
      reasoning_effort: "medium",
      mode: "execute"
    },
    ...overrides
  };
}

async function createProject(): Promise<string> {
  const suffix = randomUUID();
  const project = await prisma.project.create({
    data: {
      name: `role-profile-${suffix}`,
      localPath: `/tmp/ccb-role-profile-${suffix}`
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

function roleProfileClient(): RoleProfileClient {
  const client = (prisma as unknown as { roleProfile?: RoleProfileClient }).roleProfile;
  assert.ok(client, "Prisma roleProfile model should exist");
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

test("role-profile schema accepts a reference-only valid profile", async () => {
  await validateProfile(validRoleProfile());
});

test("role-profile schema rejects invalid prompt_template_ref and variable_overrides", async () => {
  await assert.rejects(
    validateProfile(validRoleProfile({ prompt_template_ref: "templates/prompts/codex.md" })),
    /prompt_template_ref/
  );
  await assert.rejects(validateProfile(validRoleProfile({ variable_overrides: "execute" })), /variable_overrides/);
});

test("RoleProfile Prisma model supports CRUD linked to ExecutorProfile", async () => {
  const projectId = await createProject();
  const executor = await executorProfileClient().create({
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
      version: "executor-profile-v0.1"
    }
  });
  const client = roleProfileClient();

  const created = await client.create({
    data: {
      executorProfileId: executor.id,
      name: "codex-implementer",
      promptTemplateRef: "docs/.ccb/templates/prompts/codex-implementer.md",
      variableOverridesJson: JSON.stringify({
        reasoning_effort: "medium"
      }),
      version: "role-profile-v0.1"
    }
  });

  assert.equal(created.name, "codex-implementer");
  assert.equal(created.promptTemplateRef, "docs/.ccb/templates/prompts/codex-implementer.md");

  const loaded = await client.findUnique({
    where: {
      executorProfileId_name: {
        executorProfileId: String(executor.id),
        name: "codex-implementer"
      }
    }
  });
  assert.ok(loaded);
  assert.deepEqual(JSON.parse(String(loaded.variableOverridesJson)), {
    reasoning_effort: "medium"
  });

  const updated = await client.update({
    where: {
      id: String(created.id)
    },
    data: {
      promptTemplateRef: "docs/.ccb/templates/prompts/codex-reviewer.md"
    }
  });
  assert.equal(updated.promptTemplateRef, "docs/.ccb/templates/prompts/codex-reviewer.md");
});
