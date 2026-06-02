import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { beforeEach, test } from "vitest";

import { buildApp } from "../../app.js";
import { prisma } from "../../db/prisma.js";

async function resetDatabase(): Promise<void> { await prisma.eventJournal.deleteMany();
  await prisma.reviewIntent.deleteMany();
  await prisma.taskRun.deleteMany();
  await prisma.taskWorkspace.deleteMany();
  await prisma.syncJob.deleteMany();
  await prisma.requirement.deleteMany();
  await prisma.task.deleteMany();
  await prisma.document.deleteMany();
  await prisma.project.deleteMany();
}

async function createTaskFixture() {
  const suffix = randomUUID();
  const project = await prisma.project.create({
    data: {
      name: `activity-${suffix}`,
      localPath: join(tmpdir(), `ccb-activity-${suffix}`)
    }
  });
  const task = await prisma.task.create({
    data: {
      projectId: project.id,
      taskKey: `task-${suffix}`,
      title: "Activity task",
      status: "reviewing",
      currentNode: "implementation",
      nodeSubstate: "executing",
      runtimeState: "running",
      priority: "medium",
      progress: 40
    }
  });

  return {
    projectId: project.id,
    taskId: task.id,
    taskKey: task.taskKey
  };
}

async function insertActivityEvents(count: number) {
  const fixture = await createTaskFixture();
  for (let index = 0; index < count; index += 1) {
    await prisma.eventJournal.create({
      data: {
        eventId: randomUUID(),
        eventType: index % 2 === 0 ? "codex_receipt_ready" : "verification_finished",
        projectId: fixture.projectId,
        subjectType: "subtask",
        subjectId: fixture.taskId,
        subjectKey: fixture.taskKey,
        payloadJson:
          index % 2 === 0
            ? JSON.stringify({
                receipt_ref: `docs/.ccb/receipts/${index}.md`,
                provider: "codex",
                receipt_summary: `receipt ${index}`,
                unsolicited_findings: []
              })
            : JSON.stringify({
                result: "pass",
                build: { status: "pass" },
                test: { status: "pass" },
                artifact_refs: []
              }),
        emittedAt: new Date(`2026-05-04T10:${String(index).padStart(2, "0")}:00.000Z`),
        sourceActor: index % 2 === 0 ? "codex" : "system",
        sourceComponent: "console"
      }
    });
  }

  return fixture;
}

beforeEach(async () => {
  await resetDatabase();
});

test("GET /api/activity/recent returns empty events when EventJournal is empty", async () => {
  const app = buildApp({ enableFileWatcher: false });

  try {
    const response = await app.inject({
      method: "GET",
      url: "/api/activity/recent"
    });

    assert.equal(response.statusCode, 200, response.body);
    assert.deepEqual(response.json(), {
      events: []
    });
  } finally {
    await app.close();
  }
});

test("GET /api/activity/recent returns the latest ten cross-project EventJournal events by default", async () => {
  const app = buildApp({ enableFileWatcher: false });
  const fixture = await insertActivityEvents(12);

  try {
    const response = await app.inject({
      method: "GET",
      url: "/api/activity/recent"
    });

    assert.equal(response.statusCode, 200, response.body);
    const body = response.json();
    assert.equal(body.events.length, 10);
    assert.equal(body.events[0].at, "2026-05-04T10:11:00.000Z");
    assert.equal(body.events[9].at, "2026-05-04T10:02:00.000Z");
    assert.equal(body.events[0].task_id, fixture.taskId);
    assert.equal(body.events[0].project_id, fixture.projectId);
    assert.match(body.events[0].summary, /verification_finished|receipt ready/);
    assert.equal(typeof body.events[0].payload, "object");
  } finally {
    await app.close();
  }
});
