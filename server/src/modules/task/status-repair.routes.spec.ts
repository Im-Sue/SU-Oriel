import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import { afterEach, test } from "vitest";

import { buildApp } from "../../app.js";
import { prisma } from "../../db/prisma.js";

const createdProjectIds: string[] = [];

async function createTask() {
  const suffix = randomUUID();
  const project = await prisma.project.create({
    data: {
      name: `status-repair-retired-${suffix}`,
      localPath: `/tmp/ccb-status-repair-retired-${suffix}`
    }
  });
  createdProjectIds.push(project.id);
  return await prisma.task.create({
    data: {
      projectId: project.id,
      taskKey: `status-repair-retired-${suffix}`,
      title: "Retired status repair task",
      status: "reviewing",
      currentNode: "implementation",
      runtimeState: "running",
      progress: 20
    }
  });
}

afterEach(async () => {
  for (const projectId of createdProjectIds.splice(0)) {
    await prisma.project.deleteMany({ where: { id: projectId } });
  }
});

test("POST /api/tasks/:taskId/status-repair is retired", async () => {
  const app = buildApp({ enableFileWatcher: false });
  const task = await createTask();
  try {
    const response = await app.inject({
      method: "POST",
      url: `/api/tasks/${task.id}/status-repair`,
      payload: { type: "set_progress", payload: { progress: 88 }, reason: "retired" }
    });

    assert.equal(response.statusCode, 404, response.body);
    assert.equal(await prisma.task.findUniqueOrThrow({ where: { id: task.id } }).then((row) => row.progress), 20);
  } finally {
    await app.close();
  }
});

test("POST /api/requirements/:requirementId/status-repair is retired", async () => {
  const app = buildApp({ enableFileWatcher: false });
  const suffix = randomUUID();
  const project = await prisma.project.create({
    data: {
      name: `status-repair-retired-req-${suffix}`,
      localPath: `/tmp/ccb-status-repair-retired-req-${suffix}`
    }
  });
  createdProjectIds.push(project.id);
  const requirement = await prisma.requirement.create({
    data: {
      id: `req-${suffix}`,
      projectId: project.id,
      title: "Retired requirement repair",
      description: "No direct status repair endpoint",
      status: "delivering"
    }
  });

  try {
    const response = await app.inject({
      method: "POST",
      url: `/api/requirements/${requirement.id}/status-repair`,
      payload: { type: "rollup_requirement", reason: "retired" }
    });

    assert.equal(response.statusCode, 404, response.body);
  } finally {
    await app.close();
  }
});
