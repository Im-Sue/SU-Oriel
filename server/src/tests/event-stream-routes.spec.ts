import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, test } from "vitest";

import { buildApp } from "../app.js";
import { prisma } from "../db/prisma.js";
import { streamTaskEvents } from "../modules/events/event-stream.service.js";
import { PrismaProjectStore } from "../modules/project/project.store.prisma.js";

function testApp() {
  return buildApp({ projectStore: new PrismaProjectStore(prisma), enableFileWatcher: false });
}

async function resetDatabase(): Promise<void> {
  await prisma.eventJournal.deleteMany(); await prisma.reviewIntent.deleteMany(); await prisma.taskWorkspace.deleteMany();
  await prisma.syncJob.deleteMany(); await prisma.requirement.deleteMany(); await prisma.task.deleteMany();
  await prisma.document.deleteMany(); await prisma.project.deleteMany();
}

async function fixture() {
  const project = await prisma.project.create({
    data: { name: `SSE ${randomUUID()}`, localPath: join(tmpdir(), `ccb-sse-${randomUUID()}`), updatedAt: new Date() }
  });
  const task = await prisma.task.create({
    data: { projectId: project.id, taskKey: `task-${randomUUID()}`, title: "SSE task", status: "reviewing", currentNode: "implementation", updatedAt: new Date() }
  });
  return { projectId: project.id, taskId: task.id, taskKey: task.taskKey };
}

async function eventRow(fx: Awaited<ReturnType<typeof fixture>>, index: number, overrides = {}) {
  return await prisma.eventJournal.create({
    data: {
      eventId: randomUUID(), eventType: "codex_receipt_ready", projectId: fx.projectId,
      subjectType: "subtask", subjectId: fx.taskId, subjectKey: fx.taskKey, emittedAt: new Date(`2026-05-08T12:00:0${index}.000Z`),
      payloadJson: JSON.stringify({ receipt_ref: `r-${index}.md`, provider: "codex", receipt_summary: `event ${index}`, unsolicited_findings: [] }),
      sourceActor: "codex", sourceComponent: "primitive_executor", ...overrides
    }
  });
}

async function waitFor<T>(read: () => T | undefined): Promise<T> {
  for (let i = 0; i < 40; i += 1) {
    const value = read();
    if (value !== undefined) return value;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("timed out waiting for stream assertion");
}

test("GET /api/tasks/:taskId/events rejects non-SSE Accept headers", async () => {
  await resetDatabase();
  const fx = await fixture();
  const app = testApp();
  const response = await app.inject({ method: "GET", url: `/api/tasks/${fx.taskId}/events`, headers: { accept: "application/json" } });
  assert.equal(response.statusCode, 406);
  await app.close();
});

test("GET /api/tasks/:taskId/events returns 404 for missing tasks before opening SSE", async () => {
  const app = testApp();
  const response = await app.inject({ method: "GET", url: `/api/tasks/${randomUUID()}/events`, headers: { accept: "text/event-stream" } });
  assert.equal(response.statusCode, 404);
  await app.close();
});

test("GET /api/tasks/:taskId/events returns 410 when Last-Event-ID is unknown", async () => {
  await resetDatabase();
  const fx = await fixture();
  const app = testApp();
  const requestedEventId = randomUUID();
  const response = await app.inject({ method: "GET", url: `/api/tasks/${fx.taskId}/events?since=${requestedEventId}`, headers: { accept: "text/event-stream" } });
  assert.equal(response.statusCode, 410);
  assert.deepEqual(JSON.parse(response.payload), { error: "last_event_id_not_found", task_id: fx.taskId, requested_event_id: requestedEventId });
  await app.close();
});

test("streamTaskEvents emits heartbeat callbacks on the configured interval", async () => {
  await resetDatabase();
  const fx = await fixture();
  let heartbeats = 0;
  const controller = await streamTaskEvents(fx.taskId, undefined, () => {}, () => {}, () => {}, {
    heartbeatIntervalMs: 20, onHeartbeat: () => { heartbeats += 1; }
  });
  assert.equal(await waitFor(() => (heartbeats > 0 ? heartbeats : undefined)), 1);
  controller.close();
});

test("streamTaskEvents does not create timers after early abort during initialization", async () => {
  await resetDatabase();
  const fx = await fixture();
  const abortController = new AbortController();
  let heartbeats = 0;
  const started = streamTaskEvents(fx.taskId, undefined, () => {}, () => {}, () => {}, { pollingIntervalMs: 20, heartbeatIntervalMs: 20, onHeartbeat: () => { heartbeats += 1; }, abortSignal: abortController.signal });
  abortController.abort();
  const controller = await started;
  await new Promise((resolve) => setTimeout(resolve, 60));
  assert.equal(heartbeats, 0);
  controller.close();
});

test("streamTaskEvents emits new EventJournal rows as event-store envelopes", async () => {
  await resetDatabase();
  const fx = await fixture();
  const events: string[] = [];
  const controller = await streamTaskEvents(fx.taskId, undefined, (event) => { events.push(event.event_id); }, () => {}, () => {}, { pollingIntervalMs: 20 });
  const row = await eventRow(fx, 1);
  assert.equal(await waitFor(() => events[0]), row.eventId);
  controller.close();
});

test("streamTaskEvents resumes after Last-Event-ID using emittedAt plus id ordering", async () => {
  await resetDatabase();
  const fx = await fixture();
  const first = await eventRow(fx, 1, { id: "event-c" });
  const second = await eventRow(fx, 2, { id: "event-a", emittedAt: first.emittedAt });
  const third = await eventRow(fx, 3, { id: "event-b", emittedAt: first.emittedAt });
  const events: string[] = [];
  const controller = await streamTaskEvents(fx.taskId, second.eventId, (event) => { events.push(event.event_id); }, () => {}, () => {}, { pollingIntervalMs: 20 });
  assert.equal(await waitFor(() => events[0]), third.eventId);
  controller.close();
});

test("streamTaskEvents skips malformed EventJournal payloads without sending them", async () => {
  await resetDatabase();
  const fx = await fixture();
  const anchor = await eventRow(fx, 1);
  await eventRow(fx, 2, { payloadJson: "{bad-json" });
  const valid = await eventRow(fx, 3);
  const events: string[] = [];
  const controller = await streamTaskEvents(fx.taskId, anchor.eventId, (event) => { events.push(event.event_id); }, () => {}, () => {}, { pollingIntervalMs: 20 });
  assert.equal(await waitFor(() => events[0]), valid.eventId);
  assert.deepEqual(events, [valid.eventId]);
  controller.close();
});

test("streamTaskEvents closes when the server-side buffer would exceed the limit", async () => {
  await resetDatabase();
  const fx = await fixture();
  const anchor = await eventRow(fx, 1);
  await eventRow(fx, 2); await eventRow(fx, 3);
  let closed = false;
  await streamTaskEvents(fx.taskId, anchor.eventId, () => {}, () => {}, () => { closed = true; }, { bufferLimit: 1, pollingIntervalMs: 20 });
  assert.equal(await waitFor(() => (closed ? true : undefined)), true);
});

afterAll(async () => {
  await resetDatabase();
  await prisma.$disconnect();
});
