import { prisma } from "../src/db/prisma.js";

const projectId = "e12-fixture-project";
const projectPath = "/tmp/su-ccb/e12-fixture";
const taskPrefix = "e12-fixture";
const baseTime = new Date("2026-05-04T10:00:00.000Z");

const tasks = [
  {
    id: `${taskPrefix}-task-1`,
    taskKey: `${taskPrefix}-requirement`,
    title: "E12 fixture requirement analysis",
    currentNode: "requirement_analysis",
    nodeSubstate: "consult",
    runtimeState: "running",
    status: "reviewing",
    progress: 20,
    blockedReason: null,
    reviewStatus: null
  },
  {
    id: `${taskPrefix}-task-2`,
    taskKey: `${taskPrefix}-design`,
    title: "E12 fixture technical design",
    currentNode: "technical_design",
    nodeSubstate: "drafting",
    runtimeState: "running",
    status: "reviewing",
    progress: 40,
    blockedReason: null,
    reviewStatus: null
  },
  {
    id: `${taskPrefix}-task-3`,
    taskKey: `${taskPrefix}-implementation`,
    title: "E12 fixture implementation",
    currentNode: "implementation",
    nodeSubstate: "receipt_ready",
    runtimeState: "running",
    status: "reviewing",
    progress: 70,
    blockedReason: null,
    reviewStatus: null
  },
  {
    id: `${taskPrefix}-task-4`,
    taskKey: `${taskPrefix}-review`,
    title: "E12 fixture review with fallback",
    currentNode: "review",
    nodeSubstate: "blocked",
    runtimeState: "blocked",
    status: "reviewing",
    progress: 80,
    blockedReason: "capability fallback requires review",
    reviewStatus: "needs_followup"
  },
  {
    id: `${taskPrefix}-task-5`,
    taskKey: `${taskPrefix}-archive`,
    title: "E12 fixture archive",
    currentNode: "archive",
    nodeSubstate: "done",
    runtimeState: "completed",
    status: "done",
    progress: 100,
    blockedReason: null,
    reviewStatus: "passed"
  }
] as const;

async function main(): Promise<void> {
  await prisma.project.upsert({
    where: {
      id: projectId
    },
    update: {
      name: "E12 Acceptance Fixture",
      localPath: projectPath,
      summary: "Deterministic fixture for E12 screenshot and trace acceptance.",
      initStatus: "initialized",
      syncStatus: "idle",
      lastScanAt: baseTime
    },
    create: {
      id: projectId,
      name: "E12 Acceptance Fixture",
      localPath: projectPath,
      summary: "Deterministic fixture for E12 screenshot and trace acceptance.",
      initStatus: "initialized",
      syncStatus: "idle",
      lastScanAt: baseTime
    }
  });

  await seedDocuments();
  await seedRequirements();
  await seedTasks();
  await seedReviewRounds();
  await seedEvents();
  await seedNodeRuns();
  await seedCapabilityStatus();

  console.log("E12 fixture seeded: 5 tasks, 3 rounds, 2 fallback events");
}

async function seedDocuments(): Promise<void> {
  for (const task of tasks) {
    const path = `docs/03_开发计划/${task.taskKey}-开发任务.md`;
    const status = task.status;

    await prisma.document.upsert({
      where: {
        projectId_path: {
          projectId,
          path
        }
      },
      update: {
        taskKey: task.taskKey,
        kind: "dev_task",
        title: task.title,
        status,
        summary: `Acceptance document for ${task.taskKey}.`,
        contentHash: `${task.taskKey}-hash`,
        mtime: baseTime,
        parseStatus: "success"
      },
      create: {
        id: `${task.id}-doc`,
        projectId,
        taskKey: task.taskKey,
        path,
        kind: "dev_task",
        title: task.title,
        status,
        summary: `Acceptance document for ${task.taskKey}.`,
        contentHash: `${task.taskKey}-hash`,
        mtime: baseTime,
        parseStatus: "success"
      }
    });
  }
}

async function seedRequirements(): Promise<void> {
  await prisma.requirement.upsert({
    where: {
      id: `${taskPrefix}-requirement`
    },
    update: {
      title: "E12 acceptance trace view",
      description: "Provide deterministic data for console v2 trace acceptance.",
      status: "delivering",
      generatedTaskId: tasks[0].id,
      verbatimSource: "Show the user where tasks are, what happened, and which capabilities fell back."
    },
    create: {
      id: `${taskPrefix}-requirement`,
      projectId,
      title: "E12 acceptance trace view",
      description: "Provide deterministic data for console v2 trace acceptance.",
      status: "delivering",
      source: "manual",
      generatedTaskId: tasks[0].id,
      verbatimSource: "Show the user where tasks are, what happened, and which capabilities fell back."
    }
  });
}

