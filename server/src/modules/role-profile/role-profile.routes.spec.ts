import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { afterEach, test } from "vitest";

import { buildApp } from "../../app.js";
import { prisma } from "../../db/prisma.js";
import { resolveCcbProjectRoot } from "../../lib/project-root.js";

const createdProjectIds: string[] = [];
const temporaryTemplatePaths: string[] = [];
const templateRoot = resolve(resolveCcbProjectRoot(), "docs/.ccb/templates/prompts");

const variableOverrides = {
  reasoning_effort: "medium",
  mode: "execute"
};

async function createProject(): Promise<string> {
  const suffix = randomUUID();
  const project = await prisma.project.create({
    data: {
      name: `role-profile-api-${suffix}`,
      localPath: `/tmp/ccb-role-profile-api-${suffix}`
    }
  });
  createdProjectIds.push(project.id);
  return project.id;
}

async function createExecutor(projectId: string, name = "default-codex"): Promise<{ id: string }> {
  return await prisma.executorProfile.create({
    data: {
      projectId,
      name,
      provider: "codex",
      model: "gpt-5.3-codex",
      runtime: "external",
      permission: "write",
      capabilityBindingJson: JSON.stringify({
        capability_id: "implementation.execute"
      }),
      version: "executor-profile-v0.1"
    },
    select: {
      id: true
    }
  });
}

function validPayload(executorProfileId: string, overrides: Record<string, unknown> = {}) {
  return {
    version: "role-profile-v0.1",
    name: "codex-implementer",
    executor_profile_id: executorProfileId,
    prompt_template_ref: "docs/.ccb/templates/prompts/executor-default.md",
    variable_overrides: variableOverrides,
    ...overrides
  };
}

async function writeTemporaryTemplate(filename: string, content: string): Promise<string> {
  const filePath = resolve(templateRoot, filename);
  await writeFile(filePath, content, "utf8");
  temporaryTemplatePaths.push(filePath);
  return `docs/.ccb/templates/prompts/${filename}`;
}

afterEach(async () => {
  for (const filePath of temporaryTemplatePaths.splice(0)) {
    await rm(filePath, { force: true });
  }
  for (const projectId of createdProjectIds.splice(0)) {
    await prisma.project.deleteMany({
      where: {
        id: projectId
      }
    });
  }
});

test("GET /api/projects/:projectId/role-profiles returns project role profiles", async () => {
  const app = buildApp();
  const projectId = await createProject();
  const executor = await createExecutor(projectId);

  await prisma.roleProfile.create({
    data: {
      executorProfileId: executor.id,
      name: "codex-implementer",
      promptTemplateRef: "docs/.ccb/templates/prompts/executor-default.md",
      variableOverridesJson: JSON.stringify(variableOverrides),
      version: "role-profile-v0.1"
    }
  });

  const response = await app.inject({
    method: "GET",
    url: `/api/projects/${projectId}/role-profiles`
  });

  assert.equal(response.statusCode, 200);
  const body = response.json();
  assert.equal(body.length, 1);
  assert.deepEqual(
    {
      project_id: body[0].project_id,
      role_id: body[0].role_id,
      version: body[0].version,
      name: body[0].name,
      executor_profile_id: body[0].executor_profile_id,
      prompt_template_ref: body[0].prompt_template_ref,
      variable_overrides: body[0].variable_overrides
    },
    {
      project_id: projectId,
      role_id: "codex-implementer",
      version: "role-profile-v0.1",
      name: "codex-implementer",
      executor_profile_id: executor.id,
      prompt_template_ref: "docs/.ccb/templates/prompts/executor-default.md",
      variable_overrides: variableOverrides
    }
  );
  assert.equal(typeof body[0].updated_at, "string");

  await app.close();
});

test("PUT /api/projects/:projectId/role-profiles/:roleId upserts and GET detail returns the role profile", async () => {
  const app = buildApp();
  const projectId = await createProject();
  const executor = await createExecutor(projectId);

  const putResponse = await app.inject({
    method: "PUT",
    url: `/api/projects/${projectId}/role-profiles/codex-implementer`,
    payload: validPayload(executor.id)
  });

  assert.equal(putResponse.statusCode, 200);
  const putBody = putResponse.json();
  assert.equal(putBody.project_id, projectId);
  assert.equal(putBody.role_id, "codex-implementer");
  assert.equal(putBody.executor_profile_id, executor.id);
  assert.deepEqual(putBody.variable_overrides, variableOverrides);

  const getResponse = await app.inject({
    method: "GET",
    url: `/api/projects/${projectId}/role-profiles/codex-implementer`
  });

  assert.equal(getResponse.statusCode, 200);
  assert.deepEqual(getResponse.json(), putBody);

  await app.close();
});

test("PUT /api/projects/:projectId/role-profiles/:roleId rejects schema validation errors", async () => {
  const app = buildApp();
  const projectId = await createProject();
  const executor = await createExecutor(projectId);

  const response = await app.inject({
    method: "PUT",
    url: `/api/projects/${projectId}/role-profiles/codex-implementer`,
    payload: validPayload(executor.id, {
      variable_overrides: "execute"
    })
  });

  assert.equal(response.statusCode, 400);
  assert.equal(response.json().message, "role profile schema validation failed");

  await app.close();
});

test("PUT /api/projects/:projectId/role-profiles/:roleId rejects missing template_ref files", async () => {
  const app = buildApp();
  const projectId = await createProject();
  const executor = await createExecutor(projectId);

  const response = await app.inject({
    method: "PUT",
    url: `/api/projects/${projectId}/role-profiles/codex-implementer`,
    payload: validPayload(executor.id, {
      prompt_template_ref: "docs/.ccb/templates/prompts/missing-template.md"
    })
  });

  assert.equal(response.statusCode, 400);
  assert.match(response.json().message, /template_ref.*not found/);

  await app.close();
});

test("PUT /api/projects/:projectId/role-profiles/:roleId rejects invalid template frontmatter", async () => {
  const app = buildApp();
  const projectId = await createProject();
  const executor = await createExecutor(projectId);
  const invalidTemplateRef = await writeTemporaryTemplate(
    "invalid-frontmatter-test.md",
    "This template has no frontmatter.\n"
  );

  const response = await app.inject({
    method: "PUT",
    url: `/api/projects/${projectId}/role-profiles/codex-implementer`,
    payload: validPayload(executor.id, {
      prompt_template_ref: invalidTemplateRef
    })
  });

  assert.equal(response.statusCode, 400);
  assert.match(response.json().message, /template_ref frontmatter invalid/);

  await app.close();
});

test("PUT /api/projects/:projectId/role-profiles/:roleId rejects missing executor_profile_id", async () => {
  const app = buildApp();
  const projectId = await createProject();

  const response = await app.inject({
    method: "PUT",
    url: `/api/projects/${projectId}/role-profiles/codex-implementer`,
    payload: validPayload("missing-executor-profile")
  });

  assert.equal(response.statusCode, 400);
  assert.match(response.json().message, /executor_profile_id.*not found/);

  await app.close();
});
