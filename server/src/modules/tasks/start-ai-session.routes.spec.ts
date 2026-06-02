import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { beforeEach, test, vi } from "vitest";

import { buildApp } from "../../app.js";
import { prisma } from "../../db/prisma.js";

async function resetFixtures(): Promise<void> {
  await prisma.anchorAllocation.deleteMany();
  await prisma.task.deleteMany();
  await prisma.project.deleteMany();
}

async function createTaskFixture(options: { status?: string; currentNode?: string | null } = {}) {
  const suffix = randomUUID();
  const project = await prisma.project.create({
    data: {
      name: `start-ai-session-${suffix}`,
      localPath: join(tmpdir(), `ccb-start-ai-session-${suffix}`)
    }
  });
  const task = await prisma.task.create({
    data: {
      projectId: project.id,
      taskKey: `task-${suffix}`,
      title: "Start AI session task",
      status: options.status ?? "reviewing",
      currentNode: Object.hasOwn(options, "currentNode") ? options.currentNode : "requirement_analysis",
      runtimeState: "running"
    }
  });
  return { project, task };
}

beforeEach(async () => {
  await resetFixtures();
});

test("GET /api/slots no longer exposes the old task SlotView without project scope", async () => {
  const app = buildApp({ enableFileWatcher: false });

  try {
    const response = await app.inject({
      method: "GET",
      url: "/api/slots"
    });

    assert.equal(response.statusCode, 400);
    assert.match(response.json().message, /projectId/);
  } finally {
    await app.close();
  }
});

test("POST /api/tasks/:taskId/start-ai-session keeps the old URL deprecated without SlotAllocator", async () => {
  const { task } = await createTaskFixture();
  const app = buildApp({
    enableFileWatcher: false,
    startAiSession: {
      anchorStarter: {
        startEpicAnchor: vi.fn(async () => {
          throw new Error("anchor starter should not be called for deprecated URL");
        })
      }
    }
  });

  try {
    const response = await app.inject({
      method: "POST",
      url: `/api/tasks/${task.id}/start-ai-session`,
      payload: {}
    });

    assert.equal(response.statusCode, 410);
    assert.match(response.json().message, /Task Anchor Runtime/);
  } finally {
    await app.close();
  }
});

test("POST /api/tasks/:taskId/start-ai-session keeps existing task state guards", async () => {
  const { task } = await createTaskFixture({ status: "done" });
  const app = buildApp({ enableFileWatcher: false });

  try {
    const response = await app.inject({
      method: "POST",
      url: `/api/tasks/${task.id}/start-ai-session`,
      payload: {}
    });

    assert.equal(response.statusCode, 400);
  } finally {
    await app.close();
  }
});