async function seedTasks(): Promise<void> {
  for (const [index, task] of tasks.entries()) {
    await prisma.task.upsert({
      where: {
        projectId_taskKey: {
          projectId,
          taskKey: task.taskKey
        }
      },
      update: {
        title: task.title,
        summary: `E12 fixture task ${index + 1}.`,
        status: task.status,
        currentNode: task.currentNode,
        nodeSubstate: task.nodeSubstate,
        runtimeState: task.runtimeState,
        lastTransitionId: `${task.currentNode}__fixture_transition`,
        priority: index === 3 ? "high" : "medium",
        progress: task.progress,
        blockedReason: task.blockedReason,
        reviewStatus: task.reviewStatus,
        requirementId: `${taskPrefix}-requirement`,
        verificationResultJson: JSON.stringify({ build: "pass", test: "pass" }),
        reviewFollowupJson: JSON.stringify(index === 3 ? ["Review fallback path"] : [])
      },
      create: {
        id: task.id,
        projectId,
        taskKey: task.taskKey,
        title: task.title,
        summary: `E12 fixture task ${index + 1}.`,
        status: task.status,
        currentNode: task.currentNode,
        nodeSubstate: task.nodeSubstate,
        runtimeState: task.runtimeState,
        lastTransitionId: `${task.currentNode}__fixture_transition`,
        priority: index === 3 ? "high" : "medium",
        progress: task.progress,
        blockedReason: task.blockedReason,
        reviewStatus: task.reviewStatus,
        requirementId: `${taskPrefix}-requirement`,
        verificationResultJson: JSON.stringify({ build: "pass", test: "pass" }),
        reviewFollowupJson: JSON.stringify(index === 3 ? ["Review fallback path"] : [])
      }
    });
  }
}

async function seedReviewRounds(): Promise<void> {
  const task = tasks[1];
  for (const roundNumber of [1, 2, 3]) {
    await prisma.reviewIntent.upsert({
      where: {
        id: `${taskPrefix}-intent-${roundNumber}`
      },
      update: {
        payloadJson: JSON.stringify({
          round_number: roundNumber,
          node_id: task.currentNode,
          intent: `e12_acceptance_round_${roundNumber}`,
          intent_score: 8 + roundNumber / 10,
          tokens_in: 2000 + roundNumber,
          tokens_out: 400 + roundNumber
        }),
        status: "consumed",
        createdAt: addMinutes(baseTime, roundNumber)
      },
      create: {
        id: `${taskPrefix}-intent-${roundNumber}`,
        projectId,
        taskId: task.id,
        taskKey: task.taskKey,
        intentType: "request_replan",
        payloadJson: JSON.stringify({
          round_number: roundNumber,
          node_id: task.currentNode,
          intent: `e12_acceptance_round_${roundNumber}`,
          intent_score: 8 + roundNumber / 10,
          tokens_in: 2000 + roundNumber,
          tokens_out: 400 + roundNumber
        }),
        status: "consumed",
        createdAt: addMinutes(baseTime, roundNumber)
      }
    });
  }
}

async function seedEvents(): Promise<void> {
  const designTask = tasks[1];
  for (const roundNumber of [1, 2, 3]) {
    await upsertEvent({
      eventId: `${taskPrefix}-codex-round-${roundNumber}`,
      eventType: "codex_receipt_ready",
      taskId: designTask.id,
      taskKey: designTask.taskKey,
      payloadJson: JSON.stringify({
        receipt_ref: `docs/.ccb/receipts/${taskPrefix}-round-${roundNumber}.md`,
        provider: "codex",
        receipt_summary: `E12 fixture round ${roundNumber} complete.`
      }),
      emittedAt: addMinutes(baseTime, 10 + roundNumber),
      sourceActor: "codex",
      sourceComponent: "fixture",
      correlationId: `${taskPrefix}-intent-${roundNumber}`
    });
  }

  await upsertEvent({
    eventId: `${taskPrefix}-transition-implementation-review`,
    eventType: "transition.applied",
    taskId: tasks[2].id,
    taskKey: tasks[2].taskKey,
    payloadJson: JSON.stringify({
      source: "implementation",
      target: "review"
    }),
    emittedAt: addMinutes(baseTime, 20),
    sourceActor: "system",
    sourceComponent: "fixture"
  });

  await upsertEvent({
    eventId: `${taskPrefix}-fallback-analysis-deep`,
    eventType: "capability.fallback",
    taskId: tasks[3].id,
    taskKey: tasks[3].taskKey,
    payloadJson: JSON.stringify({
      cap_id: "analysis.deep_design",
      provider: "claude_native_design"
    }),
    emittedAt: addMinutes(baseTime, 21),
    sourceActor: "system",
    sourceComponent: "fixture"
  });

  await upsertEvent({
    eventId: `${taskPrefix}-fallback-verification`,
    eventType: "capability.fallback",
    taskId: tasks[3].id,
    taskKey: tasks[3].taskKey,
    payloadJson: JSON.stringify({
      cap_id: "quality.verification",
      provider: "claude_native_verification"
    }),
    emittedAt: addMinutes(baseTime, 22),
    sourceActor: "system",
    sourceComponent: "fixture"
  });
}

