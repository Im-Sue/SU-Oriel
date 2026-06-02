import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import { afterEach, test } from "vitest";

import { buildApp } from "../../app.js";
import { prisma } from "../../db/prisma.js";

const createdProjectIds: string[] = [];

const validPayload = {
  version: "executor-profile-v0.1",
  provider: "codex",
  model: "gpt-5.3-codex",
  runtime: "external",
  permission: "write",
  capability_binding: {
    capability_id: "implementation.execute"
  },
  last_updated: "2026-05-03T00:00:00.000Z",
  meta: {
    prompt_template_ref: "docs/.ccb/templates/prompts/executor-default.md"
  }
};

async function createProject(): Promise<string> {
  const suffix = randomUUID();
  const project = await prisma.project.create({
    data: {
      name: `executor-profile-api-${suffix}`,
      localPath: `/tmp/ccb-executor-profile-api-${suffix}`
    }
  });
  createdProjectIds.push(project.id);
  return project.id;
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

test("GET /api/projects/:projectId/executor-profiles returns project profiles", async () => {
  const app = buildApp();
  const projectId = await createProject();

  await prisma.executorProfile.create({
    data: {
      projectId,
      name: "default-codex",
      provider: validPayload.provider,
      model: validPayload.model,
      runtime: validPayload.runtime,
      permission: validPayload.permission,
      capabilityBindingJson: JSON.stringify(validPayload.capability_binding),
      version: validPayload.version,
      metaJson: JSON.stringify(validPayload.meta)
    }
  });

  const response = await app.inject({
    method: "GET",
    url: `/api/projects/${projectId}/executor-profiles`
  });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), [
    {
      project_id: projectId,
      profile_id: "default-codex",
      ...validPayload,
      last_updated: response.json()[0].last_updated
    }
  ]);
  assert.equal(typeof response.json()[0].last_updated, "string");

  await app.close();
});

test("PUT /api/projects/:projectId/executor-profiles/:profileId upserts a profile and GET detail returns it", async () => {
  const app = buildApp();
  const projectId = await createProject();

  const putResponse = await app.inject({
    method: "PUT",
    url: `/api/projects/${projectId}/executor-profiles/default-codex`,
    payload: validPayload
  });

  assert.equal(putResponse.statusCode, 200);
  assert.deepEqual(putResponse.json(), {
    project_id: projectId,
    profile_id: "default-codex",
    ...validPayload,
    last_updated: putResponse.json().last_updated
  });

  const getResponse = await app.inject({
    method: "GET",
    url: `/api/projects/${projectId}/executor-profiles/default-codex`
  });

  assert.equal(getResponse.statusCode, 200);
  assert.deepEqual(getResponse.json(), putResponse.json());

  await app.close();
});

test("PUT /api/projects/:projectId/executor-profiles/:profileId rejects schema validation errors", async () => {
  const app = buildApp();
  const projectId = await createProject();

  const response = await app.inject({
    method: "PUT",
    url: `/api/projects/${projectId}/executor-profiles/default-codex`,
    payload: {
      ...validPayload,
      permission: "owner"
    }
  });

  assert.equal(response.statusCode, 400);
  const body = response.json() as Record<string, unknown>;
  assert.equal(body.message, "executor profile schema validation failed");
  assert.ok(Array.isArray(body.issues));

  const count = await prisma.executorProfile.count({
    where: {
      projectId
    }
  });
  assert.equal(count, 0);

  await app.close();
});
