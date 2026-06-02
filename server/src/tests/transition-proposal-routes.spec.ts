import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { afterEach, test } from "vitest";

import { buildApp } from "../app.js";
import { prisma } from "../db/prisma.js";
import { getEventJournalByEventId, submitEventJournal } from "../modules/events/event-journal.service.js";
import { PrismaProjectStore } from "../modules/project/project.store.prisma.js";
import { resolveTransitionProposal } from "../modules/transitions/transition-proposal.service.js";
import { resolveCcbProjectRoot } from "../lib/project-root.js";

const repoRoot = resolveCcbProjectRoot();
const transitionTablePath = resolve(repoRoot, "su-ccb-claude-plugin/references/kernel/registries/transition-table.md");
const suReviewSkillPath = resolve(repoRoot, "su-ccb-claude-plugin/skills/su-review/SKILL.md");
const SHARED_DATABASE_RESET_MESSAGE = "共享测试数据库被其他测试清理";
const isFocusedTransitionProposalRun = process.argv.some((argument) =>
  argument.includes("transition-proposal-routes.spec.ts")
);
const SHARED_DATABASE_STARTUP_DELAY_MS = isFocusedTransitionProposalRun ? 0 : 4500;
const createdProjectIds = new Set<string>();
let sharedDatabaseStartupDelay: Promise<void> | null = null;

async function waitForSharedDatabaseStartup(): Promise<void> {
  if (SHARED_DATABASE_STARTUP_DELAY_MS === 0) {
    return;
  }

  if (!sharedDatabaseStartupDelay) {
    sharedDatabaseStartupDelay = new Promise((resolveDelay) =>
      setTimeout(resolveDelay, SHARED_DATABASE_STARTUP_DELAY_MS)
    );
  }

  await sharedDatabaseStartupDelay;
}

async function cleanupCreatedProjects(): Promise<void> {
  const projectIds = [...createdProjectIds];
  createdProjectIds.clear();

  if (projectIds.length === 0) {
    return;
  }

  await prisma.project.deleteMany({
    where: {
      id: {
        in: projectIds
      }
    }
  });
}

function isRetryableSharedDatabaseError(error: unknown): boolean {
  return error instanceof Error && (error.message === SHARED_DATABASE_RESET_MESSAGE || error.message === "任务不存在");
}

async function retryWhenSharedDatabaseResets<T>(operation: () => Promise<T>): Promise<T> {
  let lastError: unknown;
  await waitForSharedDatabaseStartup();

  for (let attempt = 0; attempt < 12; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      if (!isRetryableSharedDatabaseError(error)) {
        throw error;
      }
      lastError = error;
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 100 * (attempt + 1)));
    }
  }

  throw lastError;
}

function retryIfFixtureWasDeleted(envelope: { reason?: string }): void {
  if (envelope.reason === "event_not_found") {
    throw new Error(SHARED_DATABASE_RESET_MESSAGE);
  }
}

async function createTaskFixture(
  options: {
    currentNode?: string | null;
    nodeSubstate?: string | null;
    runtimeState?: string | null;
    status?: string;
    reviewStatus?: string | null;
  } = {}
): Promise<{ projectId: string; taskId: string; taskKey: string }> {
  const project = await prisma.project.create({
    data: {
      name: `Transition Proposal Project ${randomUUID()}`,
      localPath: join(tmpdir(), `ccb-test-${randomUUID()}`),
      updatedAt: new Date()
    }
  });
  createdProjectIds.add(project.id);
  const task = await prisma.task.create({
    data: {
      projectId: project.id,
      taskKey: `task-${randomUUID()}`,
      title: "Transition proposal task",
      status: options.status ?? "dispatched",
      currentNode: options.currentNode ?? "implementation",
      nodeSubstate: options.nodeSubstate ?? "executing",
      runtimeState: options.runtimeState ?? "waiting_codex",
      reviewStatus: options.reviewStatus ?? null,
      lastTransitionId: "dispatch__on_codex_pickup__to__implementation",
      updatedAt: new Date()
    }
  });

  return {
    projectId: project.id,
    taskId: task.id,
    taskKey: task.taskKey
  };
}

