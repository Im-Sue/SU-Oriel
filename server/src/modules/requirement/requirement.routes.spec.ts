import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeEach, test, vi } from "vitest";

import { buildApp } from "../../app.js";
import { prisma } from "../../db/prisma.js";
import { scanProject } from "../../indexer/project-indexer.js";
import { PrismaProjectStore } from "../project/project.store.prisma.js";

async function resetDatabase(): Promise<void> {
  await prisma.syncJob.deleteMany();
  await prisma.anchorAllocation.deleteMany();
  await prisma.$executeRawUnsafe('DELETE FROM "RequirementEditAudit"').catch(() => undefined);
  await prisma.requirement.deleteMany();
  await prisma.task.deleteMany();
  await prisma.document.deleteMany();
  await prisma.project.deleteMany();
}

afterAll(async () => {
  await prisma.$disconnect();
});

beforeEach(async () => {
  await resetDatabase();
});

async function createProjectFixture(name: string) {
  const localPath = join(tmpdir(), `ccb-req-routes-${randomUUID()}`);
  const project = await prisma.project.create({
    data: {
      name,
      localPath,
      initStatus: "initialized",
      docsRoot: "docs"
    }
  });
  return { project, localPath };
}

async function findRequirementMarkdown(projectRoot: string): Promise<string> {
  const dir = join(projectRoot, "docs", "02_需求设计");
  const files = await readdir(dir);
  const file = files.find((item) => item.endsWith(".md"));
  assert.ok(file, "expected requirement markdown to exist");
  return join(dir, file);
}

async function readHash(filePath: string): Promise<string> {
  return createHash("sha256").update(await readFile(filePath, "utf8"), "utf8").digest("hex");
}

function analysisHash(title: string, description: string): string {
  return createHash("sha256").update(`${title}${description}`, "utf8").digest("hex");
}

