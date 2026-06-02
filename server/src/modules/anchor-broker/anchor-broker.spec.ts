import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { beforeEach, test } from "vitest";

import { prisma } from "../../db/prisma.js";
import { AnchorBrokerErrorCode, CrossAnchorAgentDirectDeniedError } from "./anchor-broker.errors.js";
import { AskRouterService } from "./ask-router.service.js";
import { MultiAnchorBrokerService } from "./broker.service.js";
import { CancelRouterService } from "./cancel-router.service.js";
import { TraceRouterService } from "./trace-router.service.js";

async function resetFixtures(): Promise<void> {
  await prisma.anchorAllocation.deleteMany();
}

async function createAnchor(anchorId: string, anchorPath = join(tmpdir(), `ccb-anchor-${randomUUID()}`)) {
  return await prisma.anchorAllocation.create({
    data: {
      anchorId,
      anchorPath,
      projectId: `project-${anchorId}`,
      socketPath: join(anchorPath, ".ccb", "ccbd", "ccbd.sock"),
      subjectType: "subtask",
      subjectId: `task-${anchorId}`,
      subjectKey: `task-${anchorId}`,
      mode: "execution",
      state: "ready",
      updatedAt: new Date()
    }
  });
}

beforeEach(async () => {
  await resetFixtures();
});

test("MultiAnchorBroker hydrates anchor registry from AnchorAllocation", async () => {
  const row = await createAnchor("anchor-a");
  const broker = new MultiAnchorBrokerService(prisma);

  await broker.hydrate();

  assert.deepEqual(await broker.resolveAnchor("anchor-a"), {
    anchorId: "anchor-a",
    projectId: row.projectId,
    anchorPath: row.anchorPath,
    socketPath: row.socketPath,
    runtimePaused: false
  });
});

test("MultiAnchorBroker preserves runtimePaused when hydrating and resolving anchors", async () => {
  const anchorPath = join(tmpdir(), `ccb-anchor-paused-${randomUUID()}`);
  await prisma.anchorAllocation.create({
    data: {
      anchorId: "anchor-paused",
      anchorPath,
      projectId: "project-paused",
      socketPath: null,
      subjectType: "subtask",
      subjectId: "task-paused",
      subjectKey: "task-paused",
      mode: "execution",
      state: "ready",
      runtimePaused: true,
      updatedAt: new Date()
    }
  });
  const broker = new MultiAnchorBrokerService(prisma);

  await broker.hydrate();

  assert.deepEqual(await broker.resolveAnchor("anchor-paused"), {
    anchorId: "anchor-paused",
    projectId: "project-paused",
    anchorPath,
    socketPath: null,
    runtimePaused: true
  });
});

test("AskRouterService routes broker-mediated cross-anchor ask to the target anchor socket", async () => {
  await createAnchor("anchor-a");
  await createAnchor("anchor-b");
  const calls: unknown[] = [];
  const broker = new MultiAnchorBrokerService(prisma);
  await broker.hydrate();
  const router = new AskRouterService(broker, {
    submit: async (input) => {
      calls.push(input);
      return { jobId: "job-anchor-b", traceRef: "trace-anchor-b" };
    }
  });

  const result = await router.askAcrossAnchor({
    targetAnchorId: "anchor-b",
    toAgent: "ccb_claude",
    taskId: "epic-key",
    body: "/ccb:su-flow",
    fromAnchorId: "anchor-a"
  });

  assert.deepEqual(result, { jobId: "job-anchor-b", traceRef: "trace-anchor-b" });
  assert.deepEqual(calls, [
    {
      anchorId: "anchor-b",
      toAgent: "ccb_claude",
      taskId: "epic-key",
      body: "/ccb:su-flow",
      fromActor: "system",
      messageType: "ask"
    }
  ]);
});

test("AskRouterService rejects direct agent-to-agent cross-anchor ask", async () => {
  const broker = new MultiAnchorBrokerService(prisma);
  const router = new AskRouterService(broker, {
    submit: async () => {
      throw new Error("submit should not be called");
    }
  });

  await assert.rejects(
    () =>
      router.askDirectAgentAcrossAnchor({
        fromAnchorId: "anchor-a",
        fromAgent: "ccb_claude",
        targetAnchorId: "anchor-b",
        toAgent: "ccb_codex",
        taskId: "epic-key",
        body: "direct ask"
      }),
    (error: unknown) =>
      error instanceof CrossAnchorAgentDirectDeniedError &&
      error.code === AnchorBrokerErrorCode.CROSS_ANCHOR_AGENT_DIRECT_DENIED
  );
});

test("control-plane routers send ask, cancel, and trace through the requested anchor", async () => {
  await createAnchor("anchor-a");
  await createAnchor("anchor-b");
  const calls: unknown[] = [];
  const broker = new MultiAnchorBrokerService(prisma);
  await broker.hydrate();
  const client = {
    submit: async (input: unknown) => {
      calls.push({ op: "submit", input });
      return { jobId: "job-anchor-a", traceRef: "trace-anchor-a" };
    },
    cancel: async (jobId: string, opts?: unknown) => {
      calls.push({ op: "cancel", jobId, opts });
      return { cancelled: true };
    },
    trace: async (target: string, opts?: unknown) => {
      calls.push({ op: "trace", target, opts });
      return { target };
    }
  };

  await Promise.all([
    new AskRouterService(broker, client).askAcrossAnchor({
      targetAnchorId: "anchor-a",
      toAgent: "ccb_claude",
      taskId: "epic-a",
      body: "/ccb:su-flow",
      fromAnchorId: "main"
    }),
    new CancelRouterService(broker, client).cancelAcrossAnchor("anchor-a", "job-anchor-a"),
    new TraceRouterService(broker, client).traceAcrossAnchor("anchor-b", "trace-anchor-b")
  ]);

  assert.equal(calls.length, 3);
  assert.deepEqual(calls.find((call) => (call as { op: string }).op === "submit"), {
    op: "submit",
    input: {
      anchorId: "anchor-a",
      toAgent: "ccb_claude",
      taskId: "epic-a",
      body: "/ccb:su-flow",
      fromActor: "system",
      messageType: "ask"
    }
  });
  assert.deepEqual(calls.find((call) => (call as { op: string }).op === "cancel"), {
    op: "cancel",
    jobId: "job-anchor-a",
    opts: { anchorId: "anchor-a" }
  });
  assert.deepEqual(calls.find((call) => (call as { op: string }).op === "trace"), {
    op: "trace",
    target: "trace-anchor-b",
    opts: { anchorId: "anchor-b" }
  });
});