async function createJournaledEvent(
  taskId: string,
  options: {
    eventId?: string;
    eventType?:
      | "codex_receipt_ready"
      | "user_arbitration_submitted"
      | "session_resumed"
      | "verification_finished"
      | "codex_picked_up";
    payload?: Record<string, unknown>;
  } = {}
): Promise<{ eventId: string }> {
  const eventId = options.eventId ?? randomUUID();
  const eventType = options.eventType ?? "codex_receipt_ready";
  if (eventType === "user_arbitration_submitted") {
    await submitEventJournal({
      event_id: eventId,
      event_type: "user_arbitration_submitted",
      task_id: taskId,
      payload: {
        decision_ref: "docs/.ccb/arbitration/decision.md",
        verdict: "approve",
        ...options.payload
      },
      emitted_at: "2026-04-28T00:00:00.000Z",
      source_actor: "user",
      source_component: "console"
    });
  } else if (eventType === "session_resumed") {
    await submitEventJournal({
      event_id: eventId,
      event_type: "session_resumed",
      task_id: taskId,
      payload: {
        resume_source: "manual",
        waiting_ref: "cursor:pause",
        resumed_by: "user"
      },
      emitted_at: "2026-04-28T00:00:00.000Z",
      source_actor: "user",
      source_component: "console"
    });
  } else if (eventType === "verification_finished") {
    await submitEventJournal({
      event_id: eventId,
      event_type: "verification_finished",
      task_id: taskId,
      payload: {
        result: "pass",
        build: { status: "ok" },
        test: { status: "passed" },
        artifact_refs: ["docs/.ccb/state/task.md"]
      },
      emitted_at: "2026-04-28T00:00:00.000Z",
      source_actor: "system",
      source_component: "primitive_executor"
    });
  } else if (eventType === "codex_picked_up") {
    await submitEventJournal({
      event_id: eventId,
      event_type: "codex_picked_up",
      task_id: taskId,
      payload: {
        dispatch_id: "dispatch-1",
        agent_id: "codex-1",
        workspace_ref: "worktree://task"
      },
      emitted_at: "2026-04-28T00:00:00.000Z",
      source_actor: "codex",
      source_component: "primitive_executor"
    });
  } else {
    await submitEventJournal({
      event_id: eventId,
      event_type: "codex_receipt_ready",
      task_id: taskId,
      payload: {
        receipt_ref: "docs/.ccb/state/task.md",
        provider: "codex",
        receipt_summary: "实现已完成，等待 review",
        unsolicited_findings: []
      },
      emitted_at: "2026-04-28T00:00:00.000Z",
      source_actor: "codex",
      source_component: "primitive_executor"
    });
  }

  return {
    eventId
  };
}

async function loadTaskStateSnapshot(taskId: string) {
  return await prisma.task.findUniqueOrThrow({
    where: {
      id: taskId
    },
    select: {
      currentNode: true,
      nodeSubstate: true,
      runtimeState: true,
      status: true,
      lastTransitionId: true
    }
  });
}

function extractTransitionBlock(markdown: string, transitionId: string): string | null {
  const escapedTransitionId = transitionId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = markdown.match(new RegExp(`#### \`${escapedTransitionId}\`[\\s\\S]*?(?=\\n#### \`|\\n---|\\n## |$)`));
  return match?.[0] ?? null;
}

test("Transition proposal returns eligible envelope for codex receipt event in implementation", async () => {
  await retryWhenSharedDatabaseResets(async () => {
    const app = buildApp({
      projectStore: new PrismaProjectStore(prisma)
    });

    try {
      const fixture = await createTaskFixture();
      const { eventId } = await createJournaledEvent(fixture.taskId);

      const response = await app.inject({
        method: "GET",
        url: `/api/event-journal/events/${eventId}/transition-proposal?task_id=${fixture.taskId}`
      });
      const body = response.json();

      assert.equal(response.statusCode, 200);
      retryIfFixtureWasDeleted(body);
      assert.deepEqual(body, {
        eligible: true,
        reason: "eligible",
        eventId,
        transitionId: "implementation__on_receipt_ready__to__review",
        sourceNode: "implementation",
        targetNode: "review"
      });
    } finally {
      await app.close();
    }
  });
});

