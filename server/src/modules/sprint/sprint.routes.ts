/**
 * Phase C: Sprint / 迭代 routes (TAPD-inspired)
 *
 * GET    /api/projects/:projectId/sprints      列表
 * POST   /api/projects/:projectId/sprints      创建
 * GET    /api/sprints/:sprintId                详情 + tasks
 * PATCH  /api/sprints/:sprintId                更新 (rename, status, dates, capacity)
 * POST   /api/sprints/:sprintId/tasks/:taskId  把 task 加入 sprint
 * DELETE /api/sprints/:sprintId/tasks/:taskId  从 sprint 移出 task
 * GET    /api/sprints/:sprintId/burndown       燃尽数据
 */

import type { FastifyInstance } from "fastify";
import type { Sprint, Task } from "@prisma/client";

import { prisma } from "../../db/prisma.js";
import { primitiveExecutor } from "../primitive/primitive-wrapper.js";

function serializeSprint(sprint: Sprint, taskCount = 0, completedCount = 0, remainingPoints = 0) {
  return {
    id: sprint.id,
    projectId: sprint.projectId,
    name: sprint.name,
    goal: sprint.goal,
    status: sprint.status,
    startDate: sprint.startDate?.toISOString() ?? null,
    endDate: sprint.endDate?.toISOString() ?? null,
    capacity: sprint.capacity,
    taskCount,
    completedCount,
    remainingPoints,
    createdAt: sprint.createdAt.toISOString(),
    updatedAt: sprint.updatedAt.toISOString()
  };
}

function computeRemainingPoints(tasks: Pick<Task, "currentNode" | "status" | "storyPoints" | "progress">[]): number {
  return tasks.reduce((acc, task) => {
    if (task.status === "cancelled" || task.currentNode === "archive") return acc;
    const points = task.storyPoints ?? 1;
    const remaining = Math.max(0, points * (1 - task.progress / 100));
    return acc + remaining;
  }, 0);
}

interface BurndownPoint {
  date: string;  // YYYY-MM-DD
  remainingPoints: number;
  totalPoints: number;
}

function generateBurndownPoints(sprint: Sprint, tasks: Task[]): BurndownPoint[] {
  // v1: 简化版 - 按 sprint 起止日期生成点，每个点用当前 task progress 推算
  // 真实历史 snapshot 需要 daily cron 写 burndownDataJson；本期暂用 ideal line + actual current
  const points: BurndownPoint[] = [];
  const start = sprint.startDate ?? sprint.createdAt;
  const end = sprint.endDate ?? new Date();
  const totalPoints = tasks.reduce((acc, t) => acc + (t.storyPoints ?? 1), 0);
  const currentRemaining = computeRemainingPoints(tasks);

  const startMs = start.getTime();
  const endMs = end.getTime();
  if (endMs <= startMs) {
    return [
      { date: start.toISOString().slice(0, 10), remainingPoints: totalPoints, totalPoints },
      { date: end.toISOString().slice(0, 10), remainingPoints: currentRemaining, totalPoints }
    ];
  }
  const days = Math.max(1, Math.ceil((endMs - startMs) / (24 * 3600 * 1000)));
  const today = Date.now();

  // ideal: linearly burndown
  for (let i = 0; i <= days; i++) {
    const dayMs = startMs + i * 24 * 3600 * 1000;
    const ideal = totalPoints * (1 - i / days);
    const isPast = dayMs <= today;
    points.push({
      date: new Date(dayMs).toISOString().slice(0, 10),
      remainingPoints: isPast && i === days ? currentRemaining : Math.round(ideal * 10) / 10,
      totalPoints
    });
  }
  return points;
}

