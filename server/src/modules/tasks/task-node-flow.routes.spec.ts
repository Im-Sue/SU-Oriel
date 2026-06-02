import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, test } from "vitest";

import { buildApp } from "../../app.js";
import { prisma } from "../../db/prisma.js";
import { taskNodeFlowApplicableActionSchema } from "./task-node-flow.schemas.js";

const createdProjectIds: string[] = [];
const createdTaskIds: string[] = [];

const NODE_FLOW_TRANSITION_IDS = [
  "requirement_analysis__on_done__to__technical_design",
  "requirement_analysis__escalate__to__terminal",
  "technical_design__on_done__to__task_breakdown",
  "technical_design__escalate__to__terminal",
  "task_breakdown__on_done__to__dispatch",
  "task_breakdown__escalate__to__terminal",
  "dispatch__on_codex_pickup__to__implementation",
  "dispatch__codex_unavailable__to__terminal",
  "dispatch__codex_rejected__to__terminal",
  "implementation__on_receipt_ready__to__review",
  "implementation__codex_blocked__to__terminal",
  "review__pass__to__archive",
  "review__replan_to_implementation__to__implementation",
  "review__replan_to_task_breakdown__to__task_breakdown",
  "review__replan_to_technical_design__to__technical_design",
  "review__replan_to_requirement_analysis__to__requirement_analysis",
  "review__escalate__to__terminal",
  "archive__on_complete__to__terminal"
] as const;

async function createTaskFixture(
  overrides: {
    status?: string;
    currentNode?: string | null;
    nodeSubstate?: string | null;
    runtimeState?: string | null;
    lastTransitionId?: string | null;
    reviewStatus?: string | null;
    blockedReason?: string | null;
  } = {}
) {
  const suffix = randomUUID();
  const project = await prisma.project.create({
    data: {
      name: `node-flow-${suffix}`,
      localPath: join(tmpdir(), `ccb-node-flow-${suffix}`)
    }
  });
  createdProjectIds.push(project.id);

  const task = await prisma.task.create({
    data: {
      projectId: project.id,
      taskKey: `task-${suffix}`,
      title: "Node Flow task",
      status: overrides.status ?? "reviewing",
      currentNode: overrides.currentNode ?? "requirement_analysis",
      nodeSubstate: overrides.nodeSubstate ?? "drafting",
      runtimeState: overrides.runtimeState ?? "running",
      lastTransitionId: overrides.lastTransitionId ?? null,
      reviewStatus: overrides.reviewStatus ?? null,
      blockedReason: overrides.blockedReason ?? null,
      priority: "medium",
      progress: 20
    }
  });
  createdTaskIds.push(task.id);

  return {
    projectId: project.id,
    taskId: task.id,
    taskKey: task.taskKey
  };
}

async function insertTransitionAudit(input: {
  projectId: string;
  taskId: string;
  taskKey: string;
  eventId: string;
  eventType: string;
  transitionId: string;
  result: string;
  requestedAt: string;
  appliedAt?: string | null;
  proposalReason?: string;
}) {
  await prisma.eventJournal.create({
    data: {
      eventId: input.eventId,
      eventType: input.eventType,
      projectId: input.projectId,
      subjectType: "subtask",
      subjectId: input.taskId,
      subjectKey: input.taskKey,
      payloadJson: JSON.stringify({
        decision_ref: "docs/.ccb/decisions/ADR-test.md",
        verdict: "approve"
      }),
      emittedAt: new Date(input.requestedAt),
      sourceActor: "user",
      sourceComponent: "console"
    }
  });

  return await prisma.taskCheckpoint.create({
    data: {
      taskId: input.taskId,
      taskKey: input.taskKey,
      transitionId: input.transitionId,
      nodeBefore: "requirement_analysis",
      nodeAfter: "technical_design",
      stateRevisionAfter: 1,
      stateHash: "a".repeat(64),
      snapshotInline: JSON.stringify({
        eventId: input.eventId,
        eventType: input.eventType,
        result: input.result,
        appliedAt: input.appliedAt ?? input.requestedAt,
        proposalReason: input.proposalReason ?? "eligible"
      }),
      createdAt: new Date(input.requestedAt)
    }
  });
}

