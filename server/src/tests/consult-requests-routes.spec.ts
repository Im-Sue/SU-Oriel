import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, test } from "vitest";

import { buildApp } from "../app.js";
import { prisma } from "../db/prisma.js";
import { PrismaProjectStore } from "../modules/project/project.store.prisma.js";

const auth: Record<string, string> = { "x-ccb-token": "dev-token" };
function app() { return buildApp({ projectStore: new PrismaProjectStore(prisma), enableFileWatcher: false }); }
async function resetData() {
  await prisma.consultRequest.deleteMany(); await prisma.taskCheckpoint.deleteMany(); await prisma.reviewIntent.deleteMany(); await prisma.taskWorkspace.deleteMany(); await prisma.eventJournal.deleteMany(); await prisma.task.deleteMany(); await prisma.project.deleteMany();
}
async function fixture(currentNode = "review") {
  const project = await prisma.project.create({ data: { name: `Consult route ${randomUUID()}`, localPath: join(tmpdir(), `ccb-consult-route-${randomUUID()}`), updatedAt: new Date() } });
  const task = await prisma.task.create({ data: { projectId: project.id, taskKey: `task-${randomUUID()}`, title: "Consult route task", currentNode, status: "reviewing", updatedAt: new Date() } });
  return { project, task };
}
async function post(taskId: string, nodeId: string, headers: Record<string, string> = auth, targetAgent = "main_codex") {
  const instance = app();
  const response = await instance.inject({ method: "POST", url: `/api/tasks/${taskId}/nodes/${nodeId}/consult-requests`, headers, payload: { message: "Need another look", target_agent: targetAgent } });
  await instance.close(); return response;
}
afterEach(async () => { await resetData(); });

test("POST consult-requests creates a pending request when authenticated", async () => {
  const { task } = await fixture(); const response = await post(task.id, "review");
  assert.equal(response.statusCode, 201); assert.equal(response.json().request.task_id, task.id); assert.equal(response.json().request.target_agent, "main_codex");
});

test("POST consult-requests rejects missing x-ccb-token", async () => {
  const { task } = await fixture();
  assert.equal((await post(task.id, "review", {})).statusCode, 401);
});

test("POST consult-requests maps stale node and unknown agent to spec errors", async () => {
  const { task } = await fixture("implementation");
  assert.equal((await post(task.id, "review")).statusCode, 409);
  assert.equal((await post(task.id, "implementation", auth, "unknown_agent")).statusCode, 400);
});

test("POST consult-requests rate limits the sixth request from the same IP", async () => {
  const { task } = await fixture(); const instance = app();
  for (let i = 0; i < 5; i += 1) await instance.inject({ method: "POST", url: `/api/tasks/${task.id}/nodes/review/consult-requests`, headers: auth, payload: { message: `msg ${i}`, target_agent: "main_codex" } });
  const limited = await instance.inject({ method: "POST", url: `/api/tasks/${task.id}/nodes/review/consult-requests`, headers: auth, payload: { message: "msg 6", target_agent: "main_codex" } });
  assert.equal(limited.statusCode, 429); await instance.close();
});

test("DELETE consult-requests cancels a pending request", async () => {
  const { task } = await fixture(); const created = (await post(task.id, "review")).json().request; const instance = app();
  const response = await instance.inject({ method: "DELETE", url: `/api/tasks/${task.id}/consult-requests/${created.id}`, headers: auth });
  assert.equal(response.statusCode, 200); assert.equal(response.json().request.status, "cancelled"); await instance.close();
});

test("GET consult-requests does not leak rows across task ids", async () => {
  const first = await fixture(); const second = await fixture(); const created = (await post(first.task.id, "review")).json().request;
  const instance = app(); const response = await instance.inject({ method: "GET", url: `/api/tasks/${second.task.id}/consult-requests/${created.id}` });
  assert.equal(response.statusCode, 404); await instance.close();
});
