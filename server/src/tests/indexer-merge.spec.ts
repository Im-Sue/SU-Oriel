import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, test, vi } from "vitest";

import { prisma } from "../db/prisma.js";
import {
  deriveScanPhase,
  deriveTasks,
  scanProject,
  withProjectionRetry,
  type DeriveTaskDocument
} from "../indexer/project-indexer.js";
import { rollupAllRequirementsForProject } from "../modules/requirement/requirement-status-rollup.js";

vi.setConfig({ testTimeout: 15000, hookTimeout: 15000 });

async function resetDatabase(): Promise<void> {
  await prisma.reviewIntent.deleteMany();
  await prisma.taskWorkspace.deleteMany();
  await prisma.taskRun.deleteMany(); await prisma.eventJournal.deleteMany();
  await prisma.nodeRun.deleteMany();
  await prisma.syncJob.deleteMany();
  await prisma.requirement.deleteMany();
  await prisma.task.deleteMany();
  await prisma.document.deleteMany();
  await prisma.project.deleteMany();
}

afterAll(async () => {
  await prisma.$disconnect();
});

function makeDoc(input: Partial<DeriveTaskDocument> & Pick<DeriveTaskDocument, "id" | "kind" | "path">): DeriveTaskDocument {
  return {
    taskKey: input.path.split("/").pop()?.replace(/\.md$/, "") ?? null,
    title: "Untitled",
    status: null,
    summary: null,
    contentHash: "h",
    frontmatterJson: null,
    ...input
  };
}

async function createScanLifecycleFixtureProject(prefix: string): Promise<{ projectId: string; root: string }> {
  const root = join(tmpdir(), `${prefix}-${randomUUID()}`);
  const requirementRoot = join(root, "docs", "02_需求设计");
  await mkdir(requirementRoot, { recursive: true });
  await writeFile(
    join(requirementRoot, "scan-lifecycle-需求.md"),
    [
      "---",
      "doc_type: requirement",
      "id: req-scan-lifecycle",
      "title: Scan Lifecycle Requirement",
      "status: drafting",
      "---",
      "",
      "## 需求描述",
      "验证 scanProject lifecycle。",
      ""
    ].join("\n"),
    "utf8"
  );
  const project = await prisma.project.create({
    data: {
      name: `${prefix}-${randomUUID()}`,
      localPath: root
    }
  });
  return { projectId: project.id, root };
}

// ---------------- 单元测试：deriveTasks 纯函数 ----------------

test("deriveTasks · case A — dev_task 是唯一任务真相，旧 state kind 被忽略", () => {
  const docs: DeriveTaskDocument[] = [
    makeDoc({
      id: "spec1",
      kind: "dev_task",
      path: "docs/03_开发计划/2026-04-27-ccb-bugfix-开发任务.md",
      taskKey: "2026-04-27-ccb-bugfix",
      frontmatterJson: JSON.stringify({
        task_id: "ccb-bugfix",
        current_node: "implementation",
        status: "reviewing"
      })
    })
  ];

  const result = deriveTasks(docs);

  assert.equal(result.tasks.length, 1, "应合并为单个 task");
  assert.equal(result.tasks[0].taskKey, "2026-04-27-ccb-bugfix");
  assert.equal(result.tasks[0].currentNode, "implementation", "currentNode 应来自 dev_task frontmatter");
  assert.equal(result.tasks[0].runtimeState, null);
});

test("withProjectionRetry retries transient DB projection failures", async () => {
  let attempts = 0;
  const result = await withProjectionRetry(
    async () => {
      attempts += 1;
      if (attempts < 3) {
        throw new Error("SQLITE_BUSY");
      }
      return "ok";
    },
    { maxAttempts: 3, delaysMs: [1, 1] }
  );

  assert.equal(result, "ok");
  assert.equal(attempts, 3);
});

test("scanProject · keeps scanning until requirement_rollup succeeds", async () => {
  await resetDatabase();
  const { projectId } = await createScanLifecycleFixtureProject("ccb-scan-lifecycle-success");
  let observedDuringRollup: { syncStatus: string; lastScanAt: Date | null; initStatus: string; docsRoot: string | null } | null =
    null;

  await scanProject(prisma, projectId, {
    rollupAllRequirementsForProject: async (client, currentProjectId) => {
      observedDuringRollup = await client.project.findUniqueOrThrow({
        where: {
          id: currentProjectId
        },
        select: {
          syncStatus: true,
          lastScanAt: true,
          initStatus: true,
          docsRoot: true
        }
      });
      return await rollupAllRequirementsForProject(client, currentProjectId);
    }
  });

  assert.deepEqual(observedDuringRollup, {
    syncStatus: "scanning",
    lastScanAt: null,
    initStatus: "initialized",
    docsRoot: "docs"
  });

  const project = await prisma.project.findUniqueOrThrow({
    where: {
      id: projectId
    },
    select: {
      syncStatus: true,
      lastScanAt: true
    }
  });
  assert.equal(project.syncStatus, "idle");
  assert.equal(project.lastScanAt instanceof Date, true);

  const jobs = await prisma.syncJob.findMany({
    where: {
      projectId
    },
    orderBy: [{ startedAt: "asc" }, { createdAt: "asc" }]
  });
  const jobTypes = jobs.map((job) => job.jobType);
  assert.equal(jobTypes.includes("requirement_rollup"), true);
  assert.equal(jobTypes.indexOf("requirement_rollup") > jobTypes.indexOf("breakdown_draft_sync"), true);
  const rollupJob = jobs.find((job) => job.jobType === "requirement_rollup");
  assert.equal(rollupJob?.status, "success");
});