async function insertCodexReceiptEvent(input: {
  projectId: string;
  taskId: string;
  taskKey: string;
  eventId: string;
}) {
  await prisma.eventJournal.create({
    data: {
      eventId: input.eventId,
      eventType: "codex_receipt_ready",
      projectId: input.projectId,
      subjectType: "subtask",
      subjectId: input.taskId,
      subjectKey: input.taskKey,
      payloadJson: JSON.stringify({
        receipt_ref: "docs/.ccb/receipts/receipt.md",
        provider: "codex",
        receipt_summary: "done",
        unsolicited_findings: []
      }),
      emittedAt: new Date("2026-05-04T10:30:00.000Z"),
      sourceActor: "codex",
      sourceComponent: "primitive_executor"
    }
  });
}

afterEach(async () => {
  for (const projectId of createdProjectIds.splice(0)) {
    await prisma.project.deleteMany({
      where: {
        id: projectId
      }
    });
  }
});

test("task node-flow action schema requires applicability", () => {
  const parsed = taskNodeFlowApplicableActionSchema.safeParse({
    transition_id: "implementation__on_receipt_ready__to__review",
    label: "进入评审",
    guard_status: "satisfied"
  });

  assert.equal(parsed.success, false);
});

test("GET /api/tasks/:taskId/node-flow returns current node with empty transition history", async () => {
  const app = buildApp({ enableFileWatcher: false });
  const fixture = await createTaskFixture();

  try {
    const response = await app.inject({
      method: "GET",
      url: `/api/tasks/${fixture.taskId}/node-flow`
    });

    assert.equal(response.statusCode, 200, response.body);
    const body = response.json();
    assert.equal(body.currentNode, "requirement_analysis");
    assert.equal(body.nodeSubstate, "drafting");
    assert.equal(body.runtimeState, "running");
    assert.equal(body.lastTransitionId, null);
    assert.equal(body.lastTransitionAt, null);
    assert.deepEqual(body.transitions, []);
    assert.ok(Array.isArray(body.applicable_actions));
    assert.ok(body.applicable_actions.every((action: { applicability: string }) => action.applicability === "system_only"));
  } finally {
    await app.close();
  }
});

test("GET /api/tasks/:taskId/node-flow marks all transition actions system_only", async () => {
  const app = buildApp({ enableFileWatcher: false });
  const nodeIds = [
    "requirement_analysis",
    "technical_design",
    "task_breakdown",
    "dispatch",
    "implementation",
    "review",
    "archive"
  ];
  const seen = new Set<string>();

  try {
    for (const currentNode of nodeIds) {
      const fixture = await createTaskFixture({
        currentNode,
        reviewStatus: currentNode === "review" ? "needs_followup" : null,
        blockedReason: currentNode === "review" ? "等待补充设计" : null
      });
      const response = await app.inject({
        method: "GET",
        url: `/api/tasks/${fixture.taskId}/node-flow`
      });
      assert.equal(response.statusCode, 200, response.body);
      const body = response.json();
      for (const action of body.applicable_actions as Array<{ transition_id: string; applicability: string }>) {
        seen.add(action.transition_id);
        assert.equal(action.applicability, "system_only", action.transition_id);
      }
    }

    assert.deepEqual([...seen].sort(), [...NODE_FLOW_TRANSITION_IDS].sort());
  } finally {
    await app.close();
  }
});

test("GET /api/tasks/:taskId/node-flow projects applied transition history", async () => {
  const app = buildApp({ enableFileWatcher: false });
  const fixture = await createTaskFixture({
    currentNode: "technical_design",
    nodeSubstate: "drafting",
    lastTransitionId: "requirement_analysis__on_done__to__technical_design"
  });
  const eventId = randomUUID();

  const checkpoint = await insertTransitionAudit({
    ...fixture,
    eventId,
    eventType: "user_arbitration_submitted",
    transitionId: "requirement_analysis__on_done__to__technical_design",
    result: "applied",
    requestedAt: "2026-05-04T10:23:11.000Z"
  });

  try {
    const response = await app.inject({
      method: "GET",
      url: `/api/tasks/${fixture.taskId}/node-flow`
    });

    assert.equal(response.statusCode, 200, response.body);
    const body = response.json();
    assert.equal(body.lastTransitionId, "requirement_analysis__on_done__to__technical_design");
    assert.equal(body.lastTransitionAt, "2026-05-04T10:23:11.000Z");
    assert.equal(body.transitions.length, 1);
    assert.deepEqual(body.transitions[0], {
      transition_id: "requirement_analysis__on_done__to__technical_design",
      source_node: "requirement_analysis",
      target_node: "technical_design",
      verdict: "pass",
      at: "2026-05-04T10:23:11.000Z",
      evidence_ref: checkpoint.id
    });
  } finally {
    await app.close();
  }
});

