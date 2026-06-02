import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ConsultRequestStatus } from "@prisma/client";
import { afterAll, test } from "vitest";

import { buildApp } from "../app.js";
import { prisma } from "../db/prisma.js";
import { PrismaProjectStore } from "../modules/project/project.store.prisma.js";

function app() { return buildApp({ projectStore: new PrismaProjectStore(prisma), enableFileWatcher: false }); }

async function resetDatabase(): Promise<void> {
  await prisma.consultRequest.deleteMany(); await prisma.eventJournal.deleteMany(); await prisma.reviewIntent.deleteMany(); await prisma.taskWorkspace.deleteMany();
  await prisma.syncJob.deleteMany(); await prisma.requirement.deleteMany(); await prisma.task.deleteMany();
  await prisma.document.deleteMany(); await prisma.project.deleteMany();
}

async function fixture() {
  const project = await prisma.project.create({
    data: { name: `Pending ${randomUUID()}`, localPath: join(tmpdir(), `ccb-pending-${randomUUID()}`), updatedAt: new Date() }
  });
  const task = await prisma.task.create({
    data: { projectId: project.id, taskKey: `task-${randomUUID()}`, title: "Pending task", currentNode: "review", status: "reviewing", updatedAt: new Date() }
  });
  return { projectId: project.id, taskId: task.id, taskKey: task.taskKey };
}

async function createIntent(fx: Awaited<ReturnType<typeof fixture>>, status = "pending", createdAt = "2026-05-08T12:00:00.000Z", projectId = fx.projectId) {
  return await prisma.reviewIntent.create({
    data: { projectId, taskId: fx.taskId, taskKey: fx.taskKey, intentType: "mark_review_pass", payloadJson: "Pass after checks", status, createdAt: new Date(createdAt) }
  });
}

async function createConsultRequest(fx: Awaited<ReturnType<typeof fixture>>, status: ConsultRequestStatus = "pending", createdAt = "2026-05-08T12:00:00.000Z") {
  return await prisma.consultRequest.create({
    data: {
      taskId: fx.taskId,
      taskKey: fx.taskKey,
      nodeId: "review",
      message: "Please review the pending interaction projection",
      targetAgent: "ccb_codex",
      status,
      createdBy: "console_user",
      createdAt: new Date(createdAt)
    }
  });
}

async function createDevTask(fx: Awaited<ReturnType<typeof fixture>>, frontmatter: Record<string, unknown>) {
  return await prisma.document.create({
    data: {
      projectId: fx.projectId, taskKey: fx.taskKey, path: `docs/03_开发计划/${fx.taskKey}-开发任务.md`, kind: "dev_task",
      title: "Dev Task", status: "reviewing", frontmatterJson: JSON.stringify({ doc_type: "dev_task", task_id: fx.taskKey, ...frontmatter }), contentHash: randomUUID(), mtime: new Date("2026-05-08T12:00:05.000Z")
    }
  });
}

async function getPending(taskId: string) {
  const instance = app();
  const response = await instance.inject({ method: "GET", url: `/api/tasks/${taskId}/pending-interactions` });
  await instance.close();
  return response;
}

test("pending-interactions returns empty response for a task with no pending sources", async () => {
  await resetDatabase();
  const fx = await fixture();
  const response = await getPending(fx.taskId);
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), { task_id: fx.taskId, pending: [], count: 0 });
});

test("pending-interactions maps pending ReviewIntent into ActionHero shape", async () => {
  await resetDatabase();
  const fx = await fixture();
  const intent = await createIntent(fx);
  const item = (await getPending(fx.taskId)).json().pending[0];
  assert.deepEqual(Object.keys(item), ["id", "kind", "source_table", "node_id", "summary", "cta_label", "cta_action", "created_at", "raw_ref"]);
  assert.equal(item.id, intent.id);
  assert.equal(item.kind, "review_intent");
  assert.equal(item.source_table, "ReviewIntent");
  assert.equal(item.cta_action, `open_review_intent:${intent.id}`);
});

test("pending-interactions excludes consumed and project-mismatched ReviewIntent rows", async () => {
  await resetDatabase();
  const fx = await fixture();
  const other = await fixture();
  await createIntent(fx, "consumed");
  await createIntent(fx, "pending", "2026-05-08T12:00:01.000Z", other.projectId);
  const body = (await getPending(fx.taskId)).json();
  assert.equal(body.count, 0);
});

test("pending-interactions reads undecided approval_records from dev_task frontmatter", async () => {
  await resetDatabase();
  const fx = await fixture();
  await createDevTask(fx, { approval_records: JSON.stringify([{ id: "a1", gate: "deploy", decided: false, created_at: "2026-05-08T12:00:02.000Z" }, { id: "a2", gate: "skip", decided: true }]) });
  const item = (await getPending(fx.taskId)).json().pending[0];
  assert.equal(item.kind, "approval_record");
  assert.equal(item.raw_ref, "dev_task#approval_records[0]");
  assert.equal(item.cta_action, "open_approval_record:a1");
});

test("pending-interactions reads pending_user_decision from dev_task frontmatter", async () => {
  await resetDatabase();
  const fx = await fixture();
  await createDevTask(fx, { pending_user_decision: JSON.stringify({ id: "d1", node_id: "review", summary: "Choose next step", created_at: "2026-05-08T12:00:03.000Z" }) });
  const item = (await getPending(fx.taskId)).json().pending[0];
  assert.equal(item.kind, "pending_user_decision");
  assert.equal(item.source_table, "dev_task.pending_user_decision");
  assert.equal(item.cta_label, "决策");
});

test("pending-interactions unions all four sources and sorts by created_at ascending", async () => {
  await resetDatabase();
  const fx = await fixture();
  await createIntent(fx, "pending", "2026-05-08T12:00:04.000Z");
  await createConsultRequest(fx, "pending", "2026-05-08T12:00:02.000Z");
  await createDevTask(fx, {
    approval_records: JSON.stringify([{ id: "a1", decided: false, created_at: "2026-05-08T12:00:01.000Z" }]),
    pending_user_decision: JSON.stringify({ id: "d1", created_at: "2026-05-08T12:00:03.000Z" })
  });
  const body = (await getPending(fx.taskId)).json();
  assert.deepEqual(body.pending.map((item: { kind: string }) => item.kind), ["approval_record", "consult_request", "pending_user_decision", "review_intent"]);
  assert.deepEqual(body.pending.map((item: { source_table: string }) => item.source_table), [
    "dev_task.approval_records",
    "ConsultRequest",
    "dev_task.pending_user_decision",
    "ReviewIntent"
  ]);
  assert.equal(body.count, 4);
});

test("pending-interactions returns 404 for missing task", async () => {
  const response = await getPending(randomUUID());
  assert.equal(response.statusCode, 404);
});

afterAll(async () => {
  await resetDatabase();
  await prisma.$disconnect();
});