function buildMultipartPayload(file: Buffer, mimeType: string, filename: string) {
  const boundary = `----ccb-${randomUUID()}`;
  const head = Buffer.from(
    [
      `--${boundary}`,
      `Content-Disposition: form-data; name="file"; filename="${filename}"`,
      `Content-Type: ${mimeType}`,
      "",
      ""
    ].join("\r\n"),
    "utf8"
  );
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`, "utf8");
  return {
    headers: {
      "content-type": `multipart/form-data; boundary=${boundary}`
    },
    payload: Buffer.concat([head, file, tail])
  };
}

function buildRequirementRoutesApp(options: {
  dispatcher?: {
    submit: ReturnType<typeof vi.fn>;
    getStatus: ReturnType<typeof vi.fn>;
  };
  reindexRequirementScope?: ReturnType<typeof vi.fn>;
} = {}) {
  return buildApp({
    projectStore: new PrismaProjectStore(prisma),
    enableFileWatcher: false,
    requirementReanalyze: {
      ...(options.dispatcher ? { dispatcher: options.dispatcher } : {}),
      ...(options.reindexRequirementScope ? { reindexRequirementScope: options.reindexRequirementScope } : {})
    }
  } as unknown as Parameters<typeof buildApp>[0]);
}

test("POST /api/projects/:projectId/requirements accepts legacy create fields and returns compatibility constants", async () => {
  const app = buildApp({
    projectStore: new PrismaProjectStore(prisma),
    enableFileWatcher: false
  });
  const { project, localPath } = await createProjectFixture("Requirement routes split mode");

  const response = await app.inject({
    method: "POST",
    url: `/api/projects/${project.id}/requirements`,
    payload: {
      title: "Epic split route test",
      description: "创建需求时固定为 direct_pr；多 PR 拆分由需求详情页规划流程决定。",
      outputMode: "requirement_only",
      splitMode: "direct_pr",
      source_task_id: "legacy-source-task"
    }
  });

  assert.equal(response.statusCode, 201, response.body);
  assert.equal(response.json().outputMode, "requirement_only");
  assert.equal(response.json().splitMode, "direct_pr");
  assert.equal(response.json().sourceTaskId, null);
  const stored = await prisma.requirement.findUniqueOrThrow({
    where: { id: response.json().id as string }
  });
  assert.equal(stored.title, "Epic split route test");

  await app.close();
  await rm(localPath, { recursive: true, force: true });
});

test("POST /api/projects/:projectId/requirements creates drafting Requirement planning carrier fields", async () => {
  const app = buildApp({
    projectStore: new PrismaProjectStore(prisma),
    enableFileWatcher: false
  });
  const { project, localPath } = await createProjectFixture("Requirement planning carrier");

  const response = await app.inject({
    method: "POST",
    url: `/api/projects/${project.id}/requirements`,
    payload: {
      title: "Planning carrier requirement",
      description: "创建后直接进入需求详情页触发 AI 分析。",
      outputMode: "requirement_only"
    }
  });

  assert.equal(response.statusCode, 201, response.body);
  assert.equal(response.json().status, "drafting");
  assert.equal(response.json().currentPlanningStep, "analysis");
  assert.equal(response.json().planningRuntimeState, "idle");
  assert.equal(response.json().rollupProgress, 0);

  const stored = await prisma.requirement.findUniqueOrThrow({
    where: { id: response.json().id as string }
  });
  assert.equal(stored.status, "drafting");
  assert.equal(stored.currentPlanningStep, "analysis");
  assert.equal(stored.planningRuntimeState, "idle");

  await app.close();
  await rm(localPath, { recursive: true, force: true });
});

test("POST requirement assets uploads image into tmp requirement asset directory", async () => {
  const app = buildApp({
    projectStore: new PrismaProjectStore(prisma),
    enableFileWatcher: false
  });
  const { project, localPath } = await createProjectFixture("Requirement asset upload");
  const owner = `tmp-${randomUUID()}`;
  const file = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
  const expectedHash = createHash("sha256").update(file).digest("hex");
  const multipart = buildMultipartPayload(file, "image/png", "paste.png");

  const response = await app.inject({
    method: "POST",
    url: `/api/projects/${project.id}/requirements/${owner}/assets`,
    headers: multipart.headers,
    payload: multipart.payload
  });

  assert.equal(response.statusCode, 201, response.body);
  assert.equal(response.json().path, `./assets/requirements/${owner}/${expectedHash}.png`);
  assert.deepEqual(
    await readFile(join(localPath, "docs", ".ccb", "assets", "requirements", owner, `${expectedHash}.png`)),
    file
  );

  await app.close();
  await rm(localPath, { recursive: true, force: true });
});

test("POST requirement assets rejects unsupported MIME and oversized files", async () => {
  const app = buildApp({
    projectStore: new PrismaProjectStore(prisma),
    enableFileWatcher: false
  });
  const { project, localPath } = await createProjectFixture("Requirement asset validation");
  const owner = `tmp-${randomUUID()}`;
  const invalid = buildMultipartPayload(Buffer.from("not image"), "text/plain", "note.txt");

  const invalidResponse = await app.inject({
    method: "POST",
    url: `/api/projects/${project.id}/requirements/${owner}/assets`,
    headers: invalid.headers,
    payload: invalid.payload
  });
  assert.equal(invalidResponse.statusCode, 400, invalidResponse.body);
  assert.match(invalidResponse.json().message, /图片格式/);

  const oversized = buildMultipartPayload(Buffer.alloc(5 * 1024 * 1024 + 1), "image/png", "large.png");
  const oversizedResponse = await app.inject({
    method: "POST",
    url: `/api/projects/${project.id}/requirements/${owner}/assets`,
    headers: oversized.headers,
    payload: oversized.payload
  });
  assert.equal(oversizedResponse.statusCode, 400, oversizedResponse.body);
  assert.match(oversizedResponse.json().message, /5MB/);

  await app.close();
  await rm(localPath, { recursive: true, force: true });
});

test("POST requirement finalizes tmp image paths to requirement id after create", async () => {
  const app = buildApp({
    projectStore: new PrismaProjectStore(prisma),
    enableFileWatcher: false
  });
  const { project, localPath } = await createProjectFixture("Requirement asset finalize");
  const tmpUuid = randomUUID();
  const owner = `tmp-${tmpUuid}`;
  const file = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x01]);
  const expectedHash = createHash("sha256").update(file).digest("hex");
  const multipart = buildMultipartPayload(file, "image/png", "paste.png");
  const uploaded = await app.inject({
    method: "POST",
    url: `/api/projects/${project.id}/requirements/${owner}/assets`,
    headers: multipart.headers,
    payload: multipart.payload
  });
  assert.equal(uploaded.statusCode, 201, uploaded.body);
  const tmpPath = uploaded.json().path as string;

  const response = await app.inject({
    method: "POST",
    url: `/api/projects/${project.id}/requirements`,
    payload: {
      title: "带图需求",
      description: `这里有截图\n\n![](${tmpPath})`,
      outputMode: "requirement_only",
      splitMode: "direct_pr",
      asset_tmp_uuid: tmpUuid
    }
  });

  assert.equal(response.statusCode, 201, response.body);
  const requirementId = response.json().id as string;
  const finalPath = `./assets/requirements/${requirementId}/${expectedHash}.png`;
  assert.equal(response.json().description, `这里有截图\n\n![](${finalPath})`);
  assert.equal(existsSync(join(localPath, "docs", ".ccb", "assets", "requirements", owner)), false);
  assert.equal(existsSync(join(localPath, "docs", ".ccb", "assets", "requirements", requirementId, `${expectedHash}.png`)), true);

  const mdPath = await findRequirementMarkdown(localPath);
  const md = await readFile(mdPath, "utf8");
  assert.match(md, new RegExp(finalPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.doesNotMatch(md, /tmp-/);

  await app.close();
  await rm(localPath, { recursive: true, force: true });
});

test("POST requirement keeps tmp assets when create validation fails", async () => {
  const app = buildApp({
    projectStore: new PrismaProjectStore(prisma),
    enableFileWatcher: false
  });
  const { project, localPath } = await createProjectFixture("Requirement asset failed create");
  const tmpUuid = randomUUID();
  const owner = `tmp-${tmpUuid}`;
  const file = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
  const multipart = buildMultipartPayload(file, "image/png", "paste.png");
  const uploaded = await app.inject({
    method: "POST",
    url: `/api/projects/${project.id}/requirements/${owner}/assets`,
    headers: multipart.headers,
    payload: multipart.payload
  });
  assert.equal(uploaded.statusCode, 201, uploaded.body);

  const response = await app.inject({
    method: "POST",
    url: `/api/projects/${project.id}/requirements`,
    payload: {
      title: "",
      description: `![](${uploaded.json().path as string})`,
      outputMode: "requirement_only",
      asset_tmp_uuid: tmpUuid
    }
  });

  assert.equal(response.statusCode, 400, response.body);
  assert.equal(existsSync(join(localPath, "docs", ".ccb", "assets", "requirements", owner)), true);

  await app.close();
  await rm(localPath, { recursive: true, force: true });
});

test("GET /api/projects/:projectId/requirements/:requirementId returns serialized requirement with mdHash", async () => {
  const app = buildApp({
    projectStore: new PrismaProjectStore(prisma),
    enableFileWatcher: false
  });
  const { project, localPath } = await createProjectFixture("Requirement detail GET");
  const created = await app.inject({
    method: "POST",
    url: `/api/projects/${project.id}/requirements`,
    payload: {
      title: "Detail target",
      description: "Some description.",
      outputMode: "requirement_only",
      splitMode: "direct_pr",
      verbatim_source: "raw"
    }
  });
  assert.equal(created.statusCode, 201, created.body);
  const requirementId = created.json().id as string;
  const mdPath = await findRequirementMarkdown(localPath);
  const expectedMdHash = await readHash(mdPath);

  const response = await app.inject({
    method: "GET",
    url: `/api/projects/${project.id}/requirements/${requirementId}`
  });

  assert.equal(response.statusCode, 200, response.body);
  const body = response.json();
  assert.equal(body.id, requirementId);
  assert.equal(body.title, "Detail target");
  assert.equal(body.mdHash, expectedMdHash);

  const missing = await app.inject({
    method: "GET",
    url: `/api/projects/${project.id}/requirements/req-does-not-exist`
  });
  assert.equal(missing.statusCode, 404);

  await app.close();
  await rm(localPath, { recursive: true, force: true });
});

test("PATCH /api/projects/:projectId/requirements/:requirementId edits md first, syncs DB, and writes audit", async () => {
  const app = buildApp({
    projectStore: new PrismaProjectStore(prisma),
    enableFileWatcher: false
  });
  const { project, localPath } = await createProjectFixture("Requirement edit route happy path");
  const created = await app.inject({
    method: "POST",
    url: `/api/projects/${project.id}/requirements`,
    payload: {
      title: "Editable requirement",
      description: "Original description.",
      outputMode: "requirement_only",
      splitMode: "direct_pr",
      verbatim_source: "Original verbatim",
      claude_interpretation: "Original interpretation"
    }
  });
  assert.equal(created.statusCode, 201, created.body);
  const requirementId = created.json().id as string;
  const mdPath = await findRequirementMarkdown(localPath);
  const expectedMdHash = await readHash(mdPath);

  const response = await app.inject({
    method: "PATCH",
    url: `/api/projects/${project.id}/requirements/${requirementId}`,
    headers: {
      "x-ccb-actor": "tester"
    },
    payload: {
      title: "Edited requirement",
      description: "Edited description.\n\nSecond paragraph.",
      changeReason: "clarify scope",
      expectedMdHash
    }
  });

  assert.equal(response.statusCode, 200, response.body);
  assert.equal(response.json().title, "Edited requirement");
  assert.equal(response.json().description, "Edited description.\n\nSecond paragraph.");

  const list = await app.inject({
    method: "GET",
    url: `/api/projects/${project.id}/requirements`
  });
  assert.equal(list.statusCode, 200, list.body);
  assert.equal(list.json().items[0].title, "Edited requirement");
  assert.equal(list.json().items[0].description, "Edited description.\n\nSecond paragraph.");

  const md = await readFile(mdPath, "utf8");
  assert.match(md, /title: Edited requirement/);
  assert.match(md, /## 需求描述\n\nEdited description\.\n\nSecond paragraph\./);
  assert.match(md, /## 原话（verbatim）\n\nOriginal verbatim/);
  assert.match(md, /## Claude 解读\n\nOriginal interpretation/);

  const auditRows = await prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(
    'SELECT "requirementId", "editor", "changeReason", "beforeTitle", "afterTitle", "beforeDescription", "afterDescription" FROM "RequirementEditAudit" WHERE "requirementId" = ?',
    requirementId
  );
  assert.equal(auditRows.length, 1);
  assert.equal(auditRows[0].editor, "tester");
  assert.equal(auditRows[0].changeReason, "clarify scope");
  assert.equal(auditRows[0].beforeTitle, "Editable requirement");
  assert.equal(auditRows[0].afterTitle, "Edited requirement");
  assert.equal(auditRows[0].beforeDescription, "Original description.");
  assert.equal(auditRows[0].afterDescription, "Edited description.\n\nSecond paragraph.");

  await scanProject(prisma, project.id);
  const rescanned = await prisma.requirement.findUniqueOrThrow({ where: { id: requirementId } });
  assert.equal(rescanned.title, "Edited requirement");
  assert.equal(rescanned.description, "Edited description.\n\nSecond paragraph.");

  await app.close();
  await rm(localPath, { recursive: true, force: true });
});

test("PATCH /api/projects/:projectId/requirements/:requirementId marks AI analysis stale and internal applied hook is removed", async () => {
  const app = buildRequirementRoutesApp();
  const { project, localPath } = await createProjectFixture("Requirement edit route stale hook");
  const created = await app.inject({
    method: "POST",
    url: `/api/projects/${project.id}/requirements`,
    payload: {
      title: "Stale hook requirement",
      description: "Original description.",
      outputMode: "requirement_only",
      claude_interpretation: "Old interpretation"
    }
  });
  assert.equal(created.statusCode, 201, created.body);
  const requirementId = created.json().id as string;
  await prisma.$executeRawUnsafe(
    'UPDATE "Requirement" SET "analysisInputHash" = ?, "analysisStaleAt" = NULL WHERE "id" = ?',
    analysisHash("Stale hook requirement", "Original description."),
    requirementId
  );
  const mdPath = await findRequirementMarkdown(localPath);

  const response = await app.inject({
    method: "PATCH",
    url: `/api/projects/${project.id}/requirements/${requirementId}`,
    payload: {
      description: "Changed description.",
      expectedMdHash: await readHash(mdPath)
    }
  });

  assert.equal(response.statusCode, 200, response.body);
  assert.equal(response.json().analysisInputHash, analysisHash("Stale hook requirement", "Original description."));
  assert.ok(response.json().analysisStaleAt, "expected response to expose stale timestamp");

  const rows = await prisma.$queryRawUnsafe<Array<{ analysisStaleAt: Date | string | null }>>(
    'SELECT "analysisStaleAt" FROM "Requirement" WHERE "id" = ?',
    requirementId
  );
  assert.ok(rows[0].analysisStaleAt, "expected DB stale timestamp to be set");

  const applied = await app.inject({
    method: "POST",
    url: `/api/internal/requirements/${requirementId}/reanalyze-applied`,
    payload: {
      projectRoot: localPath,
      analysisInputHash: analysisHash("Stale hook requirement", "Changed description.")
    }
  });
  assert.equal(applied.statusCode, 404, applied.body);

  await app.close();
  await rm(localPath, { recursive: true, force: true });
});

test("POST /api/projects/:projectId/requirements/:requirementId/reindex is browser-callable and returns scoped result", async () => {
  const reindexRequirementScope = vi.fn(async () => ({
    reindexed: true,
    deduped: false,
    status: "partial",
    projectId: "project-route",
    requirementId: "req-route-reindex",
    requirementMarkdown: null,
    designDocs: [],
    breakdownDraft: null,
    devTasks: {
      reindexed: true,
      requirementId: "req-route-reindex",
      documentCount: 1,
      taskCount: 1,
      orphanCount: 0,
      issues: []
    },
    issues: [{ path: "docs/03_开发计划/half.md", reason: "dev_task_parse_partial" }]
  }));
  const app = buildRequirementRoutesApp({ reindexRequirementScope });
  const { project, localPath } = await createProjectFixture("Requirement route reindex");

  const response = await app.inject({
    method: "POST",
    url: `/api/projects/${project.id}/requirements/req-route-reindex/reindex`,
    headers: {
      origin: "http://localhost:5173"
    }
  });

  assert.equal(response.statusCode, 200, response.body);
  assert.equal(response.json().status, "partial");
  assert.equal(response.json().issues[0].reason, "dev_task_parse_partial");
  assert.equal(reindexRequirementScope.mock.calls.length, 1);
  assert.equal(reindexRequirementScope.mock.calls[0][1], project.id);
  assert.equal(reindexRequirementScope.mock.calls[0][2], "req-route-reindex");

  await app.close();
  await rm(localPath, { recursive: true, force: true });
});

test("POST /api/projects/:projectId/requirements/:requirementId/reanalyze dispatches an anchor job", async () => {
  const dispatcher = {
    submit: vi.fn(async (_input: unknown) => ({ jobId: "job_reanalyze_1" })),
    getStatus: vi.fn()
  };
  const app = buildRequirementRoutesApp({ dispatcher });
  const { project, localPath } = await createProjectFixture("Requirement reanalyze anchor dispatch");
  const created = await app.inject({
    method: "POST",
    url: `/api/projects/${project.id}/requirements`,
    payload: {
      title: "Reanalyze requirement",
      description: "Description for AI.",
      outputMode: "requirement_only",
      claude_interpretation: "Old interpretation",
      ambiguities: "Old ambiguity",
      fidelity_diff: "Old diff"
    }
  });
  assert.equal(created.statusCode, 201, created.body);
  const requirementId = created.json().id as string;
  await prisma.anchorAllocation.create({
    data: {
      anchorId: "anchor-reanalyze",
      anchorPath: join(localPath, "..", "anchor-reanalyze"),
      projectId: project.id,
      socketPath: "/tmp/anchor-reanalyze.sock",
      subjectType: "requirement",
      subjectId: requirementId,
      subjectKey: "Reanalyze requirement",
      mode: "planning",
      state: "ready"
    }
  });

  const response = await app.inject({
    method: "POST",
    url: `/api/projects/${project.id}/requirements/${requirementId}/reanalyze`
  });

  assert.equal(response.statusCode, 202, response.body);
  assert.equal(response.json().job_id, "job_reanalyze_1");
  assert.equal(response.json().jobId, "job_reanalyze_1");
  assert.equal(response.json().status, "pending");
  assert.equal(response.json().anchorTaskId, requirementId);
  assert.equal(response.json().anchorId, "anchor-reanalyze");
  assert.equal(dispatcher.submit.mock.calls.length, 1);
  assert.deepEqual(dispatcher.submit.mock.calls[0][0], {
    anchorId: "anchor-reanalyze",
    anchorTaskId: requirementId,
    requirementId,
    projectRoot: localPath
  });

  await app.close();
  await rm(localPath, { recursive: true, force: true });
});

test("POST /api/projects/:projectId/requirements/:requirementId/reanalyze returns 503 when planning anchor is unavailable", async () => {
  const app = buildRequirementRoutesApp({
    dispatcher: {
      submit: vi.fn(),
      getStatus: vi.fn()
    }
  });
  const { project, localPath } = await createProjectFixture("Requirement reanalyze no anchor");
  const created = await app.inject({
    method: "POST",
    url: `/api/projects/${project.id}/requirements`,
    payload: {
      title: "Unmaterialized requirement",
      description: "Original description.",
      outputMode: "requirement_only"
    }
  });
  assert.equal(created.statusCode, 201, created.body);

  const response = await app.inject({
    method: "POST",
    url: `/api/projects/${project.id}/requirements/${created.json().id}/reanalyze`
  });

  assert.equal(response.statusCode, 503, response.body);
  assert.equal(response.json().code, "anchor_unavailable");
  assert.match(response.json().message, /anchor 不可达/);

  await app.close();
  await rm(localPath, { recursive: true, force: true });
});

test("POST /api/projects/:projectId/requirements/:requirementId/reanalyze returns 409 for locked status", async () => {
  const app = buildApp({
    projectStore: new PrismaProjectStore(prisma),
    enableFileWatcher: false
  });
  const { project, localPath } = await createProjectFixture("Requirement reanalyze locked status");
  const created = await app.inject({
    method: "POST",
    url: `/api/projects/${project.id}/requirements`,
    payload: {
      title: "Locked reanalyze requirement",
      description: "Original description.",
      outputMode: "requirement_only"
    }
  });
  assert.equal(created.statusCode, 201, created.body);
  await prisma.requirement.update({
    where: { id: created.json().id as string },
    data: { status: "delivered" }
  });

  const response = await app.inject({
    method: "POST",
    url: `/api/projects/${project.id}/requirements/${created.json().id}/reanalyze`
  });

  assert.equal(response.statusCode, 409, response.body);
  assert.match(response.json().message, /当前状态不允许重新解析/);

  await app.close();
  await rm(localPath, { recursive: true, force: true });
});

test("POST /api/projects/:projectId/requirements/:requirementId/reanalyze returns 503 when anchor is unavailable", async () => {
  const app = buildRequirementRoutesApp({
    dispatcher: {
      submit: vi.fn(),
      getStatus: vi.fn()
    }
  });
  const { project, localPath } = await createProjectFixture("Requirement reanalyze anchor unavailable");
  const created = await app.inject({
    method: "POST",
    url: `/api/projects/${project.id}/requirements`,
    payload: {
      title: "Unavailable reanalyze requirement",
      description: "Original description.",
      outputMode: "requirement_only"
    }
  });
  assert.equal(created.statusCode, 201, created.body);
  const response = await app.inject({
    method: "POST",
    url: `/api/projects/${project.id}/requirements/${created.json().id}/reanalyze`
  });

  assert.equal(response.statusCode, 503, response.body);
  assert.equal(response.json().code, "anchor_unavailable");
  assert.match(response.json().message, /anchor 不可达/);

  await app.close();
  await rm(localPath, { recursive: true, force: true });
});

test("GET /api/projects/:projectId/requirements/:requirementId/reanalyze-jobs/:jobId returns anchor job status", async () => {
  const dispatcher = {
    submit: vi.fn(),
    getStatus: vi.fn(async (_input: unknown) => ({ status: "running" }))
  };
  const app = buildRequirementRoutesApp({ dispatcher });
  const { project, localPath } = await createProjectFixture("Requirement reanalyze job status");
  const created = await app.inject({
    method: "POST",
    url: `/api/projects/${project.id}/requirements`,
    payload: {
      title: "Job status requirement",
      description: "Original description.",
      outputMode: "requirement_only"
    }
  });
  assert.equal(created.statusCode, 201, created.body);
  const requirementId = created.json().id as string;
  await prisma.anchorAllocation.create({
    data: {
      anchorId: "anchor-reanalyze-job",
      anchorPath: join(localPath, "..", "anchor-reanalyze-job"),
      projectId: project.id,
      socketPath: "/tmp/anchor-reanalyze-job.sock",
      subjectType: "requirement",
      subjectId: requirementId,
      subjectKey: "Job status requirement",
      mode: "planning",
      state: "busy"
    }
  });

  const response = await app.inject({
    method: "GET",
    url: `/api/projects/${project.id}/requirements/${requirementId}/reanalyze-jobs/job_reanalyze_1`
  });

  assert.equal(response.statusCode, 200, response.body);
  assert.deepEqual(response.json(), { status: "running" });
  assert.deepEqual(dispatcher.getStatus.mock.calls[0][0], {
    anchorId: "anchor-reanalyze-job",
    jobId: "job_reanalyze_1"
  });

  await app.close();
  await rm(localPath, { recursive: true, force: true });
});

test("PATCH /api/projects/:projectId/requirements/:requirementId rejects disabled fields", async () => {
  const app = buildApp({
    projectStore: new PrismaProjectStore(prisma),
    enableFileWatcher: false
  });
  const { project, localPath } = await createProjectFixture("Requirement edit route bad body");
  const created = await app.inject({
    method: "POST",
    url: `/api/projects/${project.id}/requirements`,
    payload: {
      title: "Editable requirement",
      description: "Original description.",
      outputMode: "requirement_only"
    }
  });
  const mdPath = await findRequirementMarkdown(localPath);

  const response = await app.inject({
    method: "PATCH",
    url: `/api/projects/${project.id}/requirements/${created.json().id}`,
    payload: {
      verbatimSource: "forbidden",
      expectedMdHash: await readHash(mdPath)
    }
  });

  assert.equal(response.statusCode, 400, response.body);
  assert.match(response.json().message, /需求编辑参数不合法/);

  await app.close();
  await rm(localPath, { recursive: true, force: true });
});

test("PATCH /api/projects/:projectId/requirements/:requirementId returns 404 for missing requirement", async () => {
  const app = buildApp({
    projectStore: new PrismaProjectStore(prisma),
    enableFileWatcher: false
  });
  const { project, localPath } = await createProjectFixture("Requirement edit route not found");

  const response = await app.inject({
    method: "PATCH",
    url: `/api/projects/${project.id}/requirements/missing-requirement`,
    payload: {
      title: "No target",
      expectedMdHash: "0".repeat(64)
    }
  });

  assert.equal(response.statusCode, 404, response.body);

  await app.close();
  await rm(localPath, { recursive: true, force: true });
});

test("PATCH /api/projects/:projectId/requirements/:requirementId returns 409 when status is locked", async () => {
  const app = buildApp({
    projectStore: new PrismaProjectStore(prisma),
    enableFileWatcher: false
  });
  const { project, localPath } = await createProjectFixture("Requirement edit route locked status");
  const created = await app.inject({
    method: "POST",
    url: `/api/projects/${project.id}/requirements`,
    payload: {
      title: "Locked requirement",
      description: "Original description.",
      outputMode: "requirement_only"
    }
  });
  const requirementId = created.json().id as string;
  await prisma.requirement.update({
    where: { id: requirementId },
    data: { status: "delivered" }
  });
  const mdPath = await findRequirementMarkdown(localPath);

  const response = await app.inject({
    method: "PATCH",
    url: `/api/projects/${project.id}/requirements/${requirementId}`,
    payload: {
      title: "Should not edit",
      expectedMdHash: await readHash(mdPath)
    }
  });

  assert.equal(response.statusCode, 409, response.body);
  assert.match(response.json().message, /当前状态不允许编辑/);

  await app.close();
  await rm(localPath, { recursive: true, force: true });
});

test("PATCH /api/projects/:projectId/requirements/:requirementId returns 409 on md hash conflict", async () => {
  const app = buildApp({
    projectStore: new PrismaProjectStore(prisma),
    enableFileWatcher: false
  });
  const { project, localPath } = await createProjectFixture("Requirement edit route hash conflict");
  const created = await app.inject({
    method: "POST",
    url: `/api/projects/${project.id}/requirements`,
    payload: {
      title: "Hash guarded requirement",
      description: "Original description.",
      outputMode: "requirement_only"
    }
  });

  const response = await app.inject({
    method: "PATCH",
    url: `/api/projects/${project.id}/requirements/${created.json().id}`,
    payload: {
      description: "Should conflict",
      expectedMdHash: "0".repeat(64)
    }
  });

  assert.equal(response.statusCode, 409, response.body);
  assert.match(response.json().message, /mdHash 冲突/);

  await app.close();
  await rm(localPath, { recursive: true, force: true });
});

test("POST generate-task returns 410 after SP-B15 removes 立项 carrier flow", async () => {
  const app = buildApp({
    projectStore: new PrismaProjectStore(prisma),
    enableFileWatcher: false
  });
  const localPath = join(tmpdir(), `ccb-req-routes-${randomUUID()}`);
  const project = await prisma.project.create({
    data: {
      name: "Requirement routes deprecated generate task",
      localPath,
      initStatus: "initialized",
      docsRoot: "docs"
    }
  });
  const requirement = await prisma.requirement.create({
    data: {
      projectId: project.id,
      title: "Conflicting requirement",
      description: "旧立项接口应被明确废弃。",
      source: "manual",
      status: "drafting",
      updatedAt: new Date()
    }
  });

  const response = await app.inject({
    method: "POST",
    url: `/api/projects/${project.id}/requirements/${requirement.id}/generate-task`,
    payload: {}
  });

  assert.equal(response.statusCode, 410, response.body);
  assert.match(response.json().message, /旧立项接口已废弃/);

  await app.close();
  await rm(localPath, { recursive: true, force: true });
});