test("Transition proposal resolves T2 event mappings by event type and current task state", async () => {
  await retryWhenSharedDatabaseResets(async () => {
    const pickedUpFixture = await createTaskFixture({
      currentNode: "dispatch",
      nodeSubstate: "awaiting_codex_pickup",
      runtimeState: "waiting_codex",
      status: "reviewing"
    });
    const verificationFixture = await createTaskFixture({
      currentNode: "review",
      nodeSubstate: "auto_reviewing",
      runtimeState: "running",
      status: "reviewing",
      reviewStatus: "passed"
    });
    const arbitrationFixture = await createTaskFixture({
      currentNode: "review",
      nodeSubstate: "replanning",
      runtimeState: "running",
      status: "reviewing",
      reviewStatus: "needs_followup"
    });
    const pickedUp = await createJournaledEvent(pickedUpFixture.taskId, { eventType: "codex_picked_up" });
    const verification = await createJournaledEvent(verificationFixture.taskId, { eventType: "verification_finished" });
    const arbitration = await createJournaledEvent(arbitrationFixture.taskId, {
      eventType: "user_arbitration_submitted"
    });

    const cases = [
      {
        fixture: pickedUpFixture,
        eventId: pickedUp.eventId,
        transitionId: "dispatch__on_codex_pickup__to__implementation",
        sourceNode: "dispatch",
        targetNode: "implementation"
      },
      {
        fixture: verificationFixture,
        eventId: verification.eventId,
        transitionId: "review__pass__to__archive",
        sourceNode: "review",
        targetNode: "archive"
      },
      {
        fixture: arbitrationFixture,
        eventId: arbitration.eventId,
        transitionId: "review__replan_to_implementation__to__implementation",
        sourceNode: "review",
        targetNode: "implementation"
      }
    ];

    for (const item of cases) {
      const envelope = await resolveTransitionProposal({
        eventId: item.eventId,
        taskId: item.fixture.taskId
      });
      retryIfFixtureWasDeleted(envelope);
      assert.deepEqual(envelope, {
        eligible: true,
        reason: "eligible",
        eventId: item.eventId,
        transitionId: item.transitionId,
        sourceNode: item.sourceNode,
        targetNode: item.targetNode
      });
    }
  });
});

test("Transition proposal rejects session_resumed because it is not a transition trigger", async () => {
  await retryWhenSharedDatabaseResets(async () => {
    const fixture = await createTaskFixture({
      currentNode: "dispatch",
      nodeSubstate: "awaiting_codex_pickup",
      runtimeState: "waiting_codex",
      status: "reviewing"
    });
    const { eventId } = await createJournaledEvent(fixture.taskId, { eventType: "session_resumed" });

    const envelope = await resolveTransitionProposal({
      eventId,
      taskId: fixture.taskId
    });

    retryIfFixtureWasDeleted(envelope);
    assert.deepEqual(envelope, {
      eligible: false,
      reason: "session_resumed_not_a_transition_trigger",
      eventId,
      transitionId: null
    });
  });
});

test("Transition proposal routes user arbitration reentry_node to all review replan targets", async () => {
  await retryWhenSharedDatabaseResets(async () => {
    const cases = [
      {
        reentryNode: "implementation",
        transitionId: "review__replan_to_implementation__to__implementation",
        targetNode: "implementation"
      },
      {
        reentryNode: "task_breakdown",
        transitionId: "review__replan_to_task_breakdown__to__task_breakdown",
        targetNode: "task_breakdown"
      },
      {
        reentryNode: "technical_design",
        transitionId: "review__replan_to_technical_design__to__technical_design",
        targetNode: "technical_design"
      },
      {
        reentryNode: "requirement_analysis",
        transitionId: "review__replan_to_requirement_analysis__to__requirement_analysis",
        targetNode: "requirement_analysis"
      }
    ] as const;

    for (const item of cases) {
      const fixture = await createTaskFixture({
        currentNode: "review",
        nodeSubstate: "replanning",
        runtimeState: "running",
        status: "reviewing",
        reviewStatus: "needs_followup"
      });
      const { eventId } = await createJournaledEvent(fixture.taskId, {
        eventType: "user_arbitration_submitted",
        payload: {
          reentry_node: item.reentryNode
        }
      });

      const envelope = await resolveTransitionProposal({
        eventId,
        taskId: fixture.taskId
      });

      retryIfFixtureWasDeleted(envelope);
      assert.deepEqual(envelope, {
        eligible: true,
        reason: "eligible",
        eventId,
        transitionId: item.transitionId,
        sourceNode: "review",
        targetNode: item.targetNode
      });
    }
  });
});