test("scanProject · marks project failed when requirement_rollup fails without writing idle", async () => {
  await resetDatabase();
  const { projectId } = await createScanLifecycleFixtureProject("ccb-scan-lifecycle-rollup-failure");
  let observedDuringRollup: { syncStatus: string; lastScanAt: Date | null; initStatus: string; docsRoot: string | null } | null =
    null;

  await assert.rejects(
    async () =>
      await scanProject(prisma, projectId, {
        rollupAllRequirementsForProject: async (client, currentProjectId) => {
          observedDuringRollup = await client.project.findUniqueOrThrow({
            where: {
              id: currentProjectId
            },
            select: {
              syncStatus: true,
              lastScanAt: true,
              initStatus: true,
              docsRoot: true
            }
          });
          throw new Error("rollup failed for test");
        }
      }),
    /rollup failed for test/
  );

  assert.deepEqual(observedDuringRollup, {
    syncStatus: "scanning",
    lastScanAt: null,
    initStatus: "initialized",
    docsRoot: "docs"
  });

  const project = await prisma.project.findUniqueOrThrow({
    where: {
      id: projectId
    },
    select: {
      syncStatus: true,
      lastScanAt: true
    }
  });
  assert.equal(project.syncStatus, "failed");
  assert.equal(project.lastScanAt, null);

  const scanJob = await prisma.syncJob.findFirstOrThrow({
    where: {
      projectId,
      jobType: "scan"
    }
  });
  assert.equal(scanJob.status, "success");

  const rollupJob = await prisma.syncJob.findFirstOrThrow({
    where: {
      projectId,
      jobType: "requirement_rollup"
    }
  });
  assert.equal(rollupJob.status, "failed");
  assert.match(rollupJob.errorMessage ?? "", /rollup failed for test/);

  const phase = await deriveScanPhase(prisma, projectId);
  assert.deepEqual(phase, {
    phase: "requirement_rollup",
    phaseStatus: "failed",
    phaseJobId: rollupJob.id,
    phaseErrorMessage: "rollup failed for test"
  });
});

test("deriveTasks · case C — docs/03 dev_task 无 state、无 status → 默认 reviewing", () => {
  const docs: DeriveTaskDocument[] = [
    makeDoc({
      id: "spec1",
      kind: "dev_task",
      path: "docs/03_开发计划/2026-04-28-ccb-feature-开发任务.md",
      taskKey: "2026-04-28-ccb-feature",
      frontmatterJson: JSON.stringify({ spec_id: "ccb-feature", title: "Some feature" })
    })
  ];

  const result = deriveTasks(docs);

  assert.equal(result.tasks.length, 1);
  assert.equal(result.tasks[0].status, "reviewing");
  assert.equal(result.tasks[0].currentNode, null);
  assert.equal(result.tasks[0].runtimeState, null);
});

test("deriveTasks · legacy task status read-compat normalizes to canonical lifecycle values", () => {
  for (const legacyStatus of ["planning", "dispatch_ready", "dispatched", "implementing", "active"]) {
    const result = deriveTasks([
      makeDoc({
        id: `legacy-${legacyStatus}`,
        kind: "dev_task",
        path: `docs/03_开发计划/${legacyStatus}-开发任务.md`,
        taskKey: `subtask-${legacyStatus}`,
        status: legacyStatus,
        frontmatterJson: JSON.stringify({
          task_id: `subtask-${legacyStatus}`,
          current_node: "dispatch"
        })
      })
    ]);

    assert.equal(result.tasks.length, 1);
    assert.equal(result.tasks[0].status, "reviewing");
  }

  for (const canonicalStatus of ["done", "cancelled"]) {
    const result = deriveTasks([
      makeDoc({
        id: `canonical-${canonicalStatus}`,
        kind: "dev_task",
        path: `docs/03_开发计划/${canonicalStatus}-开发任务.md`,
        taskKey: `subtask-${canonicalStatus}`,
        status: canonicalStatus,
        frontmatterJson: JSON.stringify({
          task_id: `subtask-${canonicalStatus}`,
          current_node: canonicalStatus === "done" ? "archive" : "dispatch"
        })
      })
    ]);

    assert.equal(result.tasks.length, 1);
    assert.equal(result.tasks[0].status, canonicalStatus);
  }
});

test("deriveTasks · legacy plan/task docs are not task truth sources", () => {
  const docs: DeriveTaskDocument[] = [
    makeDoc({
      id: "legacy-plan",
      kind: "plan",
      path: "docs/.ccb/plans/active/legacy.md",
      taskKey: "legacy",
      status: "active"
    }),
    makeDoc({
      id: "legacy-task",
      kind: "task",
      path: "docs/.ccb/tasks/active/legacy.md",
      taskKey: "legacy",
      status: "active"
    })
  ];

  const result = deriveTasks(docs);

  assert.equal(result.tasks.length, 0);
  assert.equal(result.anomalies.length, 0);
});

test("scanProject · ignores requirement assets markdown files", async () => {
  await resetDatabase();
  const root = join(tmpdir(), `ccb-indexer-assets-${randomUUID()}`);
  const ccbDocsRoot = join(root, "docs", ".ccb");
  const requirementRoot = join(root, "docs", "02_需求设计");
  await mkdir(join(ccbDocsRoot, "assets", "requirements", "tmp-1"), { recursive: true });
  await mkdir(requirementRoot, { recursive: true });
  await writeFile(join(ccbDocsRoot, "assets", "requirements", "tmp-1", "readme.md"), "# asset note\n", "utf8");
  await writeFile(
    join(requirementRoot, "req-assets-需求.md"),
    [
      "---",
      "doc_type: requirement",
      "id: req-assets",
      "title: Asset Safe Requirement",
      "status: drafting",
      "---",
      "",
      "## 需求描述",
      "正文",
      ""
    ].join("\n"),
    "utf8"
  );
  const project = await prisma.project.create({
    data: {
      name: `indexer-assets-${randomUUID()}`,
      localPath: root
    }
  });

  await scanProject(prisma, project.id);

  assert.equal(await prisma.document.count({ where: { projectId: project.id, path: { contains: "/assets/" } } }), 0);
  assert.equal(await prisma.requirement.count({ where: { projectId: project.id } }), 1);
});

test("scanProject · ignores v0 legacy archive markdown files", async () => {
  await resetDatabase();
  const root = join(tmpdir(), `ccb-indexer-v0-archive-${randomUUID()}`);
  const archiveRoot = join(root, "docs", "05_经验沉淀", "v0-legacy-archive");
  await mkdir(join(archiveRoot, "tasks"), { recursive: true });
  await writeFile(
    join(archiveRoot, "tasks", "task-bug-e-anchor-lifecycle-ccbd-launcher-启动机制修复-mmxafx.md"),
    [
      "---",
      "task_id: task-bug-e-anchor-lifecycle-ccbd-launcher-启动机制修复-mmxafx",
      "requirement_id: cmp9dh3lf04t3qrn9y5mmxafx",
      "title: Legacy Task",
      "status: active",
      "kind: task",
      "---",
      "",
      "# Legacy Task",
      ""
    ].join("\n"),
    "utf8"
  );
  const project = await prisma.project.create({
    data: {
      name: `indexer-v0-archive-${randomUUID()}`,
      localPath: root
    }
  });

  const result = await scanProject(prisma, project.id);

  assert.equal(result.documentCount, 0);
  assert.equal(result.taskCount, 0);
  assert.equal(await prisma.document.count({ where: { projectId: project.id } }), 0);
  assert.equal(await prisma.task.count({ where: { projectId: project.id } }), 0);
});

