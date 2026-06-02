import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, test, vi } from "vitest";

import { buildApp } from "../../app.js";
import { prisma } from "../../db/prisma.js";
import { scanProject } from "../../indexer/project-indexer.js";
import {
  BreakdownDraftConflictError,
  BreakdownDraftHashMismatchError
} from "./breakdown-draft.errors.js";
import { BreakdownDraftService } from "./breakdown-draft.service.js";
import { breakdownDraftSchema, type BreakdownDraft } from "./breakdown-draft.schema.js";

const tempRoots: string[] = [];

async function resetDatabase(): Promise<void> {
  await prisma.anchorAllocation.deleteMany();
  await prisma.userIntent.deleteMany();
  await prisma.requirement.deleteMany();
  await prisma.task.deleteMany();
  await prisma.document.deleteMany();
  await prisma.project.deleteMany();
}

async function createRequirementFixture() {
  const suffix = randomUUID();
  const projectRoot = await mkdtemp(join(tmpdir(), "ccb-breakdown-draft-"));
  tempRoots.push(projectRoot);

  const project = await prisma.project.create({
    data: {
      name: `Breakdown draft ${suffix}`,
      localPath: projectRoot,
      initStatus: "initialized",
      docsRoot: "docs"
    }
  });
  const requirement = await prisma.requirement.create({
    data: {
      projectId: project.id,
      title: "Plan multi PR requirement",
      description: "Need an Plan + Multi-PR split.",
      status: "planning",
      currentPlanningStep: "breakdown_draft"
    }
  });
  const task = { id: requirement.id, taskKey: requirement.title };

  return { project, projectRoot, requirement, task };
}

function makeDraft(input: {
  projectId: string;
  requirementId: string;
  taskId: string;
  taskKey: string;
}): BreakdownDraft {
  return {
    schema_version: "breakdown-draft-v0.2",
    status: "draft",
    project_id: input.projectId,
    requirement_id: input.requirementId,
    carrier_task_id: input.taskId,
    carrier_task_key: input.taskKey,
    base_task_revision: 7,
    generated_at: "2026-05-12T10:00:00.000Z",
    updated_at: "2026-05-12T10:00:00.000Z",
    generated_by: "manual",
    generation_source: {
      manual_actor: "console_user"
    },
    plan: {
      title: "Plan title",
      summary: "Plan summary",
      spec_outline_md: "## Outline\n\n- Deliver the split across implementation and review work with enough detail for planning.",
      estimated_total_days: 3
    },
    subtasks: [
      {
        section_id: "pr1-foundation",
        order: 1,
        title: "Foundation",
        summary: "Build the foundation.",
        spec_section_md: "## Foundation\n\n- Implement the foundation with persistence, validation, and test coverage.",
        priority: "high",
        implementation_owner: "ccb_codex",
        dependencies: [],
        include: true
      },
      {
        section_id: "pr2-ui",
        order: 2,
        title: "Review UI",
        summary: "Build the review UI.",
        spec_section_md: "## Review UI\n\n- Implement the review screen with loading, empty, and error states.",
        priority: "medium",
        implementation_owner: "claude",
        dependencies: ["pr1-foundation"],
        include: true
      }
    ],
    review_history: []
  };
}

function draftPath(projectRoot: string, requirementId: string): string {
  return join(projectRoot, "docs", ".ccb", "drafts", "breakdown", `${requirementId}.json`);
}

async function writeDraftFile(projectRoot: string, requirementId: string, draft: BreakdownDraft): Promise<void> {
  const path = draftPath(projectRoot, requirementId);
  await mkdir(join(projectRoot, "docs", ".ccb", "drafts", "breakdown"), { recursive: true });
  await writeFile(path, `${JSON.stringify(draft, null, 2)}\n`, "utf8");
}

beforeEach(async () => {
  await resetDatabase();
});

