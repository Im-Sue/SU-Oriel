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

async function createTaskFixture(overrides: { currentNode?: string; nodeSubstate?: string } = {}) {
  const suffix = randomUUID();
  const project = await prisma.project.create({
    data: {
      name: `consultation-${suffix}`,
      localPath: join(tmpdir(), `ccb-consultation-${suffix}`)
    }
  });
  const task = await prisma.task.create({
    data: {
      projectId: project.id,
      taskKey: `task-${suffix}`,
      title: "Consultation task",
      status: "reviewing",
      currentNode: overrides.currentNode ?? "technical_design",
      nodeSubstate: overrides.nodeSubstate ?? "consult",
      runtimeState: "running",
      priority: "medium",
      progress: 30
    }
  });

  return {
    projectId: project.id,
    taskId: task.id,
    taskKey: task.taskKey
  };
}

async function insertReviewIntentRound(input: {
  projectId: string;
  taskId: string;
  taskKey: string;
  roundNumber: number;
  nodeId: string;
  intentScore: number;
  tokensIn: number;
  tokensOut: number;
}) {
  return await prisma.reviewIntent.create({
    data: {
      projectId: input.projectId,
      taskId: input.taskId,
      taskKey: input.taskKey,
      intentType: "request_replan",
      payloadJson: JSON.stringify({
        round_number: input.roundNumber,
        node_id: input.nodeId,
        intent_score: input.intentScore,
        tokens_in: input.tokensIn,
        tokens_out: input.tokensOut,
        intent: `plan_review_round_${input.roundNumber}`
      }),
      status: "consumed",
      createdAt: new Date(`2026-05-04T10:0${input.roundNumber}:00.000Z`)
    }
  });
}

async function insertCodexEvent(input: {
  projectId: string;
  taskId: string;
  taskKey: string;
  roundNumber: number;
  intentId: string;
}) {
  await prisma.eventJournal.create({
    data: {
      eventId: randomUUID(),
      eventType: "codex_receipt_ready",
      projectId: input.projectId,
      subjectType: "subtask",
      subjectId: input.taskId,
      subjectKey: input.taskKey,
      payloadJson: JSON.stringify({
        receipt_ref: `docs/.ccb/receipts/round-${input.roundNumber}.md`,
        provider: "codex",
        receipt_summary: `round ${input.roundNumber} completed `.repeat(80),
        unsolicited_findings: []
      }),
      emittedAt: new Date(`2026-05-04T10:1${input.roundNumber}:00.000Z`),
      sourceActor: "codex",
      sourceComponent: "primitive_executor",
      correlationId: input.intentId
    }
  });
}

beforeEach(async () => {
  await resetDatabase();
});

test("GET /api/tasks/:taskId/consultation returns empty rounds for tasks without codex events", async () => {
  const app = buildApp({ enableFileWatcher: false });
  const fixture = await createTaskFixture();

  try {
    const response = await app.inject({
      method: "GET",
      url: `/api/tasks/${fixture.taskId}/consultation`
    });

    assert.equal(response.statusCode, 200, response.body);
    assert.deepEqual(response.json(), {
      rounds: []
    });
  } finally {
    await app.close();
  }
});

test("GET /api/tasks/:taskId/consultation groups three codex rounds with ReviewIntent metadata", async () => {
  const app = buildApp({ enableFileWatcher: false });
  const fixture = await createTaskFixture();

  for (const roundNumber of [1, 2, 3]) {
    const intent = await insertReviewIntentRound({
      ...fixture,
      roundNumber,
      nodeId: roundNumber === 3 ? "review" : "technical_design",
      intentScore: 8 + roundNumber / 10,
      tokensIn: 2000 + roundNumber,
      tokensOut: 400 + roundNumber
    });
    await insertCodexEvent({
      ...fixture,
      roundNumber,
      intentId: intent.id
    });
  }

  try {
    const response = await app.inject({
      method: "GET",
      url: `/api/tasks/${fixture.taskId}/consultation`
    });

    assert.equal(response.statusCode, 200, response.body);
    const body = response.json();
    assert.deepEqual(
      body.rounds.map((round: { round_number: number }) => round.round_number),
      [3, 2, 1]
    );
    assert.equal(body.rounds[0].node_id, "review");
    assert.equal(body.rounds[0].events.length, 2);
    assert.deepEqual(
      body.rounds[0].events.map((event: { sender: string; receiver: string }) => `${event.sender}->${event.receiver}`),
      ["claude->codex", "codex->claude"]
    );
    assert.equal(body.rounds[0].events[0].intent_score, 8.3);
    assert.equal(body.rounds[0].events[0].tokens_in, 2003);
    assert.equal(body.rounds[0].events[0].tokens_out, 403);
    assert.ok(body.rounds[0].events[1].payload_preview.length <= 500);
  } finally {
    await app.close();
  }
});
