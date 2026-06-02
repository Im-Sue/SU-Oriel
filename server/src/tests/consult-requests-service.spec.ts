import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, test } from "vitest";

import { prisma } from "../db/prisma.js";
import { cancelConsultRequest, ConsultRequestAgentNotAllowedError, ConsultRequestNodeMismatchError, ConsultRequestPendingExistsError, getConsultRequest, listPendingForTask, submitConsultRequest } from "../modules/consult-requests/consult-requests.service.js";

async function resetData() {
  await prisma.consultRequest.deleteMany(); await prisma.taskCheckpoint.deleteMany(); await prisma.reviewIntent.deleteMany(); await prisma.taskWorkspace.deleteMany(); await prisma.eventJournal.deleteMany(); await prisma.task.deleteMany(); await prisma.project.deleteMany();
}
async function fixture(currentNode = "review") {
  const project = await prisma.project.create({ data: { name: `Consult ${randomUUID()}`, localPath: join(tmpdir(), `ccb-consult-${randomUUID()}`), updatedAt: new Date() } });
  const task = await prisma.task.create({ data: { projectId: project.id, taskKey: `task-${randomUUID()}`, title: "Consult task", currentNode, status: "reviewing", updatedAt: new Date() } });
  return { project, task };
}
const input = (taskId: string, overrides = {}) => ({ taskId, nodeId: "review", message: "请检查实现", targetAgent: "main_codex", createdBy: "console_user", ...overrides });
afterEach(async () => { await resetData(); });

test("submitConsultRequest creates a single pending queue row for the current node", async () => {
  const { task } = await fixture();
  const row = await submitConsultRequest(input(task.id));
  assert.equal(row.taskKey, task.taskKey); assert.equal(row.status, "pending"); assert.equal(row.targetAgent, "main_codex");
});

test("submitConsultRequest rejects requests for a stale node", async () => {
  const { task } = await fixture("implementation");
  await assert.rejects(() => submitConsultRequest(input(task.id)), ConsultRequestNodeMismatchError);
});

test("submitConsultRequest rejects target agents outside .ccb/ccb.config", async () => {
  const { task } = await fixture();
  await assert.rejects(() => submitConsultRequest(input(task.id, { targetAgent: "unknown_agent" })), ConsultRequestAgentNotAllowedError);
});

test("submitConsultRequest rejects a second pending request for the same task", async () => {
  const { task } = await fixture();
  await submitConsultRequest(input(task.id));
  await assert.rejects(() => submitConsultRequest(input(task.id, { message: "second" })), ConsultRequestPendingExistsError);
});

test("cancelConsultRequest only removes pending rows from the scheduler list", async () => {
  const { task } = await fixture();
  const row = await submitConsultRequest(input(task.id));
  assert.equal((await cancelConsultRequest(task.id, row.id)).status, "cancelled");
  assert.deepEqual(await listPendingForTask(task.id), []);
});

test("getConsultRequest and listPendingForTask are scoped by task id", async () => {
  const first = await fixture(); const second = await fixture();
  const row = await submitConsultRequest(input(first.task.id));
  assert.equal(await getConsultRequest(second.task.id, row.id), null);
  assert.deepEqual((await listPendingForTask(second.task.id)).map((item) => item.id), []);
});
