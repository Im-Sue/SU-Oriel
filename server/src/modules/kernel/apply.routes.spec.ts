import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, test, vi } from "vitest";

import { buildApp } from "../../app.js";
import { prisma } from "../../db/prisma.js";
import { primitiveExecutor } from "../primitive/primitive-wrapper.js";

async function resetDatabase(): Promise<void> { await prisma.eventJournal.deleteMany();
  await prisma.reviewIntent.deleteMany();
  await prisma.taskWorkspace.deleteMany();
  await prisma.syncJob.deleteMany();
  await prisma.requirement.deleteMany();
  await prisma.task.deleteMany();
  await prisma.document.deleteMany();
  await prisma.project.deleteMany();
}

async function createTaskFixture(): Promise<{ projectId: string; taskId: string; taskKey: string }> {
  const project = await prisma.project.create({
    data: {
      name: `Kernel Apply Project ${randomUUID()}`,
      localPath: join(tmpdir(), `ccb-kernel-apply-${randomUUID()}`),
      updatedAt: new Date()
    }
  });
  const task = await prisma.task.create({
    data: {
      projectId: project.id,
      taskKey: `task-${randomUUID()}`,
      title: "Kernel apply task",
      status: "reviewing",
      currentNode: "review",
      nodeSubstate: "auto_reviewing",
      runtimeState: "running",
      lastTransitionId: "implementation__on_receipt_ready__to__review",
      updatedAt: new Date()
    }
  });

  return {
    projectId: project.id,
    taskId: task.id,
    taskKey: task.taskKey
  };
}

test("K1 apply endpoint creates review intent through public primitive and emits verification event", async () => {
  const app = buildApp({ enableFileWatcher: false });
  await resetDatabase();
  const fixture = await createTaskFixture();
  const runSpy = vi.spyOn(primitiveExecutor, "run");

  try {
    const response = await app.inject({
      method: "POST",
      url: "/api/kernel/apply/create_review_intent",
      payload: {
        taskId: fixture.taskId,
        intentType: "request_replan",
        payload: "K1 apply endpoint follow-up"
      }
    });

    assert.equal(response.statusCode, 200, response.body);
    assert.equal(response.json().success, true);
    assert.equal(response.json().primitive, "create_review_intent");
    assert.equal(response.json().result.status, "pending");
    assert.equal(response.json().result.taskId, fixture.taskId);
    assert.ok(runSpy.mock.calls.some(([input]) => input.primitive === "create_review_intent"));

    const emitted = await prisma.eventJournal.findFirst({
      where: {
        subjectType: "subtask",
        subjectId: fixture.taskId,
        eventType: "verification_finished"
      }
    });
    assert.ok(emitted);
    assert.equal(emitted.sourceActor, "system");
    assert.equal(emitted.sourceComponent, "console");
    assert.equal(emitted.idempotencyKey, `${response.json().applyId}:verification_finished`);
  } finally {
    runSpy.mockRestore();
    await app.close();
  }
});

test("K1 apply endpoint rejects invalid primitive payload", async () => {
  const app = buildApp({ enableFileWatcher: false });
  await resetDatabase();

  try {
    const response = await app.inject({
      method: "POST",
      url: "/api/kernel/apply/create_review_intent",
      payload: {
        taskId: "",
        intentType: "request_replan"
      }
    });

    assert.equal(response.statusCode, 400, response.body);
    assert.equal(response.json().message, "kernel apply payload 不合法");
  } finally {
    await app.close();
  }
});

test("K1 apply endpoint rejects primitives outside the public whitelist", async () => {
  const app = buildApp({ enableFileWatcher: false });
  await resetDatabase();

  try {
    const response = await app.inject({
      method: "POST",
      url: "/api/kernel/apply/record_transition_dry_run",
      payload: {}
    });

    assert.equal(response.statusCode, 404, response.body);
    assert.equal(response.json().message, "primitive 不在公开白名单");
  } finally {
    await app.close();
  }
});

afterAll(async () => {
  await resetDatabase();
  await prisma.$disconnect();
});
