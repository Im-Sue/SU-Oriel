import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import { afterEach, test } from "vitest";

import { buildApp } from "../../app.js";
import { prisma } from "../../db/prisma.js";

const createdProjectIds: string[] = [];

function parseQueuedPayload(command: string): { command: string; payload: Record<string, unknown> } {
  const matched = command.match(/^\/ccb:([a-z][a-z0-9-]*) --payload (.+)$/);
  assert.ok(matched, `expected structured dispatch command, got: ${command}`);
  return {
    command: matched[1],
    payload: JSON.parse(matched[2]) as Record<string, unknown>
  };
}

async function createProject() {
  const suffix = randomUUID();
  const project = await prisma.project.create({
    data: {
      name: `derive-routes-${suffix}`,
      localPath: `/tmp/ccb-derive-routes-${suffix}`
    }
  });
  createdProjectIds.push(project.id);
  return project;
}

afterEach(async () => {
  await prisma.anchorDispatchQueue.deleteMany();
  for (const projectId of createdProjectIds.splice(0)) {
    await prisma.project.deleteMany({
      where: {
        id: projectId
      }
    });
  }
});

test("POST /api/tasks/:taskId/derive queues requirement task_breakdown followup dispatch", async () => {
  const app = buildApp({ enableFileWatcher: false });
  const project = await createProject();
  const requirement = await prisma.requirement.create({
    data: {
      projectId: project.id,
      title: "Source requirement",
      description: "source req",
      status: "delivering"
    }
  });
  const source = await prisma.task.create({
    data: {
      projectId: project.id,
      requirementId: requirement.id,
      taskKey: `derive-source-task-${randomUUID()}`,
      title: "Source task",
      status: "reviewing",
      currentNode: "implementation"
    }
  });
  const taskCountBefore = await prisma.task.count({ where: { projectId: project.id } });
  const requirementCountBefore = await prisma.requirement.count({ where: { projectId: project.id } });

  try {
    const response = await app.inject({
      method: "POST",
      url: `/api/tasks/${source.id}/derive`,
      payload: {
        type: "subtask",
        title: "Follow-up implementation",
        description: "Do the follow-up work."
      }
    });

    assert.equal(response.statusCode, 202);
    const body = response.json();
    assert.equal(body.kind, "dispatch");
    assert.equal(body.dispatch.requirementId, requirement.id);
    assert.equal(body.dispatch.sourceTaskId, source.id);
    assert.equal(body.dispatch.sourceTaskKey, source.taskKey);
    assert.equal(body.dispatch.followupType, "subtask");
    assert.equal(body.dispatch.command, "su-flow");
    assert.equal(body.dispatch.status, "queued");

    assert.equal(await prisma.task.count({ where: { projectId: project.id } }), taskCountBefore);
    assert.equal(await prisma.requirement.count({ where: { projectId: project.id } }), requirementCountBefore);

    const queued = await prisma.anchorDispatchQueue.findUniqueOrThrow({ where: { jobId: body.dispatch.jobId } });
    assert.equal(queued.subjectType, "requirement");
    assert.equal(queued.subjectId, requirement.id);
    assert.equal(queued.status, "pending");
    const structured = parseQueuedPayload(queued.command);
    assert.equal(structured.command, "su-flow");
    const payload = structured.payload;
    assert.equal(payload.language, "中文");
    assert.equal(payload.subject, "requirement");
    assert.equal(payload.requirement_id, requirement.id);
    assert.equal(payload.step, "breakdown_draft");
    assert.equal(payload.action, "derive_followup");
    assert.equal(payload.source_task_id, source.id);
    assert.equal(payload.source_task_key, source.taskKey);
    assert.deepEqual(payload.followup, {
      type: "subtask",
      title: "Follow-up implementation",
      description: "Do the follow-up work."
    });
  } finally {
    await app.close();
  }
});

test("POST /api/tasks/:taskId/derive returns 409 when source has no requirementId", async () => {
  const app = buildApp({ enableFileWatcher: false });
  const project = await createProject();
  const source = await prisma.task.create({
    data: {
      projectId: project.id,
      taskKey: `derive-no-req-${randomUUID()}`,
      title: "No requirement source",
      status: "reviewing",
      currentNode: "implementation"
    }
  });

  try {
    const response = await app.inject({
      method: "POST",
      url: `/api/tasks/${source.id}/derive`,
      payload: {
        type: "subtask",
        title: "Cannot attach"
      }
    });

    assert.equal(response.statusCode, 409);
    assert.match(response.json().message, /requirementId/);
    assert.equal(
      await prisma.anchorDispatchQueue.count({
        where: { subjectType: "requirement", subjectId: source.id }
      }),
      0
    );
  } finally {
    await app.close();
  }
});

test("POST /api/tasks/:taskId/derive queues requirement followup and stubs decision type with 400", async () => {
  const app = buildApp({ enableFileWatcher: false });
  const project = await createProject();
  const requirement = await prisma.requirement.create({
    data: {
      projectId: project.id,
      title: "Source requirement",
      description: "source req",
      status: "delivering"
    }
  });
  const source = await prisma.task.create({
    data: {
      projectId: project.id,
      requirementId: requirement.id,
      taskKey: `derive-source-task-${randomUUID()}`,
      title: "Source task",
      status: "reviewing",
      currentNode: "review"
    }
  });

  try {
    const requirementResponse = await app.inject({
      method: "POST",
      url: `/api/tasks/${source.id}/derive`,
      payload: {
        type: "requirement",
        title: "Derived requirement",
        description: "A new derived requirement."
      }
    });

    assert.equal(requirementResponse.statusCode, 202);
    const requirementBody = requirementResponse.json();
    assert.equal(requirementBody.kind, "dispatch");
    assert.equal(requirementBody.dispatch.requirementId, requirement.id);
    assert.equal(requirementBody.dispatch.followupType, "requirement");
    const queued = await prisma.anchorDispatchQueue.findUniqueOrThrow({
      where: { jobId: requirementBody.dispatch.jobId }
    });
    const payload = parseQueuedPayload(queued.command).payload;
    assert.equal(payload.language, "中文");
    assert.equal(payload.source_task_id, source.id);
    assert.deepEqual(payload.followup, {
      type: "requirement",
      title: "Derived requirement",
      description: "A new derived requirement."
    });

    const decisionResponse = await app.inject({
      method: "POST",
      url: `/api/tasks/${source.id}/derive`,
      payload: {
        type: "decision",
        title: "Decision note"
      }
    });
    assert.equal(decisionResponse.statusCode, 400);
    assert.match(decisionResponse.json().message, /not implemented/i);
  } finally {
    await app.close();
  }
});