afterEach(async () => {
  await resetDatabase();
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

test("breakdown draft schema rejects auto implementation owner", () => {
  const { project, requirement, task } = {
    project: { id: "project-schema" },
    requirement: { id: "requirement-schema" },
    task: { id: "task-schema", taskKey: "task-schema" }
  };
  const draft = makeDraft({
    projectId: project.id,
    requirementId: requirement.id,
    taskId: task.id,
    taskKey: task.taskKey
  });

  draft.subtasks[0].implementation_owner = "auto" as BreakdownDraft["subtasks"][number]["implementation_owner"];

  const parsed = breakdownDraftSchema.safeParse(draft);

  assert.equal(parsed.success, false);
});

test("breakdown draft mutation routes are removed while GET remains read-only", async () => {
  const { project, projectRoot, requirement, task } = await createRequirementFixture();
  await writeDraftFile(
    projectRoot,
    task.id,
    makeDraft({
      projectId: project.id,
      requirementId: requirement.id,
      taskId: task.id,
      taskKey: task.taskKey
    })
  );
  const app = buildApp({ enableFileWatcher: false });

  try {
    const fetched = await app.inject({
      method: "GET",
      url: `/api/requirements/${task.id}/breakdown-draft`
    });
    assert.equal(fetched.statusCode, 200);

    for (const [method, url] of [
      ["POST", `/api/requirements/${task.id}/breakdown-draft`],
      ["PUT", `/api/requirements/${task.id}/breakdown-draft`],
      ["DELETE", `/api/requirements/${task.id}/breakdown-draft`],
      ["POST", `/api/requirements/${task.id}/breakdown-draft/begin-review`],
      ["POST", `/api/requirements/${task.id}/breakdown-draft/approve`],
      ["POST", `/api/requirements/${task.id}/breakdown-draft/reject-and-feedback`]
    ] as const) {
      const response = await app.inject({ method, url, payload: {} });
      assert.equal(response.statusCode, 404, `${method} ${url} should be removed`);
    }
  } finally {
    await app.close();
  }
});

test("scanProject projects breakdown draft files into requirement planning fields", async () => {
  const { project, projectRoot, requirement, task } = await createRequirementFixture();
  const draft: BreakdownDraft = {
    ...makeDraft({
      projectId: project.id,
      requirementId: requirement.id,
      taskId: task.id,
      taskKey: task.taskKey
    }),
    status: "approved",
    approved_at: "2026-05-22T12:00:00.000Z",
    approved_by: "reviewer"
  };
  await writeDraftFile(projectRoot, task.id, draft);

  await scanProject(prisma, project.id);

  const projected = await prisma.requirement.findUniqueOrThrow({ where: { id: requirement.id } });
  assert.equal(projected.breakdownDraftPath, `docs/.ccb/drafts/breakdown/${task.id}.json`);
  assert.equal(projected.currentPlanningStep, "ready_to_materialize");
  assert.equal(projected.planningRuntimeState, "idle");

  await rm(draftPath(projectRoot, task.id), { force: true });
  await scanProject(prisma, project.id);

  const cleared = await prisma.requirement.findUniqueOrThrow({ where: { id: requirement.id } });
  assert.equal(cleared.breakdownDraftPath, null);
});

test("scanProject keeps delivering requirement status when projecting a consumed draft", async () => {
  const { project, projectRoot, requirement, task } = await createRequirementFixture();
  await prisma.requirement.update({
    where: { id: requirement.id },
    data: {
      status: "delivering",
      currentPlanningStep: "ready_to_materialize"
    }
  });
  const draft: BreakdownDraft = {
    ...makeDraft({
      projectId: project.id,
      requirementId: requirement.id,
      taskId: task.id,
      taskKey: task.taskKey
    }),
    status: "consumed",
    approved_at: "2026-05-22T12:00:00.000Z",
    approved_by: "reviewer",
    consumed_at: "2026-05-22T12:30:00.000Z",
    consumed_by: "ccb_claude",
    consumed_from_hash: "a".repeat(64)
  };
  await writeDraftFile(projectRoot, task.id, draft);

  await scanProject(prisma, project.id);

  const projected = await prisma.requirement.findUniqueOrThrow({ where: { id: requirement.id } });
  assert.equal(projected.status, "delivering");
  assert.equal(projected.currentPlanningStep, "ready_to_materialize");
  assert.equal(projected.breakdownDraftPath, `docs/.ccb/drafts/breakdown/${task.id}.json`);
});

test("approve accepts draft status and stamps approved metadata from actor", async () => {
  const { project, requirement, task } = await createRequirementFixture();
  const service = new BreakdownDraftService(prisma, {
    now: () => new Date("2026-05-12T12:00:00.000Z")
  });
  const created = await service.createDraft(
    task.id,
    makeDraft({
      projectId: project.id,
      requirementId: requirement.id,
      taskId: task.id,
      taskKey: task.taskKey
    })
  );
  assert.equal(Object.hasOwn(created.draft, "project_id"), false);

  const approved = await service.approve(task.id, created.hash, "console_actor");

  assert.equal(approved.draft.status, "approved");
  assert.equal(approved.draft.approved_at, "2026-05-12T12:00:00.000Z");
  assert.equal(approved.draft.approved_by, "console_actor");
  assert.equal(approved.draft.review_history?.at(-1)?.action, "status_changed");
});

test.todo("SP-B23 业务审视: approve 是否应拒绝 cancelled draft 重新 approve");

test("approve rejects stale draft hashes", async () => {
  const { project, requirement, task } = await createRequirementFixture();
  const service = new BreakdownDraftService(prisma);
  await service.createDraft(
    task.id,
    makeDraft({
      projectId: project.id,
      requirementId: requirement.id,
      taskId: task.id,
      taskKey: task.taskKey
    })
  );

  await assert.rejects(
    async () => await service.approve(task.id, "0".repeat(64), "console_actor"),
    BreakdownDraftHashMismatchError
  );
});

test.todo("SP-B23 业务审视: already-approved draft 再次 approve 应返回 200 幂等还是 4xx reject");

test("rejectAndFeedback resets an approved draft, records feedback, and submits ask to the bound anchor", async () => {
  const { project, projectRoot, requirement, task } = await createRequirementFixture();
  const askAcrossAnchor = vi.fn().mockResolvedValue({ jobId: "job-1", submissionId: "sub-1" });
  const service = new BreakdownDraftService(prisma, {
    now: () => new Date("2026-05-12T12:30:00.000Z"),
    askRouterService: { askAcrossAnchor }
  });
  const created = await service.createDraft(
    task.id,
    makeDraft({
      projectId: project.id,
      requirementId: requirement.id,
      taskId: task.id,
      taskKey: task.taskKey
    })
  );
  const approved = await service.approve(task.id, created.hash, "console_actor");
  await prisma.anchorAllocation.create({
    data: {
      anchorId: `anchor-${randomUUID()}`,
      anchorPath: join(projectRoot, "../anchor"),
      projectId: project.id,
      subjectType: "requirement",
      subjectId: task.id,
      subjectKey: task.taskKey,
      mode: "planning",
      state: "ready"
    }
  });

  const result = await service.rejectAndFeedback(
    task.id,
    approved.hash,
    "Please merge the UI tasks and split backend migration separately.",
    "reviewer_a"
  );

  assert.equal(result.draft.status, "draft");
  // TODO(SP-B23): rejectAndFeedback 回到 draft 后是否应清空 approved_at / approved_by 需业务审视。
  assert.equal(result.draft.review_history?.at(-1)?.action, "rejected");
  assert.equal(result.draft.review_history?.at(-1)?.note, "Please merge the UI tasks and split backend migration separately.");
  assert.deepEqual(result.ask, {
    jobId: "job-1",
    submissionId: "sub-1",
    anchorId: (askAcrossAnchor.mock.calls[0][0] as { targetAnchorId: string }).targetAnchorId
  });
  assert.equal(askAcrossAnchor.mock.calls.length, 1);
  const askInput = askAcrossAnchor.mock.calls[0][0] as { toAgent: string; taskId: string; body: string };
  assert.equal(askInput.toAgent, "ccb_claude");
  assert.equal(askInput.taskId, task.id);
  assert.match(askInput.body, new RegExp(`requirement_id=${task.id}`));
  assert.match(askInput.body, /Please merge the UI tasks/);
});

test.todo("SP-B23 业务审视: rejectAndFeedback 回到 draft 后是否清空 approved_at / approved_by");

test("rejectAndFeedback rejects consumed drafts", async () => {
  const { project, requirement, task } = await createRequirementFixture();
  const service = new BreakdownDraftService(prisma, {
    askRouterService: { askAcrossAnchor: vi.fn() }
  });
  const created = await service.createDraft(
    task.id,
    makeDraft({
      projectId: project.id,
      requirementId: requirement.id,
      taskId: task.id,
      taskKey: task.taskKey
    })
  );
  const approved = await service.approve(task.id, created.hash, "console_actor");
  const consumed = await service.markConsumed(task.id, approved.hash);

  await assert.rejects(
    async () => await service.rejectAndFeedback(task.id, consumed.hash, "Please rebuild this split with fewer tasks.", "reviewer"),
    BreakdownDraftConflictError
  );
});

test("rejectAndFeedback rejects stale draft hashes", async () => {
  const { project, requirement, task } = await createRequirementFixture();
  const askAcrossAnchor = vi.fn();
  const service = new BreakdownDraftService(prisma, {
    askRouterService: { askAcrossAnchor }
  });
  await service.createDraft(
    task.id,
    makeDraft({
      projectId: project.id,
      requirementId: requirement.id,
      taskId: task.id,
      taskKey: task.taskKey
    })
  );

  await assert.rejects(
    async () => await service.rejectAndFeedback(task.id, "0".repeat(64), "Please rebuild this split with fewer tasks.", "reviewer"),
    BreakdownDraftHashMismatchError
  );
  assert.equal(askAcrossAnchor.mock.calls.length, 0);
});

test("rejectAndFeedback rejects when the requirement has no usable planning anchor", async () => {
  const { project, requirement, task } = await createRequirementFixture();
  const askAcrossAnchor = vi.fn();
  const service = new BreakdownDraftService(prisma, {
    askRouterService: { askAcrossAnchor }
  });
  const created = await service.createDraft(
    task.id,
    makeDraft({
      projectId: project.id,
      requirementId: requirement.id,
      taskId: task.id,
      taskKey: task.taskKey
    })
  );

  await assert.rejects(
    async () => await service.rejectAndFeedback(task.id, created.hash, "Please rebuild this split with fewer tasks.", "reviewer"),
    BreakdownDraftConflictError
  );
  assert.equal(askAcrossAnchor.mock.calls.length, 0);
});
