import assert from "node:assert/strict";

import { test } from "vitest";

import { buildDevTaskPathIndex, buildDocumentMapEntries } from "./project-indexer.js";
import { getDocsStructureResolver } from "./docs-structure-resolver.js";
import {
  deriveDocumentGovernance,
  normalizeRequirementId,
  normalizeTaskId,
  type DocGovernanceContext
} from "./document-governance.js";
import type { ParsedDocumentRecord } from "./document-parser.js";

// ---------------- deriveDocumentGovernance · 纯 builder 单测(派生规则真相源) ----------------

function ctx(
  docTypeInfo: DocGovernanceContext["docTypeInfo"],
  requirementStatus: Record<string, string> = {}
): DocGovernanceContext {
  return { docTypeInfo, requirementStatusById: new Map(Object.entries(requirementStatus)) };
}

const REQUIREMENT_INFO = { hasStatus: true, followsEntity: null };
const FOLLOWS_REQUIREMENT_INFO = { hasStatus: false, followsEntity: "requirement" };
const DEV_TASK_INFO = { hasStatus: true, followsEntity: "requirement" };

test("governance · requirement: tier 跟随自身 status,entityStatus=status", () => {
  const active = deriveDocumentGovernance(
    { kind: "requirement", isArchivePath: false, taskKey: "r", frontmatter: { status: "delivering" }, parseStatus: "success" },
    ctx(REQUIREMENT_INFO)
  );
  assert.equal(active.tier, "生效中");
  assert.equal(active.entityStatus, "delivering");
  assert.equal(active.requirementId, null);
  assert.equal(active.taskId, null);

  const historical = deriveDocumentGovernance(
    { kind: "requirement", isArchivePath: false, taskKey: "r", frontmatter: { status: "delivered" }, parseStatus: "success" },
    ctx(REQUIREMENT_INFO)
  );
  assert.equal(historical.tier, "历史");
  assert.equal(historical.entityStatus, "delivered");
});

test("governance · technical_design: tier/entityStatus 跟随绑定 requirement;未绑定→null", () => {
  const boundHistorical = deriveDocumentGovernance(
    { kind: "technical_design", isArchivePath: false, taskKey: "td", frontmatter: { requirement_id: "req-1" }, parseStatus: "success" },
    ctx(FOLLOWS_REQUIREMENT_INFO, { "req-1": "delivered" })
  );
  assert.equal(boundHistorical.tier, "历史");
  assert.equal(boundHistorical.entityStatus, "delivered");
  assert.equal(boundHistorical.requirementId, "req-1");

  const boundActive = deriveDocumentGovernance(
    { kind: "technical_design", isArchivePath: false, taskKey: "td", frontmatter: { requirement_id: "req-1" }, parseStatus: "success" },
    ctx(FOLLOWS_REQUIREMENT_INFO, { "req-1": "delivering" })
  );
  assert.equal(boundActive.tier, "生效中");
  assert.equal(boundActive.entityStatus, "delivering");

  // requirement_id 指向未知需求 → tier 生效中(historical(undefined)=false)、entityStatus null
  const unknownReq = deriveDocumentGovernance(
    { kind: "technical_design", isArchivePath: false, taskKey: "td", frontmatter: { requirement_id: "missing" }, parseStatus: "success" },
    ctx(FOLLOWS_REQUIREMENT_INFO, {})
  );
  assert.equal(unknownReq.tier, "生效中");
  assert.equal(unknownReq.entityStatus, null);

  // 完全无 requirement_id → requirementId null、entityStatus null
  const unbound = deriveDocumentGovernance(
    { kind: "technical_design", isArchivePath: false, taskKey: "td", frontmatter: {}, parseStatus: "success" },
    ctx(FOLLOWS_REQUIREMENT_INFO, {})
  );
  assert.equal(unbound.requirementId, null);
  assert.equal(unbound.entityStatus, null);
});

