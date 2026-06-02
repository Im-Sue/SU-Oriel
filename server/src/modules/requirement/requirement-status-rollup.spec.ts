import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import { PrismaClient } from "@prisma/client";

import { primitiveExecutor } from "../primitive/primitive-wrapper.js";
import {
  rollupAllRequirementsForProject,
  rollupRequirementStatusById,
  rollupRequirementStatusFromTask
} from "./requirement-status-rollup.js";

const prisma = new PrismaClient();

describe("requirement-status-rollup", () => {
  let projectId: string;

  beforeAll(async () => {
    const project = await prisma.project.create({
      data: {
        name: `test-req-rollup-${Date.now()}`,
        localPath: `/tmp/test-req-rollup-${Date.now()}`,
        initStatus: "initialized"
      }
    });
    projectId = project.id;
  });

  afterAll(async () => {
    await prisma.task.deleteMany({ where: { projectId } });
    await prisma.requirement.deleteMany({ where: { projectId } });
    await prisma.project.delete({ where: { id: projectId } });
    await prisma.$disconnect();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  async function makeReqWithSubtasks(opts: {
    initialReqStatus: string;
    subtaskNodes: Array<"archive" | "dispatch" | "implementation" | "review">;
    cancelled?: boolean[];
  }) {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const req = await prisma.requirement.create({
      data: {
        projectId,
        title: `test ${suffix}`,
        description: "test",
        status: opts.initialReqStatus,
        source: "test"
      }
    });
    let firstSubtaskId = "";
    for (const [i, node] of opts.subtaskNodes.entries()) {
      const subtask = await prisma.task.create({
        data: {
          projectId,
          taskKey: `test-sub-${suffix}-${i}`,
          title: `sub ${i}`,
          requirementId: req.id,
          currentNode: node,
          progress: node === "archive" ? 100 : 50,
          status: opts.cancelled?.[i] ? "cancelled" : "active"
        }
      });
      firstSubtaskId ||= subtask.id;
    }
    return { reqId: req.id, subtaskId: firstSubtaskId };
  }

  it("subtask 全 archived → rollupStatus 转 delivered 且不改 canonical status", async () => {
    const { reqId } = await makeReqWithSubtasks({
      initialReqStatus: "delivering",
      subtaskNodes: ["archive", "archive"]
    });
    const result = await rollupRequirementStatusById(prisma, reqId);
    expect(result.updated).toBe(true);
    expect(result.oldStatus).toBe("delivering");
    expect(result.newStatus).toBe("delivered");

    const reqAfter = await prisma.requirement.findUnique({ where: { id: reqId } });
    expect(reqAfter?.status).toBe("delivering");
    expect(reqAfter?.rollupStatus).toBe("delivered");
    expect(reqAfter?.rollupProgress).toBe(100);
  });

  it("rollupRequirementStatusById wraps requirement status update in primitive executor", async () => {
    const { reqId } = await makeReqWithSubtasks({
      initialReqStatus: "delivering",
      subtaskNodes: ["archive", "archive"]
    });
    const runSpy = vi.spyOn(primitiveExecutor, "run");

    await rollupRequirementStatusById(prisma, reqId);

    expect(runSpy.mock.calls.some(([input]) => input.primitive === "rollup_requirement_status")).toBe(true);
  });

  it("有子任务在推进 → requirement.status 保持 delivering（无变化）", async () => {
    const { reqId } = await makeReqWithSubtasks({
      initialReqStatus: "delivering",
      subtaskNodes: ["dispatch", "implementation"]
    });
    const result = await rollupRequirementStatusById(prisma, reqId);
    expect(result.updated).toBe(true);
    expect(result.newStatus).toBe("delivering");
    const second = await rollupRequirementStatusById(prisma, reqId);
    expect(second.updated).toBe(false);
    expect(second.reason).toBe("no_change");
  });

  it("用户显式 cancelled 的需求不被覆盖", async () => {
    const { reqId } = await makeReqWithSubtasks({
      initialReqStatus: "cancelled",
      subtaskNodes: ["dispatch"]
    });
    const result = await rollupRequirementStatusById(prisma, reqId);
    expect(result.updated).toBe(true);
    expect(result.newStatus).toBe("cancelled");
    const reqAfter = await prisma.requirement.findUnique({ where: { id: reqId } });
    expect(reqAfter?.status).toBe("cancelled");
    expect(reqAfter?.rollupStatus).toBe("cancelled");
  });

  it("用户 deferred 的需求不被覆盖", async () => {
    const { reqId } = await makeReqWithSubtasks({
      initialReqStatus: "deferred",
      subtaskNodes: ["archive"]
    });
    const result = await rollupRequirementStatusById(prisma, reqId);
    expect(result.updated).toBe(true);
    expect(result.newStatus).toBe("deferred");
    const reqAfter = await prisma.requirement.findUnique({ where: { id: reqId } });
    expect(reqAfter?.status).toBe("deferred");
    expect(reqAfter?.rollupStatus).toBe("deferred");
  });

  it("rollupRequirementStatusFromTask 通过 task.requirementId 解析需求", async () => {
    const { reqId, subtaskId } = await makeReqWithSubtasks({
      initialReqStatus: "delivering",
      subtaskNodes: ["archive"]
    });

    const result = await rollupRequirementStatusFromTask(prisma, subtaskId);
    expect(result.attempted).toBe(true);
    expect(result.requirementId).toBe(reqId);
  });

  it("不存在的 taskId → noop", async () => {
    const result = await rollupRequirementStatusFromTask(prisma, "non-existent-id");
    expect(result.attempted).toBe(false);
    expect(result.reason).toBe("no_requirement");
  });

  it("rollupAllRequirementsForProject 批量回写正确 + idempotent", async () => {
    // 用独立 project 隔离前面 it 的 fixture
    const isolatedProject = await prisma.project.create({
      data: {
        name: `test-rollup-batch-${Date.now()}`,
        localPath: `/tmp/test-rollup-batch-${Date.now()}`,
        initStatus: "initialized"
      }
    });
    try {
      // 故意构造 stale 需求：DB 写 delivering，但子任务全 archived → 应被回写为 delivered
      const staleReq = await prisma.requirement.create({
        data: {
          projectId: isolatedProject.id,
          title: "stale should-be-delivered",
          description: "全 archived 但 status 仍 delivering",
          status: "delivering",
          source: "test"
        }
      });
      await prisma.task.create({
        data: {
          projectId: isolatedProject.id,
          taskKey: `stale-sub-${Date.now()}`,
          title: "stale sub",
          requirementId: staleReq.id,
          currentNode: "archive",
          progress: 100
        }
      });

      const result1 = await rollupAllRequirementsForProject(prisma, isolatedProject.id);
      expect(result1.updated).toBe(1);
      expect(result1.checked).toBe(1);

      const staleAfter = await prisma.requirement.findUnique({ where: { id: staleReq.id } });
      expect(staleAfter?.status).toBe("delivering");
      expect(staleAfter?.rollupStatus).toBe("delivered");

      // idempotent：第二次跑 0 update
      const result2 = await rollupAllRequirementsForProject(prisma, isolatedProject.id);
      expect(result2.updated).toBe(0);
      expect(result2.checked).toBe(1);
    } finally {
      await prisma.task.deleteMany({ where: { projectId: isolatedProject.id } });
      await prisma.requirement.deleteMany({ where: { projectId: isolatedProject.id } });
      await prisma.project.delete({ where: { id: isolatedProject.id } });
    }
  });
});
