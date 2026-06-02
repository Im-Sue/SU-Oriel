import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, test } from "vitest";

import { buildApp } from "../app.js";
import { prisma } from "../db/prisma.js";
import { PrismaProjectStore } from "../modules/project/project.store.prisma.js";

function app() { return buildApp({ projectStore: new PrismaProjectStore(prisma), enableFileWatcher: false }); }

async function resetDatabase(): Promise<void> {
  await prisma.consultRequest.deleteMany(); await prisma.eventJournal.deleteMany(); await prisma.reviewIntent.deleteMany();
  await prisma.taskCheckpoint.deleteMany(); await prisma.taskWorkspace.deleteMany(); await prisma.syncJob.deleteMany();
  await prisma.requirement.deleteMany(); await prisma.document.deleteMany(); await prisma.task.deleteMany(); await prisma.project.deleteMany();
}

async function fixture(taskKey = `task-${randomUUID()}`) {
  const project = await prisma.project.create({
    data: { name: `Consult records ${randomUUID()}`, localPath: join(tmpdir(), `ccb-consult-records-${randomUUID()}`), updatedAt: new Date() }
  });
  const task = await prisma.task.create({
    data: { projectId: project.id, taskKey, title: "Consult records task", currentNode: "technical_design", status: "reviewing", updatedAt: new Date() }
  });
  return { projectId: project.id, taskId: task.id, taskKey: task.taskKey };
}

async function createDevTask(fx: Awaited<ReturnType<typeof fixture>>, frontmatter: Record<string, unknown>, updatedAt = "2026-05-09T12:00:00.000Z") {
  return await prisma.document.create({
    data: {
      projectId: fx.projectId, taskKey: fx.taskKey, path: `docs/03_开发计划/${fx.taskKey}-开发任务.md`, kind: "dev_task",
      title: "Dev Task", status: "reviewing", frontmatterJson: JSON.stringify({ doc_type: "dev_task", ...frontmatter }), contentHash: randomUUID(),
      mtime: new Date(updatedAt), updatedAt: new Date(updatedAt)
    }
  });
}

async function getConsultRecords(taskId: string) {
  const instance = app();
  const response = await instance.inject({ method: "GET", url: `/api/tasks/${taskId}/consult-records` });
  await instance.close();
  return response;
}

test("consult-records returns an empty list when dev_task has no consult_records", async () => {
  await resetDatabase();
  const fx = await fixture();
  await createDevTask(fx, { task_id: fx.taskKey, revision: 1 });
  const response = await getConsultRecords(fx.taskId);
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), { task_id: fx.taskId, consult_records: [], count: 0 });
});

test("consult-records reads and sorts multiple rounds from dev_task frontmatter", async () => {
  await resetDatabase();
  const fx = await fixture();
  await createDevTask(fx, {
    task_id: fx.taskKey,
    consult_records: [
      { round: "R2", layer: "technical_design", input_summary: "second", codex_reply: { recommendation: "ship" }, stop_reason: "converged", timestamp: "2026-05-09T12:00:02.000Z" },
      { round: "R1", layer: "technical_design", input_summary: "first", codex_reply: { recommendation: "revise" }, stop_reason: "converged", timestamp: "2026-05-09T12:00:01.000Z" }
    ]
  });
  const body = (await getConsultRecords(fx.taskId)).json();
  assert.deepEqual(body.consult_records.map((record: { round: string }) => record.round), ["R1", "R2"]);
  assert.equal(body.consult_records[0].input_summary, "first");
  assert.equal(body.count, 2);
});

test("consult-records ignores same taskKey dev_task documents from other projects", async () => {
  await resetDatabase();
  const taskKey = `task-${randomUUID()}`;
  const fx = await fixture(taskKey);
  const other = await fixture(taskKey);
  await createDevTask(other, { task_id: taskKey, consult_records: [{ round: "R1", input_summary: "wrong project" }] });
  await createDevTask(fx, { task_id: taskKey, consult_records: [{ round: "R1", input_summary: "right project" }] });
  const body = (await getConsultRecords(fx.taskId)).json();
  assert.equal(body.consult_records[0].input_summary, "right project");
});

test("consult-records returns 404 for a missing task", async () => {
  await resetDatabase();
  const response = await getConsultRecords(randomUUID());
  assert.equal(response.statusCode, 404);
});

afterAll(async () => {
  await resetDatabase();
  await prisma.$disconnect();
});