test("governance · dev_task: tier 按 done/cancelled,entityStatus=status||current_node,taskId fallback", () => {
  const reviewing = deriveDocumentGovernance(
    {
      kind: "dev_task",
      isArchivePath: false,
      taskKey: "task-key",
      frontmatter: { task_id: "subtask-abc", status: "reviewing", current_node: "dispatch" },
      parseStatus: "success"
    },
    ctx(DEV_TASK_INFO)
  );
  assert.equal(reviewing.tier, "生效中");
  assert.equal(reviewing.entityStatus, "reviewing");
  assert.equal(reviewing.taskId, "subtask-abc");

  const done = deriveDocumentGovernance(
    { kind: "dev_task", isArchivePath: false, taskKey: "task-key", frontmatter: { task_id: "subtask-abc", status: "done" }, parseStatus: "success" },
    ctx(DEV_TASK_INFO)
  );
  assert.equal(done.tier, "历史");
  assert.equal(done.entityStatus, "done");

  // 无 status 时 entityStatus 回落 current_node
  const nodeOnly = deriveDocumentGovernance(
    { kind: "dev_task", isArchivePath: false, taskKey: "task-key", frontmatter: { current_node: "implementation" }, parseStatus: "success" },
    ctx(DEV_TASK_INFO)
  );
  assert.equal(nodeOnly.entityStatus, "implementation");

  // task_id 缺失 → taskId 回落 taskKey
  const fallback = deriveDocumentGovernance(
    { kind: "dev_task", isArchivePath: false, taskKey: "task-key", frontmatter: { status: "reviewing" }, parseStatus: "success" },
    ctx(DEV_TASK_INFO)
  );
  assert.equal(fallback.taskId, "task-key");
});

test("governance · adr/unknown/archive/parseError 分支", () => {
  const adrInfo = { hasStatus: true, followsEntity: null };
  const superseded = deriveDocumentGovernance(
    { kind: "adr", isArchivePath: false, taskKey: "adr", frontmatter: { status: "superseded" }, parseStatus: "success" },
    ctx(adrInfo)
  );
  assert.equal(superseded.tier, "历史");

  const accepted = deriveDocumentGovernance(
    { kind: "adr", isArchivePath: false, taskKey: "adr", frontmatter: { status: "accepted" }, parseStatus: "success" },
    ctx(adrInfo)
  );
  assert.equal(accepted.tier, "生效中");

  // 未知 doc type(docTypeInfo=null)→ tier 生效中、entityStatus null、taskId null
  const unknown = deriveDocumentGovernance(
    { kind: "lessons", isArchivePath: false, taskKey: "x", frontmatter: { status: "whatever" }, parseStatus: "success" },
    ctx(null)
  );
  assert.equal(unknown.tier, "生效中");
  assert.equal(unknown.entityStatus, null);
  assert.equal(unknown.taskId, null);

  // isArchivePath 覆盖一切 kind → 归档
  const archived = deriveDocumentGovernance(
    { kind: "requirement", isArchivePath: true, taskKey: "r", frontmatter: { status: "delivering" }, parseStatus: "success" },
    ctx(REQUIREMENT_INFO)
  );
  assert.equal(archived.tier, "归档");

  // parseError 健康标志由 parseStatus 派生(不暴露原文)
  const broken = deriveDocumentGovernance(
    { kind: "requirement", isArchivePath: false, taskKey: "r", frontmatter: {}, parseStatus: "parse_error" },
    ctx(REQUIREMENT_INFO)
  );
  assert.equal(broken.healthFlags.parseError, true);
  assert.equal(
    deriveDocumentGovernance(
      { kind: "requirement", isArchivePath: false, taskKey: "r", frontmatter: {}, parseStatus: "success" },
      ctx(REQUIREMENT_INFO)
    ).healthFlags.parseError,
    false
  );
});

test("governance · 命名归一:requirement_id→requirementId(trim/空→null)、task_id 仅 dev_task", () => {
  assert.equal(normalizeRequirementId({ requirement_id: "  req-x  " }), "req-x");
  assert.equal(normalizeRequirementId({ requirement_id: "" }), null);
  assert.equal(normalizeRequirementId({}), null);

  assert.equal(normalizeTaskId("dev_task", { task_id: "subtask-1" }, "tk"), "subtask-1");
  assert.equal(normalizeTaskId("dev_task", {}, "tk"), "tk");
  assert.equal(normalizeTaskId("dev_task", {}, null), null);
  assert.equal(normalizeTaskId("requirement", { task_id: "subtask-1" }, "tk"), null);
});

// ---------------- buildDocumentMapEntries · characterization(document-map 输出语义不变) ----------------

