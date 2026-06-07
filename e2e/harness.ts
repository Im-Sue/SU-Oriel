import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { FastifyInstance } from "fastify";
import type { PrismaClient } from "@prisma/client";

import type { FakeProjectCcbd } from "../server/src/tests/fixtures/per-project-ccbd-sockets.js";

type BuildApp = typeof import("../server/src/app.js")["buildApp"];
type CcbdClientServiceCtor = typeof import("../server/src/modules/ccbd-client/ccbd-client.service.js")["CcbdClientService"];
type SlotContextResetServiceCtor = typeof import("../server/src/modules/slot-binding/slot-context-reset.service.js")["SlotContextResetService"];
type SlotResizeServiceCtor = typeof import("../server/src/modules/slot-resize/slot-resize.service.js")["SlotResizeService"];
type SlotResizeRuntime = import("../server/src/modules/slot-resize/slot-resize.service.js").SlotResizeRuntime;
type CcbReloadResult = import("../server/src/modules/slot-resize/reload-cli.js").CcbReloadResult;
type CreateFakeProjectCcbd = typeof import("../server/src/tests/fixtures/per-project-ccbd-sockets.js")["createFakeProjectCcbd"];
type CreateFakeTmuxRunner = typeof import("../server/src/tests/fixtures/per-project-ccbd-sockets.js")["createFakeTmuxRunner"];
type ProjectSlotTopology = typeof import("../server/src/modules/project-ccbd/managed-config.service.js")["projectSlotTopology"];
type RenderManagedCcbConfig = typeof import("../server/src/modules/project-ccbd/managed-config.service.js")["renderManagedCcbConfig"];

type ProjectFixture = {
  projectId: string;
  projectName: string;
  projectRoot: string;
  requirementId: string;
  requirementTitle: string;
  taskId: string;
  documentId: string;
};

type E2EFixtureState = {
  alpha: ProjectFixture;
  beta: ProjectFixture;
};

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const serverRoot = join(repoRoot, "server");
const host = "127.0.0.1";
const apiPort = Number.parseInt(process.env.CCB_E2E_API_PORT ?? "13030", 10);
const webPort = Number.parseInt(process.env.CCB_E2E_WEB_PORT ?? "15173", 10);
const apiBaseUrl = process.env.CCB_E2E_API_BASE_URL ?? `http://${host}:${apiPort}`;
const webBaseUrl = process.env.CCB_E2E_BASE_URL ?? `http://${host}:${webPort}`;
const dbPath = join(serverRoot, "prisma", "e2e.db");

process.env.DATABASE_URL = `file:${dbPath.replace(/\\/g, "/")}`;
process.env.CCB_SQLITE_BUSY_TIMEOUT_MS = process.env.CCB_SQLITE_BUSY_TIMEOUT_MS ?? "30000";
delete process.env.VITEST;
delete process.env.VITEST_POOL_ID;
delete process.env.VITEST_WORKER_ID;

const tmpRoots: string[] = [];
const fakeProjects: FakeProjectCcbd[] = [];
const counters = {
  projectsListRequests: 0
};

let fixtureState: E2EFixtureState | null = null;
let shuttingDown = false;

function runDbPush(): void {
  for (const path of [dbPath, `${dbPath}-shm`, `${dbPath}-wal`]) {
    rmSync(path, { force: true });
  }
  const result = spawnSync(
    "pnpm",
    [
      "prisma",
      "db",
      "push",
      "--schema",
      "prisma/schema.prisma",
      "--skip-generate",
      "--force-reset",
      "--accept-data-loss"
    ],
    {
      cwd: serverRoot,
      env: { ...process.env },
      encoding: "utf8"
    }
  );
  if (result.status !== 0) {
    throw new Error(`e2e db push failed\n${result.stdout}\n${result.stderr}`);
  }
}

async function resetDatabase(prisma: PrismaClient): Promise<void> {
  await prisma.hookAuditLog.deleteMany();
  await prisma.primitiveAudit.deleteMany();
  await prisma.nodeRun.deleteMany();
  await prisma.capabilityStatus.deleteMany();
  await prisma.roleProfile.deleteMany();
  await prisma.userIntent.deleteMany();
  await prisma.reviewIntent.deleteMany();
  await prisma.taskWorkspace.deleteMany();
  await prisma.taskRun.deleteMany();
  await prisma.taskCheckpoint.deleteMany();
  await prisma.consultRequest.deleteMany();
  await prisma.syncJob.deleteMany();
  await prisma.aiCliSetting.deleteMany();
  await prisma.requirementEditAudit.deleteMany();
  await prisma.eventJournal.deleteMany();
  await prisma.anchorDispatchQueue.deleteMany();
  await prisma.slotBinding.deleteMany();
  await prisma.anchorAllocation.deleteMany();
  await prisma.document.deleteMany();
  await prisma.task.deleteMany();
  await prisma.requirement.deleteMany();
  await prisma.sprint.deleteMany();
  await prisma.executorProfile.deleteMany();
  await prisma.attentionAck.deleteMany();
  await prisma.projectAttentionSettings.deleteMany();
  await prisma.projectSettings.deleteMany();
  await prisma.project.deleteMany();
}