test("scanProject · generates document map and index cache from human docs contract", async () => {
  await resetDatabase();
  const root = join(tmpdir(), `ccb-indexer-doc-map-${randomUUID()}`);
  await mkdir(join(root, "docs", "02_需求设计"), { recursive: true });
  await mkdir(join(root, "docs", "03_开发计划"), { recursive: true });
  const requirementId = "req-doc-map";
  await writeFile(
    join(root, "docs", "02_需求设计", "doc-map-需求.md"),
    [
      "---",
      `id: ${requirementId}`,
      "title: Doc Map Requirement",
      "status: delivered",
      "created: 2026-05-27T10:00:00.000Z",
      "---",
      "",
      "## 需求描述",
      "",
      "Generate the derived document map from human docs.",
      ""
    ].join("\n"),
    "utf8"
  );
  await writeFile(
    join(root, "docs", "03_开发计划", "doc-map-技术设计.md"),
    [
      "---",
      "doc_type: technical_design",
      `requirement_id: ${requirementId}`,
      "title: Doc Map Technical Design",
      "---",
      "",
      "# Doc Map Technical Design",
      ""
    ].join("\n"),
    "utf8"
  );
  await writeFile(
    join(root, "docs", "02_需求设计", "_模板_需求.md"),
    [
      "---",
      "doc_type: requirement",
      "title: Template Requirement",
      "status: drafting",
      "---",
      "",
      "# Template Requirement",
      ""
    ].join("\n"),
    "utf8"
  );
  const project = await prisma.project.create({
    data: {
      name: `indexer-doc-map-${randomUUID()}`,
      localPath: root
    }
  });

  await scanProject(prisma, project.id);

  const requirementDocument = await prisma.document.findUniqueOrThrow({
    where: {
      projectId_path: {
        projectId: project.id,
        path: "docs/02_需求设计/doc-map-需求.md"
      }
    }
  });
  assert.equal(requirementDocument.kind, "requirement");
  assert.equal(await prisma.requirement.count({ where: { projectId: project.id, id: requirementId } }), 1);

  const docMap = await readFile(join(root, "docs", "00_文档地图.md"), "utf8");
  assert.match(docMap, /doc_type: doc_map/);
  assert.match(docMap, /docs\/02_需求设计\/doc-map-需求\.md/);
  assert.match(docMap, /docs\/03_开发计划\/doc-map-技术设计\.md/);
  assert.doesNotMatch(docMap, /_模板_需求\.md/);
  assert.match(docMap, /## 历史/);

  const cache = JSON.parse(await readFile(join(root, "docs", ".ccb", "index", "document-map.json"), "utf8")) as {
    documents: Array<{ path: string; docType: string; tier: string; entityStatus: string | null }>;
  };
  assert.equal(
    await prisma.document.count({
      where: {
        projectId: project.id,
        path: "docs/02_需求设计/_模板_需求.md"
      }
    }),
    0
  );
  assert.deepEqual(
    cache.documents.map((entry) => ({
      path: entry.path,
      docType: entry.docType,
      tier: entry.tier,
      entityStatus: entry.entityStatus
    })),
    [
      {
        path: "docs/02_需求设计/doc-map-需求.md",
        docType: "requirement",
        tier: "历史",
        entityStatus: "delivered"
      },
      {
        path: "docs/03_开发计划/doc-map-技术设计.md",
        docType: "technical_design",
        tier: "历史",
        entityStatus: "delivered"
      }
    ]
  );

  await assert.rejects(readFile(join(root, "docs", ".catalog.yaml"), "utf8"));
  await assert.rejects(readFile(join(root, "docs", ".ccb", "index", "architecture.yaml"), "utf8"));
  await assert.rejects(readFile(join(root, "docs", ".ccb", "index", "modules.yaml"), "utf8"));
  await assert.rejects(readFile(join(root, "docs", ".ccb", "index", "decisions.yaml"), "utf8"));
});

test("scanProject · follows project docs structure contract directory mappings", async () => {
  await resetDatabase();
  const root = join(tmpdir(), `ccb-indexer-contract-paths-${randomUUID()}`);
  await mkdir(join(root, "docs", ".ccb"), { recursive: true });
  await mkdir(join(root, "knowledge", "reqs"), { recursive: true });
  await mkdir(join(root, "knowledge", "designs"), { recursive: true });
  const requirementId = "req-contract-paths";
  await writeFile(
    join(root, "docs", ".ccb", "docs-structure-contract.yaml"),
    [
      "version: docs-structure-contract-v0.1",
      "human_docs:",
      "  root: knowledge/",
      "  naming_default: \"<模块/主题>-<文档类型>.md\"",
      "  entries:",
      "    - path: \"map.md\"",
      "      doc_type: doc_map",
      "      maintained_by: generated",
      "    - path: \"reqs/\"",
      "      doc_type: requirement",
      "    - path: \"designs/\"",
      "      doc_type: technical_design",
      "    - path: \"tasks/\"",
      "      doc_type: dev_task",
      "    - path: \"archive/\"",
      "      doc_type: archive_index",
      "  view_split:",
      "    integrated_views: [requirement, technical_design, dev_task]",
      "machine_layer:",
      "  root: docs/.ccb/",
      "documents:",
      "  requirement_bound:",
      "    doc_types: [technical_design, dev_task]",
      "    must_have: [doc_type, requirement_id]",
      "    status: entity_or_follows_requirement",
      "    follows: requirement",
      "entity_status:",
      "  requirement:",
      "    doc_types: [requirement]",
      "    kind: requirement_lifecycle",
      "    fields: [status]",
      "    values: [drafting, delivered]",
      "    source: kernel",
      ""
    ].join("\n"),
    "utf8"
  );
  await writeFile(
    join(root, "knowledge", "reqs", "contract-paths-需求.md"),
    [
      "---",
      `id: ${requirementId}`,
      "title: Contract Paths Requirement",
      "status: delivered",
      "created: 2026-05-28T10:00:00.000Z",
      "---",
      "",
      "## 需求描述",
      "",
      "Indexer should use the project contract instead of fixed docs directories.",
      ""
    ].join("\n"),
    "utf8"
  );
  await writeFile(
    join(root, "knowledge", "designs", "contract-paths-技术设计.md"),
    [
      "---",
      "doc_type: technical_design",
      `requirement_id: ${requirementId}`,
      "title: Contract Paths Technical Design",
      "---",
      "",
      "# Contract Paths Technical Design",
      "",
      "The design path comes from the project docs structure contract.",
      ""
    ].join("\n"),
    "utf8"
  );
  const project = await prisma.project.create({
    data: {
      name: `indexer-contract-paths-${randomUUID()}`,
      localPath: root
    }
  });

  await scanProject(prisma, project.id);

  const savedProject = await prisma.project.findUniqueOrThrow({ where: { id: project.id } });
  assert.equal(savedProject.docsRoot, "knowledge");
  const requirementDocument = await prisma.document.findUniqueOrThrow({
    where: {
      projectId_path: {
        projectId: project.id,
        path: "knowledge/reqs/contract-paths-需求.md"
      }
    }
  });
  assert.equal(requirementDocument.kind, "requirement");
  const requirement = await prisma.requirement.findUniqueOrThrow({ where: { id: requirementId } });
  assert.equal(requirement.planDocPath, "knowledge/designs/contract-paths-技术设计.md");

  const docMap = await readFile(join(root, "knowledge", "map.md"), "utf8");
  assert.match(docMap, /knowledge\/reqs\/contract-paths-需求\.md/);
  assert.match(docMap, /knowledge\/designs\/contract-paths-技术设计\.md/);
  await assert.rejects(readFile(join(root, "docs", "00_文档地图.md"), "utf8"));
});

test("scanProject · missing Requirement FK in task projection is nulled", async () => {
  await resetDatabase();
  const root = join(tmpdir(), `ccb-indexer-task-missing-req-${randomUUID()}`);
  const docsRoot = join(root, "docs", "03_开发计划");
  await mkdir(docsRoot, { recursive: true });
  await writeFile(
    join(docsRoot, "subtask-missing-req-开发任务.md"),
    [
      "---",
      "doc_type: dev_task",
      "task_id: subtask-missing-req",
      "title: Missing Requirement SubTask",
      "status: reviewing",
      "current_node: dispatch",
      "node_substate: awaiting_codex_pickup",
      "priority: high",
      "requirement_id: missing-requirement",
      "section_id: pr1-missing-req",
      "order: 1",
      "implementation_owner: ccb_codex",
      "dependencies: []",
      "source_breakdown_draft: docs/.ccb/drafts/breakdown/missing-requirement.json",
      `source_draft_hash: ${"a".repeat(64)}`,
      "created_at: 2026-05-29T10:00:00.000Z",
      "---",
      "",
      "# Missing Requirement SubTask",
      "",
      "- Project this dev_task but drop its missing requirement FK.",
      ""
    ].join("\n"),
    "utf8"
  );
  const project = await prisma.project.create({
    data: {
      name: `indexer-task-missing-req-${randomUUID()}`,
      localPath: root
    }
  });

  await scanProject(prisma, project.id);

  const task = await prisma.task.findUniqueOrThrow({
    where: {
      projectId_taskKey: {
        projectId: project.id,
        taskKey: "subtask-missing-req"
      }
    }
  });
  assert.equal(task.requirementId, null);
});

test("scanProject · projects materialized dev_task frontmatter into Task fields", async () => {
  await resetDatabase();
  const root = join(tmpdir(), `ccb-indexer-subtask-${randomUUID()}`);
  const docsRoot = join(root, "docs", "03_开发计划");
  await mkdir(docsRoot, { recursive: true });
  const project = await prisma.project.create({
    data: {
      name: `indexer-subtask-${randomUUID()}`,
      localPath: root
    }
  });
  const requirement = await prisma.requirement.create({
    data: {
      id: "req-indexer-subtask",
      projectId: project.id,
      title: "Indexer Subtask Requirement",
      description: "Need a materialized subtask projection.",
      status: "delivering"
    }
  });
  await writeFile(
    join(docsRoot, "subtask-abcdef123456-开发任务.md"),
    [
      "---",
      "doc_type: dev_task",
      "task_id: subtask-abcdef123456",
      "title: Materialized SubTask",
      "status: reviewing",
      "current_node: dispatch",
      "node_substate: awaiting_codex_pickup",
      "priority: high",
      `requirement_id: ${requirement.id}`,
      "section_id: pr1-runtime-contract",
      "order: 1",
      "implementation_owner: ccb_codex",
      "dependencies: []",
      "source_breakdown_draft: docs/.ccb/drafts/breakdown/req-indexer-subtask.json",
      `source_draft_hash: ${"a".repeat(64)}`,
      "created_at: 2026-05-22T10:00:00.000Z",
      "---",
      "",
      "## Runtime Contract",
      "",
      "- Implement the materialized subtask contract.",
      "- Keep the projected task ready for dispatch.",
      ""
    ].join("\n"),
    "utf8"
  );

  await scanProject(prisma, project.id);

  const task = await prisma.task.findUniqueOrThrow({
    where: {
      projectId_taskKey: {
        projectId: project.id,
        taskKey: "subtask-abcdef123456"
      }
    }
  });
  assert.equal(task.requirementId, requirement.id);
  assert.equal(task.specSectionId, "pr1-runtime-contract");
  assert.equal(task.implementationOwner, "ccb_codex");
  assert.equal(task.currentNode, "dispatch");
  assert.equal(task.nodeSubstate, "awaiting_codex_pickup");
  assert.equal(task.priority, "high");
});

test("scanProject · clean DB first scan links dev_task docs to requirement md", async () => {
  await resetDatabase();
  const root = join(tmpdir(), `ccb-indexer-clean-first-scan-${randomUUID()}`);
  const requirementRoot = join(root, "docs", "02_需求设计");
  const devTaskRoot = join(root, "docs", "03_开发计划");
  await mkdir(requirementRoot, { recursive: true });
  await mkdir(devTaskRoot, { recursive: true });
  const requirementId = "req-clean-first-scan";
  await writeFile(
    join(requirementRoot, "clean-first-scan-需求.md"),
    [
      "---",
      "doc_type: requirement",
      `id: ${requirementId}`,
      "title: Clean First Scan Requirement",
      "created: 2026-05-25T10:00:00.000Z",
      "---",
      "",
      "## 需求描述",
      "",
      "Need subtask projection to keep its requirement FK on the first scan.",
      ""
    ].join("\n"),
    "utf8"
  );
  await writeFile(
    join(devTaskRoot, "subtask-c1ea123456ab-开发任务.md"),
    [
      "---",
      "doc_type: dev_task",
      "task_id: subtask-c1ea123456ab",
      "title: Clean First Scan SubTask",
      "status: reviewing",
      "current_node: dispatch",
      "node_substate: awaiting_codex_pickup",
      "priority: high",
      `requirement_id: ${requirementId}`,
      "section_id: pr1-clean-first-scan",
      "order: 1",
      "implementation_owner: ccb_codex",
      "dependencies: []",
      "source_breakdown_draft: docs/.ccb/drafts/breakdown/req-clean-first-scan.json",
      `source_draft_hash: ${"a".repeat(64)}`,
      "created_at: 2026-05-25T10:05:00.000Z",
      "---",
      "",
      "## Clean First Scan SubTask",
      "",
      "- Project this subtask after syncing the requirement markdown.",
      "- Keep the requirement foreign key attached on a clean database.",
      ""
    ].join("\n"),
    "utf8"
  );
  const project = await prisma.project.create({
    data: {
      name: `indexer-clean-first-scan-${randomUUID()}`,
      localPath: root
    }
  });

  await scanProject(prisma, project.id);

  const requirement = await prisma.requirement.findUniqueOrThrow({ where: { id: requirementId } });
  const task = await prisma.task.findUniqueOrThrow({
    where: {
      projectId_taskKey: {
        projectId: project.id,
        taskKey: "subtask-c1ea123456ab"
      }
    }
  });
  assert.equal(requirement.projectId, project.id);
  assert.equal(task.requirementId, requirementId);
  assert.equal(await prisma.task.count({ where: { projectId: project.id, requirementId } }), 1);
  assert.equal(
    await prisma.task.count({ where: { projectId: project.id, taskKey: "sp-clean-first-scan-analysis" } }),
    0
  );
});

test("scanProject · dev_task frontmatter is task truth", async () => {
  await resetDatabase();
  const root = join(tmpdir(), `ccb-indexer-task-state-${randomUUID()}`);
  const devTaskRoot = join(root, "docs", "03_开发计划");
  await mkdir(devTaskRoot, { recursive: true });
  const project = await prisma.project.create({
    data: {
      name: `indexer-task-state-${randomUUID()}`,
      localPath: root
    }
  });
  const requirement = await prisma.requirement.create({
    data: {
      id: "req-indexer-state",
      projectId: project.id,
      title: "Indexer State Requirement",
      description: "Need state override projection.",
      status: "delivering"
    }
  });
  await writeFile(
    join(devTaskRoot, "subtask-123456abcdef-开发任务.md"),
    [
      "---",
      "doc_type: dev_task",
      "task_id: subtask-123456abcdef",
      "title: Initial SubTask",
      "status: reviewing",
      "current_node: dispatch",
      "node_substate: awaiting_codex_pickup",
      "priority: high",
      `requirement_id: ${requirement.id}`,
      "section_id: pr1-state-override",
      "order: 1",
      "implementation_owner: ccb_codex",
      "dependencies: []",
      "source_breakdown_draft: docs/.ccb/drafts/breakdown/req-indexer-state.json",
      `source_draft_hash: ${"a".repeat(64)}`,
      "created_at: 2026-05-22T10:00:00.000Z",
      "---",
      "",
      "## Initial SubTask",
      "",
      "- Spec keeps initial fields only.",
      "- dev_task frontmatter is the canonical projection source.",
      ""
    ].join("\n"),
    "utf8"
  );

  await scanProject(prisma, project.id);

  const task = await prisma.task.findUniqueOrThrow({
    where: {
      projectId_taskKey: {
        projectId: project.id,
        taskKey: "subtask-123456abcdef"
      }
    }
  });
  assert.equal(task.status, "reviewing");
  assert.equal(task.currentNode, "dispatch");
  assert.equal(task.nodeSubstate, "awaiting_codex_pickup");
});

test("scanProject · invalid dev_task is partial and does not create Task projection", async () => {
  await resetDatabase();
  const root = join(tmpdir(), `ccb-indexer-invalid-subtask-${randomUUID()}`);
  const docsRoot = join(root, "docs", "03_开发计划");
  await mkdir(docsRoot, { recursive: true });
  const project = await prisma.project.create({
    data: {
      name: `indexer-invalid-subtask-${randomUUID()}`,
      localPath: root
    }
  });

  await writeFile(
    join(docsRoot, "subtask-invalid-开发任务.md"),
    [
      "---",
      "doc_type: dev_task",
      "task_id: subtask-invalid",
      "title: Invalid SubTask",
      "status: active",
      "current_node: dispatch",
      "node_substate: awaiting_codex_pickup",
      "priority: high",
      "requirement_id: req-indexer-subtask",
      "section_id: wrong-section",
      "order: 1",
      "implementation_owner: auto",
      "dependencies: []",
      "source_breakdown_draft: docs/.ccb/drafts/breakdown/req-indexer-subtask.json",
      `source_draft_hash: ${"a".repeat(64)}`,
      "created_at: 2026-05-22T10:00:00.000Z",
      "---",
      "",
      "## Invalid Contract",
      "",
      "- This bad dev_task must not be projected.",
      ""
    ].join("\n"),
    "utf8"
  );

  await scanProject(prisma, project.id);

  assert.equal(
    await prisma.task.count({
      where: {
        projectId: project.id,
        taskKey: "subtask-invalid"
      }
    }),
    0
  );

  const document = await prisma.document.findUniqueOrThrow({
    where: {
      projectId_path: {
        projectId: project.id,
        path: "docs/03_开发计划/subtask-invalid-开发任务.md"
      }
    }
  });
  assert.equal(document.parseStatus, "partial");
  assert.match(document.parseError ?? "", /implementation_owner/);
  assert.match(document.parseError ?? "", /section_id/);

  const parseJob = await prisma.syncJob.findFirstOrThrow({
    where: {
      projectId: project.id,
      jobType: "parse"
    }
  });
  assert.equal(parseJob.status, "partial");
  assert.match(parseJob.errorMessage ?? "", /subtask-invalid/);
});

test("scanProject · terminal dev_task projects from pure dev_task frontmatter", async () => {
  await resetDatabase();
  const root = join(tmpdir(), `ccb-indexer-projectable-partial-${randomUUID()}`);
  const docsRoot = join(root, "docs", "03_开发计划");
  await mkdir(docsRoot, { recursive: true });
  const project = await prisma.project.create({
    data: {
      name: `indexer-projectable-partial-${randomUUID()}`,
      localPath: root
    }
  });

  await writeFile(
    join(docsRoot, "subtask-abcdef123456-开发任务.md"),
    [
      "---",
      "doc_type: dev_task",
      "task_id: subtask-abcdef123456",
      "title: Terminal Dev Task",
      "status: done",
      "current_node: archive",
      "node_substate: archived",
      "priority: high",
      "requirement_id: req-indexer-subtask",
      "section_id: pr1-projectable-partial",
      "order: 1",
      "implementation_owner: ccb_codex",
      "dependencies: []",
      "source_breakdown_draft: docs/.ccb/drafts/breakdown/req-indexer-subtask.json",
      `source_draft_hash: ${"a".repeat(64)}`,
      "created_at: 2026-05-22T10:00:00.000Z",
      "---",
      "",
      "## Terminal Dev Task",
      "",
      "- This terminal dev_task is a valid docs-driven task truth source.",
      "- It must project without any partial-document compatibility path.",
      ""
    ].join("\n"),
    "utf8"
  );

  await scanProject(prisma, project.id);

  const task = await prisma.task.findUniqueOrThrow({
    where: {
      projectId_taskKey: {
        projectId: project.id,
        taskKey: "subtask-abcdef123456"
      }
    }
  });
  assert.equal(task.status, "done");
  assert.equal(task.currentNode, "archive");
  assert.equal(task.nodeSubstate, "archived");
  const cache = JSON.parse(await readFile(join(root, "docs", ".ccb", "index", "document-map.json"), "utf8")) as {
    dev_task_paths_by_task_id: Record<string, string[]>;
    documents: Array<{ path: string; docType: string; task_id: string | null }>;
  };
  const cacheEntry = cache.documents.find((entry) => entry.path === "docs/03_开发计划/subtask-abcdef123456-开发任务.md");
  assert.equal(cacheEntry?.docType, "dev_task");
  assert.equal(cacheEntry?.task_id, "subtask-abcdef123456");
  assert.deepEqual(cache.dev_task_paths_by_task_id["subtask-abcdef123456"], [
    "docs/03_开发计划/subtask-abcdef123456-开发任务.md"
  ]);

  const reconcileJob = await prisma.syncJob.findFirstOrThrow({
    where: {
      projectId: project.id,
      jobType: "reconcile"
    }
  });
  assert.equal(reconcileJob.status, "success");
});

test("scanProject · partial with frontmatter syntax issue remains excluded from Task projection", async () => {
  await resetDatabase();
  const root = join(tmpdir(), `ccb-indexer-frontmatter-partial-${randomUUID()}`);
  const docsRoot = join(root, "docs", "03_开发计划");
  await mkdir(docsRoot, { recursive: true });
  const project = await prisma.project.create({
    data: {
      name: `indexer-frontmatter-partial-${randomUUID()}`,
      localPath: root
    }
  });

  await writeFile(
    join(docsRoot, "subtask-badbad123456-开发任务.md"),
    [
      "---",
      "doc_type: dev_task",
      "task_id: subtask-badbad123456",
      "title: Bad Frontmatter Partial",
      "status: done",
      "current_node: archive",
      "node_substate: archived",
      "priority: high",
      "requirement_id: req-indexer-subtask",
      "section_id: pr1-bad-frontmatter",
      "order: 1",
      "implementation_owner: ccb_codex",
      "dependencies: []",
      "source_breakdown_draft: docs/.ccb/drafts/breakdown/req-indexer-subtask.json",
      `source_draft_hash: ${"a".repeat(64)}`,
      "created_at: 2026-05-22T10:00:00.000Z",
      "this line is malformed",
      "---",
      "",
      "## Bad Frontmatter Partial",
      "",
      "- This document has a frontmatter syntax issue and must not be projected.",
      ""
    ].join("\n"),
    "utf8"
  );

  await scanProject(prisma, project.id);

  assert.equal(
    await prisma.task.count({
      where: {
        projectId: project.id,
        taskKey: "subtask-badbad123456"
      }
    }),
    0
  );
});

test("scanProject · malformed frontmatter is parse_error and does not create Task projection", async () => {
  await resetDatabase();
  const root = join(tmpdir(), `ccb-indexer-malformed-frontmatter-${randomUUID()}`);
  const docsRoot = join(root, "docs", "03_开发计划");
  await mkdir(docsRoot, { recursive: true });
  const project = await prisma.project.create({
    data: {
      name: `indexer-malformed-frontmatter-${randomUUID()}`,
      localPath: root
    }
  });

  await writeFile(
    join(docsRoot, "subtask-bad-frontmatter-开发任务.md"),
    [
      "---",
      "doc_type: dev_task",
      "task_id: subtask-bad-frontmatter",
      "title: Bad Frontmatter",
      "",
      "# Missing closing delimiter",
      ""
    ].join("\n"),
    "utf8"
  );

  await scanProject(prisma, project.id);

  assert.equal(
    await prisma.task.count({
      where: {
        projectId: project.id,
        taskKey: "subtask-bad-frontmatter"
      }
    }),
    0
  );

  const document = await prisma.document.findUniqueOrThrow({
    where: {
      projectId_path: {
        projectId: project.id,
        path: "docs/03_开发计划/subtask-bad-frontmatter-开发任务.md"
      }
    }
  });
  assert.equal(document.parseStatus, "parse_error");
  assert.match(document.parseError ?? "", /frontmatter/i);
});

test("deriveTasks · case D — dev_task filename slug 一致 → 现有行为不变", () => {
  const docs: DeriveTaskDocument[] = [
    makeDoc({
      id: "spec1",
      kind: "dev_task",
      path: "docs/03_开发计划/user-login-开发任务.md",
      taskKey: "user-login",
      frontmatterJson: JSON.stringify({ task_id: "task-user-login", current_node: "implementation" })
    })
  ];

  const result = deriveTasks(docs);

  assert.equal(result.tasks.length, 1);
  assert.equal(result.tasks[0].taskKey, "user-login");
  assert.equal(result.tasks[0].currentNode, "implementation");
});

test("deriveTasks · task_key takeover — dev_task task_key 去日期前缀", () => {
  const docs: DeriveTaskDocument[] = [
    makeDoc({
      id: "spec1",
      kind: "dev_task",
      path: "docs/03_开发计划/2026-05-12-st1-rich-config-slot-schema-开发任务.md",
      taskKey: "st1-rich-config-slot-schema",
      frontmatterJson: JSON.stringify({
        task_key: "st1-rich-config-slot-schema",
        title: "ST1",
        current_node: "archive"
      })
    })
  ];

  const result = deriveTasks(docs);

  assert.equal(result.tasks.length, 1);
  assert.equal(result.tasks[0].taskKey, "st1-rich-config-slot-schema");
  assert.equal(result.tasks[0].currentNode, "archive");
});

test("deriveTasks · task_id takeover — dev_task task_id 去日期前缀", () => {
  const docs: DeriveTaskDocument[] = [
    makeDoc({
      id: "spec1",
      kind: "dev_task",
      path: "docs/03_开发计划/2026-05-03-e12-5-t4-module-doc-开发任务.md",
      taskKey: "e12-5-t4-module-doc",
      frontmatterJson: JSON.stringify({
        task_id: "e12-5-t4-module-doc",
        title: "E12.5-T4",
        current_node: "archive"
      })
    })
  ];

  const result = deriveTasks(docs);

  assert.equal(result.tasks.length, 1);
  assert.equal(result.tasks[0].taskKey, "e12-5-t4-module-doc");
  assert.equal(result.tasks[0].currentNode, "archive");
});

test("deriveTasks · legacy active dev_task currentNode=backlog → invalid_current_node anomaly and no task projection", () => {
  const docs: DeriveTaskDocument[] = [
    makeDoc({
      id: "dev-task-backlog",
      kind: "dev_task",
      path: "docs/03_开发计划/2026-05-15-backlog-spec-开发任务.md",
      taskKey: "2026-05-15-backlog-spec",
      frontmatterJson: JSON.stringify({
        task_id: "2026-05-15-backlog-spec",
        currentNode: "backlog",
        status: "active"
      })
    })
  ];

  const result = deriveTasks(docs);

  assert.equal(result.tasks.length, 0);
  assert.equal(result.anomalies.length, 1);
  assert.equal(result.anomalies[0].category, "invalid_current_node");
  assert.deepEqual(result.anomalies[0].detail, {
    observedValue: "backlog",
    path: "docs/03_开发计划/2026-05-15-backlog-spec-开发任务.md"
  });
});

test("deriveTasks · legacy active dev_task unknown currentNode → invalid_current_node anomaly and no task projection", () => {
  const docs: DeriveTaskDocument[] = [
    makeDoc({
      id: "dev-task-unknown-node",
      kind: "dev_task",
      path: "docs/03_开发计划/2026-05-15-unknown-node-spec-开发任务.md",
      taskKey: "2026-05-15-unknown-node-spec",
      frontmatterJson: JSON.stringify({
        task_id: "2026-05-15-unknown-node-spec",
        currentNode: "parking_lot",
        status: "active"
      })
    })
  ];

  const result = deriveTasks(docs);

  assert.equal(result.tasks.length, 0);
  assert.equal(result.anomalies.length, 1);
  assert.equal(result.anomalies[0].category, "invalid_current_node");
  assert.equal(result.anomalies[0].detail.observedValue, "parking_lot");
});

test("deriveTasks · legacy active dev_task legal currentNode → status normalized to reviewing", () => {
  const docs: DeriveTaskDocument[] = [
    makeDoc({
      id: "dev-task-legal-node",
      kind: "dev_task",
      path: "docs/03_开发计划/2026-05-15-legal-node-spec-开发任务.md",
      taskKey: "2026-05-15-legal-node-spec",
      frontmatterJson: JSON.stringify({
        task_id: "2026-05-15-legal-node-spec",
        currentNode: "implementation",
        status: "active"
      })
    })
  ];

  const result = deriveTasks(docs);

  assert.equal(result.tasks.length, 1);
  assert.equal(result.tasks[0].currentNode, "implementation");
  assert.equal(result.tasks[0].status, "reviewing");
  assert.equal(result.anomalies.length, 0);
});

test("deriveTasks · dev_task human doc projects as task body", () => {
  const docs: DeriveTaskDocument[] = [
    makeDoc({
      id: "dev-task-doc",
      kind: "dev_task",
      path: "docs/03_开发计划/checkout-a1b2c3-开发任务.md",
      taskKey: "subtask-a1b2c3d4e5f6",
      title: "Checkout Dev Task",
      status: "reviewing",
      frontmatterJson: JSON.stringify({
        task_id: "subtask-a1b2c3d4e5f6",
        doc_type: "dev_task",
        status: "reviewing",
        current_node: "dispatch",
        node_substate: "awaiting_codex_pickup",
        priority: "high",
        requirement_id: "req-checkout",
        section_id: "pr1-checkout",
        implementation_owner: "ccb_codex"
      })
    })
  ];

  const result = deriveTasks(docs);

  assert.equal(result.tasks.length, 1);
  assert.equal(result.tasks[0].taskKey, "subtask-a1b2c3d4e5f6");
  assert.equal(result.tasks[0].currentNode, "dispatch");
  assert.equal(result.tasks[0].nodeSubstate, "awaiting_codex_pickup");
  assert.equal(result.tasks[0].requirementId, "req-checkout");
  assert.equal(result.tasks[0].specSectionId, "pr1-checkout");
  assert.equal(result.tasks[0].implementationOwner, "ccb_codex");
  assert.equal(result.tasks[0].primaryDocumentId, "dev-task-doc");
  assert.equal(result.anomalies.length, 0);
});

test("deriveTasks · case F — dev_task task_id/spec_id 不再与旧 state 文档合并", () => {
  const docs: DeriveTaskDocument[] = [
    makeDoc({
      id: "dev-task1",
      kind: "dev_task",
      path: "docs/03_开发计划/2026-04-27-ccb-thing-开发任务.md",
      taskKey: "2026-04-27-ccb-thing",
      frontmatterJson: JSON.stringify({
        task_id: "ccb-thing-A",
        spec_id: "ccb-thing-B"
      })
    })
  ];

  const result = deriveTasks(docs);

  assert.equal(result.tasks.length, 1);
  assert.equal(result.tasks[0].taskKey, "2026-04-27-ccb-thing");
  assert.equal(result.anomalies.some((a) => a.category === "id_conflict"), false);
});

// ---------------- 集成测试：scanProject + dev_task projection ----------------

async function createMergeFixture(): Promise<string> {
  const projectRoot = join(tmpdir(), `ccb-merge-fixture-${Date.now()}-${randomUUID()}`);
  const ccbDocsRoot = join(projectRoot, "docs", ".ccb");
  const devTaskRoot = join(projectRoot, "docs", "03_开发计划");

  await mkdir(devTaskRoot, { recursive: true });
  await mkdir(ccbDocsRoot, { recursive: true });

  await writeFile(
    join(devTaskRoot, "2026-04-27-ccb-bugfix-开发任务.md"),
    `---
doc_type: dev_task
spec_id: ccb-bugfix
task_key: 2026-04-27-ccb-bugfix
task_id: ccb-bugfix
title: Bugfix Spec
status: reviewing
current_node: dispatch
node_substate: awaiting_codex_pickup
priority: medium
requirement_id: req-merge
section_id: pr1-merge
order: 1
implementation_owner: ccb_codex
dependencies: []
source_breakdown_draft: docs/.ccb/drafts/breakdown/req-merge.json
source_draft_hash: ${"a".repeat(64)}
created_at: 2026-05-28T10:00:00.000Z
---

# Bugfix

- Valid dev_task used for identity merge coverage.
`,
    "utf8"
  );

  return projectRoot;
}

test("scanProject · projects plugin EventJournal JSONL into Console EventJournal DB", async () => {
  await resetDatabase();
  const root = join(tmpdir(), `ccb-indexer-plugin-journal-${randomUUID()}`);
  await mkdir(join(root, "docs", ".ccb", "events"), { recursive: true });
  await writeFile(
    join(root, "docs", ".ccb", "events", "journal.jsonl"),
    [
      JSON.stringify({
        type: "breakdown_draft_updated",
        subject_type: "requirement",
        subject_id: "req-plugin-journal",
        payload: {
          requirement_id: "req-plugin-journal",
          path: "docs/.ccb/drafts/breakdown/req-plugin-journal.json"
        },
        idempotency_key: "plugin-journal-test-1",
        emitted_at: "2026-05-22T10:00:00.000Z",
        source_actor: "ccb_claude"
      }),
      ""
    ].join("\n"),
    "utf8"
  );
  const project = await prisma.project.create({
    data: {
      name: `indexer-plugin-journal-${randomUUID()}`,
      localPath: root
    }
  });

  await scanProject(prisma, project.id);
  await scanProject(prisma, project.id);

  const events = await prisma.eventJournal.findMany({
    where: {
      projectId: project.id,
      eventType: "breakdown_draft_updated"
    }
  });
  assert.equal(events.length, 1);
  assert.equal(events[0].subjectType, "requirement");
  assert.equal(events[0].subjectId, "req-plugin-journal");
  assert.equal(events[0].sourceComponent, "ccb-claude-plugin");
  assert.equal(events[0].idempotencyKey, "plugin-journal-test-1");
  assert.deepEqual(JSON.parse(events[0].payloadJson), {
    requirement_id: "req-plugin-journal",
    path: "docs/.ccb/drafts/breakdown/req-plugin-journal.json"
  });
});

test("scanProject · projects plugin slot_stale and joins SlotBinding slotId when available", async () => {
  await resetDatabase();
  const root = join(tmpdir(), `ccb-indexer-slot-stale-${randomUUID()}`);
  await mkdir(join(root, "docs", ".ccb", "events"), { recursive: true });
  const project = await prisma.project.create({
    data: {
      name: `indexer-slot-stale-${randomUUID()}`,
      localPath: root
    }
  });
  const boundRequirement = await prisma.requirement.create({
    data: {
      id: "req-slot-stale-bound",
      projectId: project.id,
      title: "Bound slot stale",
      description: "Bound requirement",
      status: "planning"
    }
  });
  await prisma.requirement.create({
    data: {
      id: "req-slot-stale-unbound",
      projectId: project.id,
      title: "Unbound slot stale",
      description: "Unbound requirement",
      status: "planning"
    }
  });
  await prisma.slotBinding.create({
    data: {
      projectId: project.id,
      slotId: "slot-3",
      requirementId: boundRequirement.id,
      state: "bound",
      boundAt: new Date("2026-05-02T00:00:00.000Z"),
      lastActivityAt: new Date("2026-05-01T00:00:00.000Z")
    }
  });
  await writeFile(
    join(root, "docs", ".ccb", "events", "journal.jsonl"),
    [
      JSON.stringify({
        type: "slot_stale",
        subject_type: "requirement",
        subject_id: "req-slot-stale-bound",
        payload: {
          requirementId: "req-slot-stale-bound",
          lastActivityAt: "2026-05-01T00:00:00.000Z",
          staleDays: 9,
          policyVersion: "slot-stale-policy-v1"
        },
        idempotency_key: "slot-health:slot_stale:req-slot-stale-bound:2026-05-01T00:00:00.000Z:slot-stale-policy-v1",
        emitted_at: "2026-05-10T00:00:00.000Z",
        source_actor: "ccb_claude"
      }),
      JSON.stringify({
        type: "slot_stale",
        subject_type: "requirement",
        subject_id: "req-slot-stale-unbound",
        payload: {
          requirementId: "req-slot-stale-unbound",
          lastActivityAt: "2026-05-01T00:00:00.000Z",
          staleDays: 9,
          policyVersion: "slot-stale-policy-v1"
        },
        idempotency_key: "slot-health:slot_stale:req-slot-stale-unbound:2026-05-01T00:00:00.000Z:slot-stale-policy-v1",
        emitted_at: "2026-05-10T00:00:00.000Z",
        source_actor: "ccb_claude"
      }),
      ""
    ].join("\n"),
    "utf8"
  );

  await scanProject(prisma, project.id);

  const events = await prisma.eventJournal.findMany({
    where: {
      projectId: project.id,
      eventType: "slot_stale"
    },
    orderBy: {
      subjectId: "asc"
    }
  });
  assert.equal(events.length, 2);
  assert.equal(events[0].subjectId, "req-slot-stale-bound");
  assert.equal(events[0].anchorId, "slot-3");
  assert.equal(events[1].subjectId, "req-slot-stale-unbound");
  assert.equal(events[1].anchorId, null);
});
