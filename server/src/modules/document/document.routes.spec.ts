import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import { afterAll, beforeEach, test } from "vitest";

import { buildApp } from "../../app.js";
import { prisma } from "../../db/prisma.js";
import { getDocsStructureResolver } from "../../indexer/docs-structure-resolver.js";
import { buildDocumentMapEntries } from "../../indexer/project-indexer.js";
import type { ParsedDocumentRecord } from "../../indexer/document-parser.js";

const app = buildApp({ enableFileWatcher: false });

async function resetDatabase(): Promise<void> {
  await prisma.anchorDispatchQueue.deleteMany();
  await prisma.eventJournal.deleteMany();
  await prisma.slotBinding.deleteMany();
  await prisma.task.deleteMany();
  await prisma.document.deleteMany();
  await prisma.requirement.deleteMany();
  await prisma.anchorAllocation.deleteMany();
  await prisma.project.deleteMany();
}

async function seedProject(): Promise<string> {
  const project = await prisma.project.create({
    data: { name: "PR2 Fixture", localPath: `/tmp/ccb-pr2-${randomUUID()}`, summary: "" },
    select: { id: true }
  });
  return project.id;
}

function makeParsed(input: Partial<ParsedDocumentRecord> & Pick<ParsedDocumentRecord, "path" | "kind">): ParsedDocumentRecord {
  return {
    taskKey: input.path.split("/").pop()?.replace(/\.md$/, "") ?? "",
    title: input.title ?? "Untitled",
    status: null,
    phase: null,
    priority: null,
    progress: null,
    summary: null,
    contentHash: "h",
    mtime: new Date("2026-05-01T00:00:00.000Z"),
    parseStatus: "success",
    parseError: null,
    parseIssues: [],
    frontmatter: {},
    ...input
  };
}

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

test("GET /documents · list 项 additive 携带 governance(形正确,既有字段不回归)", async () => {
  const projectId = await seedProject();
  const reqId = `req-${randomUUID().slice(0, 8)}`;
  await prisma.requirement.create({
    data: { id: reqId, projectId, title: "需求 A", description: "desc", status: "delivering" }
  });
  await prisma.document.createMany({
    data: [
      {
        projectId,
        path: "docs/03_开发计划/td-技术设计.md",
        kind: "technical_design",
        title: "技术设计",
        contentHash: "h1",
        mtime: new Date("2026-05-01T00:00:00.000Z"),
        parseStatus: "success",
        frontmatterJson: JSON.stringify({ requirement_id: reqId })
      },
      {
        projectId,
        path: "docs/03_开发计划/task-开发任务.md",
        kind: "dev_task",
        taskKey: "task-fallback",
        title: "任务",
        contentHash: "h2",
        mtime: new Date("2026-05-02T00:00:00.000Z"),
        parseStatus: "success",
        frontmatterJson: JSON.stringify({ task_id: "subtask-xyz", status: "reviewing", requirement_id: reqId })
      }
    ]
  });

  const res = await app.inject({ method: "GET", url: `/api/projects/${projectId}/documents` });
  assert.equal(res.statusCode, 200);
  const body = res.json() as { items: Array<Record<string, unknown> & { governance: Record<string, unknown> }> };
  assert.equal(body.items.length, 2);

  const td = body.items.find((i) => String(i.path).includes("td-技术设计"))!;
  const task = body.items.find((i) => String(i.path).includes("task-开发任务"))!;

  // governance 形:仅 {tier,requirementId,entityStatus,taskId,healthFlags}
  assert.deepEqual(Object.keys(td.governance).sort(), ["entityStatus", "healthFlags", "requirementId", "taskId", "tier"]);
  // technical_design 绑定 delivering 需求(DB status)→ 生效中 / entityStatus delivering / 无 taskId
  assert.equal(td.governance.requirementId, reqId);
  assert.equal(td.governance.entityStatus, "delivering");
  assert.equal(td.governance.tier, "生效中");
  assert.equal(td.governance.taskId, null);
  assert.deepEqual(td.governance.healthFlags, { parseError: false });
  // dev_task:entityStatus=status、taskId 来自 frontmatter.task_id
  assert.equal(task.governance.entityStatus, "reviewing");
  assert.equal(task.governance.taskId, "subtask-xyz");
  assert.equal(task.governance.tier, "生效中");

  // 既有字段不回归
  for (const key of ["id", "projectId", "taskKey", "path", "kind", "title", "status", "summary", "parseStatus", "mtime", "updatedAt"]) {
    assert.ok(key in td, `list 项缺既有字段 ${key}`);
  }
});