async function closeFixtureResources(): Promise<void> {
  await Promise.all(fakeProjects.splice(0).map((project) => project.close()));
  await Promise.all(tmpRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  fixtureState = null;
}

function publishedReload(): CcbReloadResult {
  return {
    ok: true,
    status: "published",
    dryRun: false,
    mutationEnabled: true,
    planClass: "add_window",
    safeToApply: true,
    futureSafeToApply: true,
    operations: [],
    blocked: [],
    reasons: [],
    diagnostics: [],
    rawStdout: "reload_status: published\n",
    rawStderr: "",
    exitCode: 0,
    errorMessage: null
  };
}

function makeSlotContextResetter(input: {
  SlotContextResetService: SlotContextResetServiceCtor;
  createFakeTmuxRunner: CreateFakeTmuxRunner;
}) {
  return new input.SlotContextResetService({
    runTmux: input.createFakeTmuxRunner(fakeProjects)
  });
}

function makeSlotResizeService(input: {
  CcbdClientService: CcbdClientServiceCtor;
  SlotContextResetService: SlotContextResetServiceCtor;
  SlotResizeService: SlotResizeServiceCtor;
  createFakeTmuxRunner: CreateFakeTmuxRunner;
  prisma: PrismaClient;
}) {
  const runtime: SlotResizeRuntime = {
    isOnline: async (projectRoot) => {
      await new input.CcbdClientService({ projectRoot }).ping("ccbd");
      return true;
    },
    waitForSlotActive: async ({ projectRoot }) => {
      await new input.CcbdClientService({ projectRoot }).projectView();
      return true;
    },
    hasActiveSlotJob: async () => false
  };

  return new input.SlotResizeService({
    client: input.prisma,
    runtime,
    reload: async () => publishedReload(),
    contextResetterFactory: () => makeSlotContextResetter(input),
    activeWaitTimeoutMs: 10
  });
}

function fakeProjectCcbdStatus(projectId: string) {
  const fake = fakeProjects.find((candidate) => candidate.projectId === projectId);
  if (!fake) {
    throw new Error(`missing fake ccbd for ${projectId}`);
  }
  return {
    projectId,
    projectRoot: fake.projectRoot,
    socketPath: fake.ccbdSocketPath,
    tmuxSocketPath: fake.tmuxSocketPath,
    startupBlocked: false,
    config: {
      path: join(fake.projectRoot, ".ccb", "ccb.config"),
      exists: true,
      coreSignature: `e2e-${projectId}`,
      drift: null
    }
  };
}

function projectCcbdManager() {
  return {
    getStatus: async (projectId: string) => fakeProjectCcbdStatus(projectId),
    confirmRestore: async (projectId: string) => ({
      runtime: {
        status: "running",
        projectId,
        projectRoot: fakeProjectCcbdStatus(projectId).projectRoot,
        socketPath: fakeProjectCcbdStatus(projectId).socketPath,
        tmuxSocketPath: fakeProjectCcbdStatus(projectId).tmuxSocketPath,
        topologySignature: `e2e-${projectId}`
      },
      status: fakeProjectCcbdStatus(projectId)
    }),
    dispose: async () => undefined
  };
}

async function writeManagedConfig(input: {
  projectId: string;
  projectRoot: string;
  slotCount: number;
  projectSlotTopology: ProjectSlotTopology;
  renderManagedCcbConfig: RenderManagedCcbConfig;
}): Promise<void> {
  await mkdir(join(input.projectRoot, ".ccb"), { recursive: true });
  const rendered = input.renderManagedCcbConfig({
    projectId: input.projectId,
    projectRoot: input.projectRoot,
    topology: input.projectSlotTopology(input.slotCount)
  });
  await writeFile(join(input.projectRoot, ".ccb", "ccb.config"), rendered.configText, "utf8");
}

async function createProjectFixture(input: {
  label: "alpha" | "beta";
  name: string;
  prisma: PrismaClient;
  createFakeProjectCcbd: CreateFakeProjectCcbd;
  projectSlotTopology: ProjectSlotTopology;
  renderManagedCcbConfig: RenderManagedCcbConfig;
}): Promise<ProjectFixture> {
  const projectRoot = await mkdtemp(join(tmpdir(), `su-oriel-e2e-${input.label}-`));
  tmpRoots.push(projectRoot);
  await mkdir(join(projectRoot, "docs"), { recursive: true });

  const projectId = `e2e-project-${input.label}`;
  const requirementId = `e2e-req-${input.label}`;
  const taskId = `e2e-task-${input.label}`;
  const documentId = `e2e-doc-${input.label}`;
  const taskKey = `e2e-${input.label}-task-key`;
  const requirementTitle = `E2E ${input.name} requirement`;
  const documentPath = `docs/${input.label}-document.md`;

  await writeManagedConfig({
    projectId,
    projectRoot,
    slotCount: 3,
    projectSlotTopology: input.projectSlotTopology,
    renderManagedCcbConfig: input.renderManagedCcbConfig
  });
  await writeFile(join(projectRoot, documentPath), `# ${input.name} document\n\nE2E fixture content.\n`, "utf8");

  await input.prisma.project.create({
    data: {
      id: projectId,
      name: `E2E Project ${input.name}`,
      localPath: projectRoot,
      summary: `Playwright ${input.label} project`,
      initStatus: "initialized",
      docsRoot: join(projectRoot, "docs"),
      lastScanAt: new Date("2026-06-07T00:00:00.000Z"),
      syncStatus: "idle",
      slotCount: 3
    }
  });
  await input.prisma.requirement.create({
    data: {
      id: requirementId,
      projectId,
      title: requirementTitle,
      description: `Requirement owned by ${input.name}`,
      status: "planning"
    }
  });
  await input.prisma.task.create({
    data: {
      id: taskId,
      projectId,
      taskKey,
      title: `E2E ${input.name} task`,
      summary: `Task owned by ${input.name}`,
      status: "reviewing",
      currentNode: "implementation",
      nodeSubstate: "running",
      runtimeState: "running",
      requirementId
    }
  });
  await input.prisma.document.create({
    data: {
      id: documentId,
      projectId,
      taskKey,
      path: documentPath,
      kind: "other",
      title: `E2E ${input.name} document`,
      contentHash: randomUUID(),
      mtime: new Date("2026-06-07T00:00:00.000Z")
    }
  });

  const fake = await input.createFakeProjectCcbd({
    projectId,
    projectRoot,
    maxSlotCount: 4
  });
  fakeProjects.push(fake);

  return {
    projectId,
    projectName: `E2E Project ${input.name}`,
    projectRoot,
    requirementId,
    requirementTitle,
    taskId,
    documentId
  };
}

async function resetFixture(input: {
  prisma: PrismaClient;
  createFakeProjectCcbd: CreateFakeProjectCcbd;
  projectSlotTopology: ProjectSlotTopology;
  renderManagedCcbConfig: RenderManagedCcbConfig;
}): Promise<E2EFixtureState> {
  await closeFixtureResources();
  await resetDatabase(input.prisma);
  counters.projectsListRequests = 0;

  const alpha = await createProjectFixture({
    label: "alpha",
    name: "Alpha",
    ...input
  });
  const beta = await createProjectFixture({
    label: "beta",
    name: "Beta",
    ...input
  });
  fixtureState = { alpha, beta };
  return fixtureState;
}

function runtimeState() {
  const byId = new Map(fakeProjects.map((project) => [project.projectId, project]));
  const alpha = fixtureState ? byId.get(fixtureState.alpha.projectId) : null;
  const beta = fixtureState ? byId.get(fixtureState.beta.projectId) : null;
  const summarize = (project: FakeProjectCcbd | null) => ({
    ccbdRequests: project?.requests.length ?? 0,
    tmuxCommands: project?.tmuxCommands.length ?? 0,
    ops: project?.requests.map((request) => request.op) ?? []
  });
  return {
    alpha: summarize(alpha ?? null),
    beta: summarize(beta ?? null)
  };
}

function resetRuntimeRecords(): void {
  for (const fake of fakeProjects) {
    fake.resetRecords();
  }
}

async function registerE2eRoutes(input: {
  app: FastifyInstance;
  prisma: PrismaClient;
  createFakeProjectCcbd: CreateFakeProjectCcbd;
  projectSlotTopology: ProjectSlotTopology;
  renderManagedCcbConfig: RenderManagedCcbConfig;
}): Promise<void> {
  input.app.addHook("onResponse", async (request) => {
    if (request.method === "GET" && request.url === "/api/projects") {
      counters.projectsListRequests += 1;
    }
  });

  input.app.post("/_e2e/reset", async () => ({
    fixture: await resetFixture(input),
    apiBaseUrl,
    webBaseUrl
  }));

  input.app.post("/_e2e/reset-runtime-records", async () => {
    resetRuntimeRecords();
    return { ok: true };
  });

  input.app.post("/_e2e/touch-projects", async () => {
    await input.prisma.project.updateMany({
      data: {
        lastScanAt: new Date()
      }
    });
    return { ok: true };
  });

  input.app.get("/_e2e/state", async () => ({
    fixture: fixtureState,
    runtime: runtimeState(),
    counters
  }));
}

function startVite(): ChildProcess {
  const child = spawn(
    "pnpm",
    [
      "--filter",
      "su-oriel-web",
      "exec",
      "vite",
      "--configLoader",
      "runner",
      "--host",
      host,
      "--port",
      String(webPort),
      "--strictPort"
    ],
    {
      cwd: repoRoot,
      env: {
        ...process.env,
        VITE_API_PROXY_TARGET: apiBaseUrl
      },
      stdio: "inherit"
    }
  );
  child.on("exit", (code, signal) => {
    if (!shuttingDown) {
      console.error(`[e2e] vite exited unexpectedly: code=${code} signal=${signal}`);
      process.exit(code ?? 1);
    }
  });
  return child;
}

async function main(): Promise<void> {
  runDbPush();

  const [
    { buildApp },
    { prisma },
    { CcbdClientService },
    { SlotContextResetService },
    { SlotResizeService },
    { createFakeProjectCcbd, createFakeTmuxRunner },
    { projectSlotTopology, renderManagedCcbConfig }
  ] = await Promise.all([
    import("../server/src/app.js") as Promise<{ buildApp: BuildApp }>,
    import("../server/src/db/prisma.js") as Promise<{ prisma: PrismaClient }>,
    import("../server/src/modules/ccbd-client/ccbd-client.service.js") as Promise<{ CcbdClientService: CcbdClientServiceCtor }>,
    import("../server/src/modules/slot-binding/slot-context-reset.service.js") as Promise<{ SlotContextResetService: SlotContextResetServiceCtor }>,
    import("../server/src/modules/slot-resize/slot-resize.service.js") as Promise<{ SlotResizeService: SlotResizeServiceCtor }>,
    import("../server/src/tests/fixtures/per-project-ccbd-sockets.js") as Promise<{
      createFakeProjectCcbd: CreateFakeProjectCcbd;
      createFakeTmuxRunner: CreateFakeTmuxRunner;
    }>,
    import("../server/src/modules/project-ccbd/managed-config.service.js") as Promise<{
      projectSlotTopology: ProjectSlotTopology;
      renderManagedCcbConfig: RenderManagedCcbConfig;
    }>
  ]);

  const app = buildApp({
    enableFileWatcher: false,
    fileWatcherService: null,
    startupProjectScan: null,
    projectOnboarding: {
      projectCcbdManager: projectCcbdManager()
    },
    slots: {
      slotContextResetter: makeSlotContextResetter({
        SlotContextResetService,
        createFakeTmuxRunner
      }),
      slotResizeService: makeSlotResizeService({
        CcbdClientService,
        SlotContextResetService,
        SlotResizeService,
        createFakeTmuxRunner,
        prisma
      })
    }
  });

  await registerE2eRoutes({
    app,
    prisma,
    createFakeProjectCcbd,
    projectSlotTopology,
    renderManagedCcbConfig
  });

  await app.listen({ host, port: apiPort });
  const vite = startVite();

  const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    vite.kill("SIGTERM");
    await app.close().catch(() => undefined);
    await closeFixtureResources();
    await prisma.$disconnect().catch(() => undefined);
  };
  process.once("SIGINT", () => void shutdown().finally(() => process.exit(0)));
  process.once("SIGTERM", () => void shutdown().finally(() => process.exit(0)));
  process.once("beforeExit", () => void shutdown());

  console.log(`[e2e] api listening on ${apiBaseUrl}`);
  console.log(`[e2e] web listening on ${webBaseUrl}`);
}

main().catch((error) => {
  console.error("[e2e] harness failed", error);
  process.exit(1);
});