test("GET /api/tasks/:taskId/node-flow exposes review replan actions for blocked tasks", async () => {
  const app = buildApp({ enableFileWatcher: false });
  const fixture = await createTaskFixture({
    status: "reviewing",
    currentNode: "review",
    nodeSubstate: "blocked",
    runtimeState: "blocked",
    lastTransitionId: "implementation__on_receipt_ready__to__review",
    reviewStatus: "needs_followup",
    blockedReason: "等待补充设计"
  });

  try {
    const response = await app.inject({
      method: "GET",
      url: `/api/tasks/${fixture.taskId}/node-flow`
    });

    assert.equal(response.statusCode, 200, response.body);
    const body = response.json();
    const replanAction = body.applicable_actions.find(
      (action: { transition_id: string }) =>
        action.transition_id === "review__replan_to_implementation__to__implementation"
    );
    const passAction = body.applicable_actions.find(
      (action: { transition_id: string }) => action.transition_id === "review__pass__to__archive"
    );

    assert.ok(replanAction);
    assert.equal(replanAction.guard_status, "satisfied");
    assert.match(replanAction.guard_reason, /needs_followup/);
    assert.ok(passAction);
    assert.equal(passAction.guard_status, "blocked");
    assert.match(passAction.guard_reason, /review_status/);
    assert.ok(
      body.applicable_actions.every((action: { transition_id: string }) => action.transition_id.startsWith("review__"))
    );
    assert.ok(
      body.applicable_actions.every((action: { applicability: string }) => action.applicability === "system_only")
    );
  } finally {
    await app.close();
  }
});

test("GET /api/tasks/:taskId/node-flow strips receipt event id from guard reason", async () => {
  const app = buildApp({ enableFileWatcher: false });
  const fixture = await createTaskFixture({
    currentNode: "implementation",
    nodeSubstate: "receipt_ready",
    runtimeState: "running"
  });
  const eventId = randomUUID();
  await insertCodexReceiptEvent({ ...fixture, eventId });

  try {
    const response = await app.inject({
      method: "GET",
      url: `/api/tasks/${fixture.taskId}/node-flow`
    });

    assert.equal(response.statusCode, 200, response.body);
    const body = response.json();
    const receiptAction = body.applicable_actions.find(
      (action: { transition_id: string }) =>
        action.transition_id === "implementation__on_receipt_ready__to__review"
    );
    assert.ok(receiptAction);
    assert.equal(receiptAction.guard_status, "satisfied");
    assert.equal(receiptAction.guard_reason, "codex_receipt_ready event available");
    assert.equal(receiptAction.guard_reason.includes(eventId), false);
    assert.equal(receiptAction.applicability, "system_only");
  } finally {
    await app.close();
  }
});

test("GET /api/tasks/:taskId/node-flow satisfies codex rejected guard from event signal", async () => {
  const app = buildApp({ enableFileWatcher: false });
  const fixture = await createTaskFixture({
    currentNode: "dispatch",
    nodeSubstate: "waiting_codex",
    runtimeState: "waiting_codex"
  });
  await prisma.eventJournal.create({
    data: {
      eventId: randomUUID(),
      eventType: "codex_rejected",
      projectId: fixture.projectId,
      subjectType: "subtask",
      subjectId: fixture.taskId,
      subjectKey: fixture.taskKey,
      payloadJson: JSON.stringify({ reason: "invalid spec" }),
      emittedAt: new Date("2026-05-04T11:00:00.000Z"),
      sourceActor: "codex",
      sourceComponent: "console"
    }
  });

  try {
    const response = await app.inject({
      method: "GET",
      url: `/api/tasks/${fixture.taskId}/node-flow`
    });

    assert.equal(response.statusCode, 200, response.body);
    const body = response.json();
    const rejectedAction = body.applicable_actions.find(
      (action: { transition_id: string }) => action.transition_id === "dispatch__codex_rejected__to__terminal"
    );
    assert.ok(rejectedAction);
    assert.equal(rejectedAction.guard_status, "satisfied");
    assert.equal(rejectedAction.guard_reason, "codex_rejected event available");
  } finally {
    await app.close();
  }
});
