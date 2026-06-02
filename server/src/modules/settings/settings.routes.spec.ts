import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import { afterEach, test } from "vitest";

import { buildApp } from "../../app.js";
import { prisma } from "../../db/prisma.js";

const defaultSettings = {
  scan_strategy: {
    enabled: true,
    paths: ["docs"],
    exclude_patterns: ["node_modules", ".git"]
  },
  parsing_rules: {
    strict_frontmatter: true,
    allowed_categories: ["01", "02", "03", "04", "05"]
  },
  path_config: {
    docs_root: "docs",
    kernel_ref: "references/kernel"
  }
};

const customSettings = {
  scan_strategy: {
    enabled: false,
    paths: ["docs", "references"],
    exclude_patterns: ["node_modules", ".git", "dist"]
  },
  parsing_rules: {
    strict_frontmatter: false,
    allowed_categories: ["01", "04"]
  },
  path_config: {
    docs_root: "custom-docs",
    kernel_ref: "refs/kernel"
  }
};

const createdProjectIds: string[] = [];

async function createProject(): Promise<string> {
  const suffix = randomUUID();
  const project = await prisma.project.create({
    data: {
      name: `settings-${suffix}`,
      localPath: `/tmp/ccb-settings-${suffix}`
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

test("GET /api/projects/:projectId/settings returns project defaults when no row exists", async () => {
  const app = buildApp();
  const projectId = await createProject();

  const response = await app.inject({
    method: "GET",
    url: `/api/projects/${projectId}/settings`
  });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), {
    project_id: projectId,
    ...defaultSettings,
    updated_at: null
  });

  await app.close();
});

test("PUT /api/projects/:projectId/settings upserts the three settings fields", async () => {
  const app = buildApp();
  const projectId = await createProject();

  const putResponse = await app.inject({
    method: "PUT",
    url: `/api/projects/${projectId}/settings`,
    payload: customSettings
  });

  assert.equal(putResponse.statusCode, 200);
  const putBody = putResponse.json();
  assert.equal(putBody.project_id, projectId);
  assert.deepEqual(putBody.scan_strategy, customSettings.scan_strategy);
  assert.deepEqual(putBody.parsing_rules, customSettings.parsing_rules);
  assert.deepEqual(putBody.path_config, customSettings.path_config);
  assert.equal(typeof putBody.updated_at, "string");

  const getResponse = await app.inject({
    method: "GET",
    url: `/api/projects/${projectId}/settings`
  });

  assert.equal(getResponse.statusCode, 200);
  assert.deepEqual(getResponse.json(), putBody);

  await app.close();
});

test("PUT /api/projects/:projectId/settings toggles file watcher at runtime", async () => {
  const calls: string[] = [];
  const app = buildApp({
    enableFileWatcher: false,
    fileWatcherService: {
      start: async () => {
        calls.push("start");
      },
      stop: async () => {
        calls.push("stop");
      }
    }
  });
  const projectId = await createProject();

  const disableResponse = await app.inject({
    method: "PUT",
    url: `/api/projects/${projectId}/settings`,
    payload: customSettings
  });
  assert.equal(disableResponse.statusCode, 200);
  assert.deepEqual(calls, ["stop"]);

  const enableResponse = await app.inject({
    method: "PUT",
    url: `/api/projects/${projectId}/settings`,
    payload: defaultSettings
  });
  assert.equal(enableResponse.statusCode, 200);
  assert.deepEqual(calls, ["stop", "start"]);

  await app.close();
});

test("PUT /api/projects/:projectId/settings rejects invalid payloads", async () => {
  const app = buildApp();
  const projectId = await createProject();

  const response = await app.inject({
    method: "PUT",
    url: `/api/projects/${projectId}/settings`,
    payload: {
      ...customSettings,
      scan_strategy: {
        ...customSettings.scan_strategy,
        enabled: "yes"
      }
    }
  });

  assert.equal(response.statusCode, 400);
  const body = response.json();
  assert.equal(body.message, "settings 参数不合法");
  assert.ok(Array.isArray(body.issues));

  await app.close();
});