async function seedNodeRuns(): Promise<void> {
  await prisma.nodeRun.upsert({
    where: {
      id: `${taskPrefix}-noderun-review`
    },
    update: {
      nodeId: "review",
      enteredAt: addMinutes(baseTime, 18),
      exitedAt: null,
      transitionsJson: JSON.stringify([
        {
          from_node: "implementation",
          to_node: "review",
          transition_id: "implementation__on_receipt_ready__to__review",
          triggered_at: addMinutes(baseTime, 20).toISOString()
        }
      ]),
      capabilityDecisionsJson: JSON.stringify([
        {
          capability_requested: "analysis.deep_design",
          resolved_binding: "claude_native_design",
          decision_at: addMinutes(baseTime, 21).toISOString(),
          old_hint_fallback_count: 1
        },
        {
          capability_requested: "quality.verification",
          resolved_binding: "claude_native_verification",
          decision_at: addMinutes(baseTime, 22).toISOString(),
          outcome: "fallback"
        },
        {
          capability_requested: "gate.user_decision",
          resolved_binding: null,
          decision_at: addMinutes(baseTime, 23).toISOString()
        }
      ])
    },
    create: {
      id: `${taskPrefix}-noderun-review`,
      taskId: tasks[3].id,
      version: "noderun-v0.1",
      nodeId: "review",
      enteredAt: addMinutes(baseTime, 18),
      exitedAt: null,
      transitionsJson: JSON.stringify([
        {
          from_node: "implementation",
          to_node: "review",
          transition_id: "implementation__on_receipt_ready__to__review",
          triggered_at: addMinutes(baseTime, 20).toISOString()
        }
      ]),
      capabilityDecisionsJson: JSON.stringify([
        {
          capability_requested: "analysis.deep_design",
          resolved_binding: "claude_native_design",
          decision_at: addMinutes(baseTime, 21).toISOString(),
          old_hint_fallback_count: 1
        },
        {
          capability_requested: "quality.verification",
          resolved_binding: "claude_native_verification",
          decision_at: addMinutes(baseTime, 22).toISOString(),
          outcome: "fallback"
        },
        {
          capability_requested: "gate.user_decision",
          resolved_binding: null,
          decision_at: addMinutes(baseTime, 23).toISOString()
        }
      ])
    }
  });
}

async function seedCapabilityStatus(): Promise<void> {
  const statuses = [
    ["analysis.deep_design", "global", "active"],
    ["quality.verification", "global", "active"],
    ["gate.user_decision", "global", "disabled"]
  ] as const;

  for (const [name, bindingSource, status] of statuses) {
    await prisma.capabilityStatus.upsert({
      where: {
        name_bindingSource: {
          name,
          bindingSource
        }
      },
      update: {
        status,
        lastUsedAt: status === "active" ? baseTime : null
      },
      create: {
        id: `${taskPrefix}-cap-${name.replace(/[^a-z0-9]+/gi, "-")}-${bindingSource}`,
        version: "cap-matrix-v0.1",
        name,
        bindingSource,
        status,
        lastUsedAt: status === "active" ? baseTime : null
      }
    });
  }
}

async function upsertEvent(input: {
  eventId: string;
  eventType: string;
  taskId: string;
  taskKey: string;
  payloadJson: string;
  emittedAt: Date;
  sourceActor: string;
  sourceComponent: string;
  correlationId?: string;
}): Promise<void> {
  await prisma.eventJournal.upsert({
    where: {
      eventId: input.eventId
    },
    update: {
      eventType: input.eventType,
      payloadJson: input.payloadJson,
      emittedAt: input.emittedAt,
      sourceActor: input.sourceActor,
      sourceComponent: input.sourceComponent,
      correlationId: input.correlationId ?? null
    },
    create: {
      eventId: input.eventId,
      eventType: input.eventType,
      projectId,
      taskId: input.taskId,
      taskKey: input.taskKey,
      payloadJson: input.payloadJson,
      emittedAt: input.emittedAt,
      sourceActor: input.sourceActor,
      sourceComponent: input.sourceComponent,
      correlationId: input.correlationId
    }
  });
}

function addMinutes(value: Date, minutes: number): Date {
  return new Date(value.getTime() + minutes * 60_000);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