test("Transition proposal treats task_id query as optional but checks mismatch when provided", async () => {
  await retryWhenSharedDatabaseResets(async () => {
    const app = buildApp({
      projectStore: new PrismaProjectStore(prisma)
    });

    try {
      const fixture = await createTaskFixture();
      const otherFixture = await createTaskFixture();
      const { eventId } = await createJournaledEvent(fixture.taskId);

      const withoutTaskQueryResponse = await app.inject({
        method: "GET",
        url: `/api/event-journal/events/${eventId}/transition-proposal`
      });
      const withoutTaskQueryBody = withoutTaskQueryResponse.json();
      assert.equal(withoutTaskQueryResponse.statusCode, 200);
      retryIfFixtureWasDeleted(withoutTaskQueryBody);
      assert.equal(withoutTaskQueryBody.eligible, true);

      const mismatchResponse = await app.inject({
        method: "GET",
        url: `/api/event-journal/events/${eventId}/transition-proposal?task_id=${otherFixture.taskId}`
      });
      const mismatchBody = mismatchResponse.json();
      assert.equal(mismatchResponse.statusCode, 200);
      retryIfFixtureWasDeleted(mismatchBody);
      assert.deepEqual(mismatchBody, {
        eligible: false,
        reason: "event_task_mismatch",
        eventId,
        transitionId: null
      });
    } finally {
      await app.close();
    }
  });
});

test("Transition proposal returns explicit ineligible reasons without mutating task or EventJournal", async () => {
  await retryWhenSharedDatabaseResets(async () => {
    const app = buildApp({
      projectStore: new PrismaProjectStore(prisma)
    });

    try {
      const nonImplementationFixture = await createTaskFixture({
        currentNode: "review"
      });
      const wrongTypeFixture = await createTaskFixture();
      const deletedTaskFixture = await createTaskFixture();
      const nonImplementationEvent = await createJournaledEvent(nonImplementationFixture.taskId);
      const wrongTypeEvent = await createJournaledEvent(wrongTypeFixture.taskId, {
        eventType: "user_arbitration_submitted"
      });
      const deletedTaskEvent = await createJournaledEvent(deletedTaskFixture.taskId);
      const beforeTaskSnapshot = await loadTaskStateSnapshot(nonImplementationFixture.taskId);
      const beforeEventSnapshot = await getEventJournalByEventId(nonImplementationEvent.eventId);

      await prisma.task.delete({
        where: {
          id: deletedTaskFixture.taskId
        }
      });

      const cases = [
        {
          eventId: nonImplementationEvent.eventId,
          reason: "task_not_in_implementation"
        },
        {
          eventId: wrongTypeEvent.eventId,
          reason: "task_not_in_review"
        },
        {
          eventId: deletedTaskEvent.eventId,
          reason: "task_not_found"
        },
        {
          eventId: randomUUID(),
          reason: "event_not_found"
        }
      ];

      for (const item of cases) {
        const response = await app.inject({
          method: "GET",
          url: `/api/event-journal/events/${item.eventId}/transition-proposal`
        });
        const body = response.json();
        assert.equal(response.statusCode, 200);
        if (item.reason !== "event_not_found") {
          retryIfFixtureWasDeleted(body);
        }
        assert.deepEqual(body, {
          eligible: false,
          reason: item.reason,
          eventId: item.eventId,
          transitionId: null
        });
      }

      assert.deepEqual(await loadTaskStateSnapshot(nonImplementationFixture.taskId), beforeTaskSnapshot);
      assert.deepEqual(await getEventJournalByEventId(nonImplementationEvent.eventId), beforeEventSnapshot);
    } finally {
      await app.close();
    }
  });
});