export async function registerSprintRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/projects/:projectId/sprints", async (request) => {
    const { projectId } = request.params as { projectId: string };
    const sprints = await prisma.sprint.findMany({
      where: { projectId },
      orderBy: { createdAt: "desc" },
      include: { tasks: { select: { currentNode: true, status: true, storyPoints: true, progress: true } } }
    });
    return {
      items: sprints.map((s) =>
        serializeSprint(
          s,
          s.tasks.length,
          s.tasks.filter((t) => t.currentNode === "archive").length,
          computeRemainingPoints(s.tasks)
        )
      )
    };
  });

  app.post("/api/projects/:projectId/sprints", async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    const body = request.body as { name?: string; goal?: string; startDate?: string; endDate?: string; capacity?: number };
    const sprintName = body.name?.trim();
    if (!sprintName) {
      reply.status(400);
      return { message: "迭代名称不能为空" };
    }
    const sprint = await primitiveExecutor.run({
      primitive: "create_sprint",
      mutationType: "prisma.sprint.create",
      idempotencyKey: `${projectId}:create_sprint:${sprintName}`,
      run: async () =>
        await prisma.sprint.create({
          data: {
            projectId,
            name: sprintName,
            goal: body.goal?.trim() ?? null,
            startDate: body.startDate ? new Date(body.startDate) : null,
            endDate: body.endDate ? new Date(body.endDate) : null,
            capacity: body.capacity ?? null
          }
        })
    });
    return serializeSprint(sprint);
  });

  app.get("/api/sprints/:sprintId", async (request, reply) => {
    const { sprintId } = request.params as { sprintId: string };
    const sprint = await prisma.sprint.findUnique({
      where: { id: sprintId },
      include: { tasks: { orderBy: { createdAt: "asc" } } }
    });
    if (!sprint) {
      reply.status(404);
      return { message: "迭代不存在" };
    }
    return {
      ...serializeSprint(
        sprint,
        sprint.tasks.length,
        sprint.tasks.filter((t) => t.currentNode === "archive").length,
        computeRemainingPoints(sprint.tasks)
      ),
      tasks: sprint.tasks
    };
  });

  app.patch("/api/sprints/:sprintId", async (request, reply) => {
    const { sprintId } = request.params as { sprintId: string };
    const body = request.body as { name?: string; goal?: string; status?: string; startDate?: string | null; endDate?: string | null; capacity?: number | null };
    const sprint = await prisma.sprint.findUnique({ where: { id: sprintId } });
    const sprintName = body.name?.trim();
    if (!sprint) {
      reply.status(404);
      return { message: "迭代不存在" };
    }
    const updated = await primitiveExecutor.run({
      primitive: "update_sprint",
      mutationType: "prisma.sprint.update",
      idempotencyKey: `${sprintId}:update_sprint`,
      run: async () =>
        await prisma.sprint.update({
          where: { id: sprintId },
          data: {
            name: sprintName ?? undefined,
            goal: body.goal !== undefined ? body.goal?.trim() ?? null : undefined,
            status: body.status,
            startDate: body.startDate === undefined ? undefined : body.startDate ? new Date(body.startDate) : null,
            endDate: body.endDate === undefined ? undefined : body.endDate ? new Date(body.endDate) : null,
            capacity: body.capacity === undefined ? undefined : body.capacity
          }
        })
    });
    return serializeSprint(updated);
  });

  app.post("/api/sprints/:sprintId/tasks/:taskId", async (request, reply) => {
    const { sprintId, taskId } = request.params as { sprintId: string; taskId: string };
    const sprint = await prisma.sprint.findUnique({ where: { id: sprintId } });
    const task = await prisma.task.findUnique({ where: { id: taskId } });
    if (!sprint || !task) {
      reply.status(404);
      return { message: "迭代或任务不存在" };
    }
    if (task.projectId !== sprint.projectId) {
      reply.status(400);
      return { message: "任务与迭代不在同一个项目" };
    }
    const updated = await primitiveExecutor.run({
      primitive: "assign_task_to_sprint",
      mutationType: "prisma.task.update",
      idempotencyKey: `${taskId}:assign_sprint:${sprintId}`,
      run: async () => await prisma.task.update({ where: { id: taskId }, data: { sprintId } })
    });
    return { taskId: updated.id, sprintId: updated.sprintId };
  });

  app.delete("/api/sprints/:sprintId/tasks/:taskId", async (request, reply) => {
    const { taskId } = request.params as { sprintId: string; taskId: string };
    const task = await prisma.task.findUnique({ where: { id: taskId } });
    if (!task) {
      reply.status(404);
      return { message: "任务不存在" };
    }
    const updated = await primitiveExecutor.run({
      primitive: "remove_task_from_sprint",
      mutationType: "prisma.task.update",
      idempotencyKey: `${taskId}:remove_sprint`,
      run: async () => await prisma.task.update({ where: { id: taskId }, data: { sprintId: null } })
    });
    return { taskId: updated.id, sprintId: updated.sprintId };
  });

  app.get("/api/sprints/:sprintId/burndown", async (request, reply) => {
    const { sprintId } = request.params as { sprintId: string };
    const sprint = await prisma.sprint.findUnique({
      where: { id: sprintId },
      include: { tasks: true }
    });
    if (!sprint) {
      reply.status(404);
      return { message: "迭代不存在" };
    }
    return {
      sprintId,
      points: generateBurndownPoints(sprint, sprint.tasks),
      totalTasks: sprint.tasks.length,
      completedTasks: sprint.tasks.filter((t) => t.currentNode === "archive").length
    };
  });
}
