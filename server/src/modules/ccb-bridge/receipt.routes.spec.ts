import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, test } from "vitest";

import { buildApp } from "../../app.js";
import { prisma } from "../../db/prisma.js";
import { ingestCodexReceipt } from "./receipt.service.js";

const createdProjectIds: string[] = [];

async function createImplementationTask() {
  const suffix = randomUUID();
  const project = await prisma.project.create({
    data: {
      name: `receipt-bridge-${suffix}`,
      localPath: join(tmpdir(), `ccb-receipt-bridge-${suffix}`)
    }
  });
  createdProjectIds.push(project.id);

  const task = await prisma.task.create({
    data: {
      projectId: project.id,
      taskKey: `task-${suffix}`,
      title: "Receipt bridge task",
      status: "reviewing",
      currentNode: "implementation",
      nodeSubstate: "executing",
      runtimeState: "running",
      progress: 60
    }
  });

  return {
    project,
    task
  };
}

function receiptPayload(taskId: string, overrides: Record<string, unknown> = {}) {
  return {
    job_id: `job-${randomUUID()}`,
    reply_id: `reply-${randomUUID()}`,
    task_id: taskId,
    spec_id: "2026-05-16-test-spec",
    status: "completed",
    completed_at: "2026-05-16T06:30:00.000Z",
    receipt_summary: "实现完成，等待 review",
    reply_text: "[CCB_TASK_COMPLETED] test receipt",
    ...overrides
  };
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

test("POST /api/ccb-bridge/receipt writes codex_receipt_ready EventJournal event", async () => {
  const app = buildApp({ enableFileWatcher: false });
  const { task } = await createImplementationTask();
  const payload = receiptPayload(task.id);

  try {
    const response = await app.inject({
      method: "POST",
      url: "/api/ccb-bridge/receipt",
      payload
    });

    assert.equal(response.statusCode, 201, response.body);
    assert.equal(response.json().result, "created");
    assert.equal(response.json().event.eventType, "codex_receipt_ready");
    assert.equal(response.json().event.sourceComponent, "codex-receipt-bridge");
    assert.equal(response.json().event.idempotencyKey, payload.reply_id);
    assert.equal(response.json().event.payload.job_id, payload.job_id);
    assert.equal(response.json().event.payload.reply_id, payload.reply_id);
    assert.equal(response.json().event.payload.spec_id, payload.spec_id);

    const count = await prisma.eventJournal.count({
      where: {
        subjectType: "subtask",
        subjectId: task.id,
        eventType: "codex_receipt_ready"
      }
    });
    assert.equal(count, 1);
  } finally {
    await app.close();
  }
});

test("POST /api/ccb-bridge/receipt dedupes repeated reply_id", async () => {
  const app = buildApp({ enableFileWatcher: false });
  const { task } = await createImplementationTask();
  const payload = receiptPayload(task.id, { reply_id: `reply-${randomUUID()}` });

  try {
    const first = await app.inject({
      method: "POST",
      url: "/api/ccb-bridge/receipt",
      payload
    });
    const second = await app.inject({
      method: "POST",
      url: "/api/ccb-bridge/receipt",
      payload: {
        ...payload,
        receipt_summary: "重复回执不应覆盖历史"
      }
    });

    assert.equal(first.statusCode, 201, first.body);
    assert.equal(second.statusCode, 200, second.body);
    assert.equal(second.json().result, "already_recorded");
    assert.equal(second.json().idempotent, true);
    assert.equal(second.json().event.eventId, first.json().event.eventId);

    const count = await prisma.eventJournal.count({
      where: {
        idempotencyKey: payload.reply_id
      }
    });
    assert.equal(count, 1);
  } finally {
    await app.close();
  }
});

test("receipt bridge event satisfies implementation receipt guard", async () => {
  const app = buildApp({ enableFileWatcher: false });
  const { task } = await createImplementationTask();

  try {
    const before = await app.inject({
      method: "GET",
      url: `/api/tasks/${task.id}/node-flow`
    });
    assert.equal(before.statusCode, 200, before.body);
    const beforeAction = before
      .json()
      .applicable_actions.find(
        (action: { transition_id: string }) =>
          action.transition_id === "implementation__on_receipt_ready__to__review"
      );
    assert.equal(beforeAction.guard_status, "blocked");

    const bridge = await app.inject({
      method: "POST",
      url: "/api/ccb-bridge/receipt",
      payload: receiptPayload(task.id)
    });
    assert.equal(bridge.statusCode, 201, bridge.body);

    const after = await app.inject({
      method: "GET",
      url: `/api/tasks/${task.id}/node-flow`
    });
    assert.equal(after.statusCode, 200, after.body);
    const afterAction = after
      .json()
      .applicable_actions.find(
        (action: { transition_id: string }) =>
          action.transition_id === "implementation__on_receipt_ready__to__review"
      );
    assert.equal(afterAction.guard_status, "satisfied");
    assert.equal(afterAction.guard_reason, "codex_receipt_ready event available");
  } finally {
    await app.close();
  }
});

test("ingestCodexReceipt retries failures and dead-letters after exhaustion", async () => {
  const failures: unknown[] = [];
  const deadLetters: unknown[] = [];

  const result = await ingestCodexReceipt(
    {
      job_id: "job-retry-test",
      reply_id: "reply-retry-test",
      task_id: "task-retry-test",
      status: "completed",
      provider: "codex",
      completed_at: "2026-05-16T06:30:00.000Z",
      receipt_summary: "retry test",
      unsolicited_findings: []
    },
    {
      retryDelaysMs: [0, 0],
      emitEvent: async () => {
        failures.push(new Error("db unavailable"));
        throw new Error("db unavailable");
      },
      findExistingEventByReplyId: async () => null,
      writeDeadLetter: async (record) => {
        deadLetters.push(record);
        return "dead-letter-test-id";
      }
    }
  );

  assert.equal(result.result, "dead_lettered");
  assert.equal(result.attempts, 3);
  assert.equal(failures.length, 3);
  assert.equal(deadLetters.length, 1);
  assert.equal((deadLetters[0] as { input: { reply_id: string } }).input.reply_id, "reply-retry-test");
});