test("GET /documents · parseError 健康标志由 parseStatus 派生(不暴露原文)", async () => {
  const projectId = await seedProject();
  await prisma.document.create({
    data: {
      projectId,
      path: "docs/03_开发计划/broken-开发任务.md",
      kind: "dev_task",
      taskKey: "broken",
      title: "解析异常",
      contentHash: "h",
      mtime: new Date("2026-05-01T00:00:00.000Z"),
      parseStatus: "parse_error",
      parseError: "secret raw parse error text",
      frontmatterJson: null
    }
  });

  const res = await app.inject({ method: "GET", url: `/api/projects/${projectId}/documents` });
  const item = (res.json() as { items: Array<{ governance: { healthFlags: { parseError: boolean } } } & Record<string, unknown>> }).items[0];
  assert.equal(item.governance.healthFlags.parseError, true);
  // 不暴露 parseError 原文
  assert.ok(!("parseError" in item.governance.healthFlags) || typeof item.governance.healthFlags.parseError === "boolean");
  assert.ok(!JSON.stringify(item).includes("secret raw parse error text"));
});

test("GET /documents · 不存在 projectId 返回空列表(不是 404)", async () => {
  const res = await app.inject({ method: "GET", url: `/api/projects/nonexistent-${randomUUID()}/documents` });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json(), { items: [] });
});

test("GET /documents · cache 缺失但 DB 有文档仍返回 governance(不依赖磁盘 cache)", async () => {
  // 不写任何 document-map.json / 磁盘 cache,仅 DB 有文档
  const projectId = await seedProject();
  await prisma.document.create({
    data: {
      projectId,
      path: "docs/06_决策记录/ADR-0001-x.md",
      kind: "adr",
      title: "ADR",
      contentHash: "h",
      mtime: new Date("2026-05-01T00:00:00.000Z"),
      parseStatus: "success",
      frontmatterJson: JSON.stringify({ status: "accepted" })
    }
  });
  const res = await app.inject({ method: "GET", url: `/api/projects/${projectId}/documents` });
  const item = (res.json() as { items: Array<{ governance: { tier: string } }> }).items[0];
  assert.equal(item.governance.tier, "生效中"); // accepted ADR
});

test("pr1↔pr2 一致性:同一 fixture 两路 entityStatus/tier 相同(DB status === 解析 frontmatter status)", async () => {
  const projectId = await seedProject();
  const reqId = `req-${randomUUID().slice(0, 8)}`;
  await prisma.requirement.create({
    data: { id: reqId, projectId, title: "需求 B", description: "desc", status: "delivered" }
  });
  await prisma.document.create({
    data: {
      projectId,
      path: "docs/03_开发计划/td2-技术设计.md",
      kind: "technical_design",
      title: "技术设计 2",
      contentHash: "h",
      mtime: new Date("2026-05-01T00:00:00.000Z"),
      parseStatus: "success",
      frontmatterJson: JSON.stringify({ requirement_id: reqId })
    }
  });

  // pr2 路:DB → route
  const routeGov = (await app.inject({ method: "GET", url: `/api/projects/${projectId}/documents` }).then((r) => r.json())).items[0]
    .governance as { entityStatus: string | null; tier: string; requirementId: string | null };

  // pr1 路:解析 docs → buildDocumentMapEntries(含同 id/status 的 requirement 文档)
  const resolver = getDocsStructureResolver();
  const entries = buildDocumentMapEntries(
    [
      makeParsed({ path: "docs/02_需求设计/r-需求.md", kind: "requirement", frontmatter: { id: reqId, status: "delivered" } }),
      makeParsed({ path: "docs/03_开发计划/td2-技术设计.md", kind: "technical_design", frontmatter: { requirement_id: reqId } })
    ],
    "2026-05-29T00:00:00.000Z",
    resolver
  );
  const tdEntry = entries.find((e) => e.path.includes("td2"))!;

  assert.equal(routeGov.entityStatus, "delivered");
  assert.equal(routeGov.tier, "历史");
  assert.equal(routeGov.entityStatus, tdEntry.entityStatus, "两路 entityStatus 必须一致");
  assert.equal(routeGov.tier, tdEntry.tier, "两路 tier 必须一致");
  assert.equal(routeGov.requirementId, tdEntry.requirementId, "两路 requirementId 必须一致");
});