function makeDoc(input: Partial<ParsedDocumentRecord> & Pick<ParsedDocumentRecord, "path" | "kind">): ParsedDocumentRecord {
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

test("buildDocumentMapEntries · characterization:tier 排序 + task_id fallback + parseStatus 透传 + null 字段保留", () => {
  const resolver = getDocsStructureResolver();
  const generatedAt = "2026-05-29T00:00:00.000Z";

  const docs: ParsedDocumentRecord[] = [
    makeDoc({
      path: "docs/02_需求设计/req-a-需求.md",
      kind: "requirement",
      title: "需求 A",
      frontmatter: { id: "req-a", status: "delivering", updated: "2026-05-10" }
    }),
    makeDoc({
      path: "docs/03_开发计划/td-a-技术设计.md",
      kind: "technical_design",
      title: "技术设计 A",
      frontmatter: { requirement_id: "req-a" }
    }),
    makeDoc({
      path: "docs/03_开发计划/task-1-开发任务.md",
      kind: "dev_task",
      title: "任务 1",
      taskKey: "task-1",
      frontmatter: { task_id: "subtask-aaa", status: "reviewing", requirement_id: "req-a" }
    }),
    makeDoc({
      path: "docs/03_开发计划/task-2-开发任务.md",
      kind: "dev_task",
      title: "任务 2(无 task_id,回落 taskKey)",
      taskKey: "task-2",
      frontmatter: { status: "done" } // done → 历史
    }),
    makeDoc({
      path: "docs/03_开发计划/task-broken-开发任务.md",
      kind: "dev_task",
      title: "解析异常任务",
      taskKey: "task-broken",
      parseStatus: "parse_error",
      frontmatter: { task_id: "subtask-bad", updated: "not-a-date" } // 非法 updated → 回落 mtime
    })
  ];

  const entries = buildDocumentMapEntries(docs, generatedAt, resolver);

  // 排序:生效中 在 历史 之前,同档按 path 升序
  const tierRank = (t: string) => ["生效中", "历史", "归档"].indexOf(t);
  for (let i = 1; i < entries.length; i += 1) {
    const prev = entries[i - 1];
    const cur = entries[i];
    const delta = tierRank(prev.tier) - tierRank(cur.tier);
    assert.ok(delta < 0 || (delta === 0 && prev.path.localeCompare(cur.path) <= 0), `排序不变量在 index ${i} 失败`);
  }

  const byPath = new Map(entries.map((e) => [e.path, e]));

  // requirement:tier 生效中、entityStatus=自身 status、updatedAt 取 frontmatter.updated
  const reqEntry = byPath.get("docs/02_需求设计/req-a-需求.md");
  assert.ok(reqEntry);
  assert.equal(reqEntry?.tier, "生效中");
  assert.equal(reqEntry?.entityStatus, "delivering");
  assert.equal(reqEntry?.task_id, null);
  assert.equal(reqEntry?.requirementId, null);
  assert.equal(reqEntry?.updatedAt, new Date("2026-05-10").toISOString());

  // technical_design:绑定 req-a(delivering)→ 生效中、entityStatus=delivering、updatedAt 回落 mtime
  const tdEntry = byPath.get("docs/03_开发计划/td-a-技术设计.md");
  assert.equal(tdEntry?.tier, "生效中");
  assert.equal(tdEntry?.entityStatus, "delivering");
  assert.equal(tdEntry?.requirementId, "req-a");
  assert.equal(tdEntry?.task_id, null);
  assert.equal(tdEntry?.updatedAt, new Date("2026-05-01T00:00:00.000Z").toISOString());

  // dev_task reviewing:生效中、task_id 用 frontmatter.task_id
  const t1 = byPath.get("docs/03_开发计划/task-1-开发任务.md");
  assert.equal(t1?.tier, "生效中");
  assert.equal(t1?.entityStatus, "reviewing");
  assert.equal(t1?.task_id, "subtask-aaa");
  assert.equal(t1?.requirementId, "req-a");

  // dev_task done 且无 task_id:历史、task_id 回落 taskKey
  const t2 = byPath.get("docs/03_开发计划/task-2-开发任务.md");
  assert.equal(t2?.tier, "历史");
  assert.equal(t2?.entityStatus, "done");
  assert.equal(t2?.task_id, "task-2");

  // parse_error 文档:parseStatus 原样透传,非法 updated 回落 mtime
  const broken = byPath.get("docs/03_开发计划/task-broken-开发任务.md");
  assert.equal(broken?.parseStatus, "parse_error");
  assert.equal(broken?.updatedAt, new Date("2026-05-01T00:00:00.000Z").toISOString());

  // dev_task_paths_by_task_id:按 task_id 聚合 dev_task 路径
  const pathIndex = buildDevTaskPathIndex(entries);
  assert.deepEqual(pathIndex["subtask-aaa"], ["docs/03_开发计划/task-1-开发任务.md"]);
  assert.deepEqual(pathIndex["task-2"], ["docs/03_开发计划/task-2-开发任务.md"]);
  assert.deepEqual(pathIndex["subtask-bad"], ["docs/03_开发计划/task-broken-开发任务.md"]);
});
