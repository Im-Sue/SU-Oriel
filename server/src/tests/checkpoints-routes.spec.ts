import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, test } from "vitest";

import { buildApp } from "../app.js";
import { prisma } from "../db/prisma.js";
import { writeCheckpointForTransitionForTest } from "../modules/checkpoints/checkpoints.service.js";
import { PrismaProjectStore } from "../modules/project/project.store.prisma.js";

async function resetData() {
  await prisma.taskCheckpoint.deleteMany(); await prisma.eventJournal.deleteMany();
  await prisma.reviewIntent.deleteMany(); await prisma.taskWorkspace.deleteMany(); await prisma.task.deleteMany(); await prisma.project.deleteMany();
}
async function fixture() {
  const project = await prisma.project.create({ data: { name: `Checkpoint route ${randomUUID()}`, localPath: join(tmpdir(), `ccb-checkpoint-route-${randomUUID()}`), updatedAt: new Date() } });
  const task = await prisma.task.create({ data: { projectId: project.id, taskKey: `task-${randomUUID()}`, title: "Checkpoint task", currentNode: "implementation", status: "reviewing", updatedAt: new Date() } });
  return { project, task };
}
async function seed(fx: Awaited<ReturnType<typeof fixture>>, transitionId = `transition-${randomUUID()}`) {
  return await writeCheckpointForTransitionForTest({ projectLocalPath: fx.project.localPath, taskId: fx.task.id, taskKey: fx.task.taskKey, transitionId, nodeBefore: "dispatch", nodeAfter: "implementation", stateRevisionAfter: 2, snapshot: { currentNode: "implementation", stateRevisionSeen: 2 } });
}
async function get(url: string) {
  const instance = buildApp({ projectStore: new PrismaProjectStore(prisma), enableFileWatcher: false });
  const response = await instance.inject({ method: "GET", url });
  await instance.close();
  return response;
}

afterEach(async () => { await resetData(); });

test("GET /api/tasks/:taskId/checkpoints lists checkpoints in created order", async () => {
  const fx = await fixture(); await seed(fx, "transition-a"); await seed(fx, "transition-b");
  assert.deepEqual((await get(`/api/tasks/${fx.task.id}/checkpoints`)).json().map((item: { transitionId: string }) => item.transitionId), ["transition-a", "transition-b"]);
});

test("GET /api/tasks/:taskId/checkpoints/:transitionId returns checkpoint detail", async () => {
  const fx = await fixture(); await seed(fx, "transition-detail");
  const response = await get(`/api/tasks/${fx.task.id}/checkpoints/transition-detail`);
  assert.equal(response.statusCode, 200);
  assert.equal(response.json().snapshot.currentNode, "implementation");
});

test("checkpoint routes return 404 for missing task or missing transition", async () => {
  const fx = await fixture();
  assert.equal((await get(`/api/tasks/${randomUUID()}/checkpoints`)).statusCode, 404);
  assert.equal((await get(`/api/tasks/${fx.task.id}/checkpoints/missing-transition`)).statusCode, 404);
});

test("checkpoint detail is scoped by task id", async () => {
  const first = await fixture(); const second = await fixture(); await seed(first, "same-transition");
  assert.equal((await get(`/api/tasks/${second.task.id}/checkpoints/same-transition`)).statusCode, 404);
});
