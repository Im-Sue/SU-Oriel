import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";

import { afterEach, test } from "vitest";

import { prisma } from "../db/prisma.js";
import {
  ConsultCodexDevTaskConflictError,
  runConsultCodexPrimitive
} from "../modules/primitive/consult-codex.service.js";
import { TaskEventViewService } from "../modules/task-event-view/task-event-view.service.js";

const roots = new Set<string>();

async function resetData() {
  await prisma.consultRequest.deleteMany(); await prisma.taskCheckpoint.deleteMany(); await prisma.reviewIntent.deleteMany();
  await prisma.taskWorkspace.deleteMany(); await prisma.eventJournal.deleteMany();
  await prisma.document.deleteMany(); await prisma.task.deleteMany(); await prisma.project.deleteMany();
  for (const root of roots) await rm(root, { recursive: true, force: true });
  roots.clear();
}

async function fixture(currentNode = "review") {
  const root = await mkdtemp(join(tmpdir(), "ccb-consult-primitive-")); roots.add(root);
  const taskKey = `task-${randomUUID()}`;
  const devTaskPath = join(root, "docs", "03_开发计划", `${taskKey}-开发任务.md`);
  await mkdir(join(root, "docs", "03_开发计划"), { recursive: true });
  await writeFile(devTaskPath, `---\ndoc_type: dev_task\ntask_id: ${taskKey}\ncurrent_node: ${currentNode}\nrevision: 1\nstatus: reviewing\n---\n# Body\n`, "utf8");
  const project = await prisma.project.create({ data: { name: `Consult primitive ${randomUUID()}`, localPath: root, updatedAt: new Date() } });
  await prisma.document.create({ data: { projectId: project.id, taskKey, path: relative(root, devTaskPath), kind: "dev_task", title: taskKey, frontmatterJson: JSON.stringify({ doc_type: "dev_task", task_id: taskKey, current_node: currentNode, revision: 1 }), contentHash: randomUUID(), mtime: new Date() } });
  const task = await prisma.task.create({ data: { projectId: project.id, taskKey, title: "Consult primitive task", currentNode, status: "reviewing", updatedAt: new Date() } });
  const request = await prisma.consultRequest.create({ data: { taskId: task.id, taskKey, nodeId: "review", message: "Need another view", targetAgent: "ccb_codex", createdBy: "console_user" } });
  return { task, request, devTaskPath };
}

function frontmatterValue(content: string, key: string): string | null {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  for (const line of (match?.[1] ?? "").split(/\r?\n/)) {
    const index = line.indexOf(":");
    if (index !== -1 && line.slice(0, index).trim() === key) return line.slice(index + 1).trim();
  }
  return null;
}

function consultRecords(content: string): unknown[] {
  const raw = frontmatterValue(content, "consult_records");
  return raw ? JSON.parse(raw) as unknown[] : [];
}

afterEach(resetData);

test("consult_codex appends consult_records and consumes consult_request in one persist step", async () => {
  const fx = await fixture();
  const result = await runConsultCodexPrimitive({ taskId: fx.task.id, nodeId: "review", message: fx.request.message, targetAgent: "ccb_codex", createdBy: "console_user", consultRequestId: fx.request.id, now: new Date("2026-05-09T00:00:00.000Z") });
  assert.equal(result.round, "R1");
  const request = await prisma.consultRequest.findUniqueOrThrow({ where: { id: fx.request.id } });
  assert.equal(request.status, "consumed"); assert.equal(request.consultRound, "R1");
  assert.equal(consultRecords(await readFile(fx.devTaskPath, "utf8")).length, 1);
  const document = await prisma.document.findFirstOrThrow({ where: { taskKey: fx.task.taskKey, kind: "dev_task" } });
  assert.equal((JSON.parse(document.frontmatterJson ?? "{}").consult_records as unknown[]).length, 1);
});

test("consult_codex rolls consult_request back when state CAS detects drift", async () => {
  const fx = await fixture();
  await assert.rejects(
    () => runConsultCodexPrimitive(
      { taskId: fx.task.id, nodeId: "review", message: fx.request.message, targetAgent: "ccb_codex", consultRequestId: fx.request.id },
      { beforePersist: async () => writeFile(fx.devTaskPath, (await readFile(fx.devTaskPath, "utf8")).replace("revision: 1", "revision: 2"), "utf8") }
    ),
    ConsultCodexDevTaskConflictError
  );
  assert.equal((await prisma.consultRequest.findUniqueOrThrow({ where: { id: fx.request.id } })).status, "pending");
  assert.equal(consultRecords(await readFile(fx.devTaskPath, "utf8")).length, 0);
});

test("consult_codex emits state_write_conflict and timeline can see it when CAS detects drift", async () => {
  const fx = await fixture();

  await assert.rejects(
    () => runConsultCodexPrimitive(
      {
        taskId: fx.task.id,
        nodeId: "review",
        message: fx.request.message,
        targetAgent: "ccb_codex",
        createdBy: "console_user",
        consultRequestId: fx.request.id,
        now: new Date("2026-05-24T10:00:00.000Z")
      },
      { beforePersist: async () => writeFile(fx.devTaskPath, (await readFile(fx.devTaskPath, "utf8")).replace("revision: 1", "revision: 2"), "utf8") }
    ),
    ConsultCodexDevTaskConflictError
  );

  const event = await prisma.eventJournal.findFirstOrThrow({
    where: {
      eventType: "state_write_conflict",
      subjectType: "subtask",
      subjectId: fx.task.id
    }
  });
  assert.equal(event.sourceActor, "codex");
  assert.equal(event.sourceComponent, "primitive_executor");
  assert.equal(event.stateRevisionSeen, 1);
  assert.deepEqual(JSON.parse(event.payloadJson), {
    resource_type: "dev_task",
    expected_revision: 1,
    actual_revision: 2,
    writer: "console_user",
    primitive: "consult_codex"
  });

  const timeline = await new TaskEventViewService(prisma).buildTimeline(fx.task.id);
  assert.equal(timeline.events.some((item) => item.kind === "state_write_conflict"), true);
});
