import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";

import { computeProjectAggregations, computeRequirementAggregation } from "./progress-aggregation.js";

const prisma = new PrismaClient();

describe("progress-aggregation", () => {
  let projectId: string;

  beforeAll(async () => {
    const project = await prisma.project.create({
      data: {
        name: "test-progress-agg-fixture",
        localPath: `/tmp/test-progress-agg-${Date.now()}`,
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

  it("returns 0 progress for requirement with no subtasks", async () => {
    const requirement = await prisma.requirement.create({
      data: {
        projectId,
        title: "empty req",
        description: "empty req",
        status: "drafting",
        source: "test"
      }
    });

    const agg = await computeRequirementAggregation(prisma, requirement.id);

    expect(agg).toEqual({
      requirementId: requirement.id,
      status: "drafting",
      progress: 0,
      epicCount: 0,
      directSubtaskCount: 0,
      backlogCount: 0
    });
  });

  it("averages direct subtask progress and reports delivering while work is active", async () => {
    const requirement = await prisma.requirement.create({
      data: {
        projectId,
        title: "active req",
        description: "one dispatch + one archive",
        status: "delivering",
        source: "test"
      }
    });
    await prisma.task.create({
      data: {
        projectId,
        taskKey: `2026-05-19-progress-dispatch-${Date.now()}`,
        title: "in dispatch",
        requirementId: requirement.id,
        currentNode: "dispatch",
        progress: 30
      }
    });
    await prisma.task.create({
      data: {
        projectId,
        taskKey: `2026-05-19-progress-archive-${Date.now()}`,
        title: "archived",
        requirementId: requirement.id,
        currentNode: "archive",
        progress: 100
      }
    });

    const agg = await computeRequirementAggregation(prisma, requirement.id);

    expect(agg?.status).toBe("delivering");
    expect(agg?.progress).toBe(65);
    expect(agg?.directSubtaskCount).toBe(2);
  });

  it("keeps canonical delivering when all valid active subtasks are archived", async () => {
    const requirement = await prisma.requirement.create({
      data: {
        projectId,
        title: "merged preview req",
        description: "archive + legacy backlog",
        status: "delivering",
        source: "test"
      }
    });
    await prisma.task.create({
      data: {
        projectId,
        taskKey: `2026-05-19-progress-archived-${Date.now()}`,
        title: "archived direct",
        requirementId: requirement.id,
        currentNode: "archive",
        progress: 100
      }
    });
    await prisma.task.create({
      data: {
        projectId,
        taskKey: `2026-05-19-progress-backlog-${Date.now()}`,
        title: "future direct",
        requirementId: requirement.id,
        currentNode: "backlog",
        progress: 0
      }
    });

    const agg = await computeRequirementAggregation(prisma, requirement.id);

    expect(agg?.status).toBe("delivering");
    expect(agg?.progress).toBe(50);
    expect(agg?.backlogCount).toBe(1);
  });

  it("mirrors canonical delivered status", async () => {
    const requirement = await prisma.requirement.create({
      data: {
        projectId,
        title: "canonical delivered req",
        description: "archive + canonical delivered",
        status: "delivered",
        source: "test"
      }
    });
    await prisma.task.create({
      data: {
        projectId,
        taskKey: `2026-05-19-progress-canonical-delivered-${Date.now()}`,
        title: "archived direct",
        requirementId: requirement.id,
        currentNode: "archive",
        progress: 100
      }
    });

    const agg = await computeRequirementAggregation(prisma, requirement.id);

    expect(agg?.status).toBe("delivered");
    expect(agg?.progress).toBe(100);
  });

  it("keeps terminal large-state statuses explicit", async () => {
    const requirement = await prisma.requirement.create({
      data: {
        projectId,
        title: "cancelled req",
        description: "explicit cancelled state",
        status: "cancelled",
        source: "test"
      }
    });
    await prisma.task.create({
      data: {
        projectId,
        taskKey: `2026-05-19-progress-cancelled-child-${Date.now()}`,
        title: "archived child",
        requirementId: requirement.id,
        currentNode: "archive",
        progress: 100
      }
    });

    const agg = await computeRequirementAggregation(prisma, requirement.id);

    expect(agg?.status).toBe("cancelled");
    expect(agg?.progress).toBe(100);
  });

  it("project aggregation returns two-layer requirement rollups and no epics", async () => {
    const requirement = await prisma.requirement.create({
      data: {
        projectId,
        title: "project aggregate req",
        description: "project aggregate req",
        status: "drafting",
        source: "test"
      }
    });

    const agg = await computeProjectAggregations(prisma, projectId);

    expect(agg.epics).toEqual([]);
    expect(agg.requirements.some((item) => item.requirementId === requirement.id)).toBe(true);
  });
});