test("Transition proposal rejects invalid input with Chinese validation message", async () => {
  const app = buildApp({
    projectStore: new PrismaProjectStore(prisma)
  });

  const invalidEventIdResponse = await app.inject({
    method: "GET",
    url: "/api/event-journal/events/not-a-uuid/transition-proposal"
  });
  assert.equal(invalidEventIdResponse.statusCode, 400);
  assert.equal(invalidEventIdResponse.json().message, "transition proposal 参数不合法");

  const invalidQueryResponse = await app.inject({
    method: "GET",
    url: `/api/event-journal/events/${randomUUID()}/transition-proposal?task_id=`
  });
  assert.equal(invalidQueryResponse.statusCode, 400);
  assert.equal(invalidQueryResponse.json().message, "transition proposal 参数不合法");

  await app.close();
});

test("Transition proposal mapping stays synchronized with transition-table canonical text", async () => {
  const markdown = await readFile(transitionTablePath, "utf8");
  const expected = [
    ["implementation__on_receipt_ready__to__review", /event_type == 'codex_receipt_ready'/, /\*\*target_node\*\*: `review`/],
    ["dispatch__on_codex_pickup__to__implementation", /event_type == 'codex_picked_up'/, /\*\*target_node\*\*: `implementation`/],
    ["review__pass__to__archive", /task\.review_status == 'passed'/, /\*\*target_node\*\*: `archive`/],
    [
      "review__replan_to_implementation__to__implementation",
      /reentry_node == 'implementation'/,
      /\*\*target_node\*\*: `implementation`/
    ],
    [
      "review__replan_to_task_breakdown__to__task_breakdown",
      /reentry_node == 'task_breakdown'/,
      /\*\*target_node\*\*: `task_breakdown`/
    ],
    [
      "review__replan_to_technical_design__to__technical_design",
      /reentry_node == 'technical_design'/,
      /\*\*target_node\*\*: `technical_design`/
    ],
    [
      "review__replan_to_requirement_analysis__to__requirement_analysis",
      /reentry_node == 'requirement_analysis'/,
      /\*\*target_node\*\*: `requirement_analysis`/
    ]
  ] as const;

  for (const [transitionId, whenPattern, targetPattern] of expected) {
    const block = extractTransitionBlock(markdown, transitionId);
    assert.notEqual(block, null, transitionId);
    assert.match(block ?? "", whenPattern);
    assert.match(block ?? "", targetPattern);
  }
});

test("Transition proposal exposes canonical drift reason through injected mapping validator", async () => {
  await retryWhenSharedDatabaseResets(async () => {
    const fixture = await createTaskFixture();
    const { eventId } = await createJournaledEvent(fixture.taskId);

    const envelope = await resolveTransitionProposal(
      {
        eventId,
        taskId: fixture.taskId
      },
      {
        validateMappingSync: () => false
      }
    );
    retryIfFixtureWasDeleted(envelope);

    assert.deepEqual(envelope, {
      eligible: false,
      reason: "transition_id_canonical_drift",
      eventId,
      transitionId: null
    });
  });
});

test("su-review declares ADR-0030 plugin-owned review source instead of Console proposal contexts", async () => {
  const skill = await readFile(suReviewSkillPath, "utf8");

  assert.match(skill, /references\/kernel\/nodes\/review\.node\.md/);
  assert.match(skill, /直接读取开发任务文档、回执、diff 摘要和 EventJournal 文件/);
  assert.match(skill, /不调用 Console 业务写入接口获取 proposal 或写审查状态/);
  assert.match(skill, /Console 可以展示 review 结果，但不成为审查真相源/);
  assert.match(skill, /pass、request changes、replan 或 escalate/);
  assert.doesNotMatch(skill, /## ReviewIntent context/);
  assert.doesNotMatch(skill, /## EventJournal proposal context/);
});

afterEach(async () => {
  await cleanupCreatedProjects();
});
