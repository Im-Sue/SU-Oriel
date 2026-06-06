/**
 * M2-PR3: Progress 聚合 read model (ADR-0013 §3 Progress 算法)
 *
 * Task.progress 字段仅 SubTask 写。
 * Requirement.progress 不存表，按子任务 computed。
 * 边界公式：COUNT=0 → 0；全 cancelled → cancelled & N/A；mixed → 加权。
 */

import type { Prisma, PrismaClient } from "@prisma/client";

export type AggregationClient = PrismaClient | Prisma.TransactionClient;

export interface RequirementAggregation {
  requirementId: string;
  status: "drafting" | "planning" | "delivering" | "delivered" | "deferred" | "cancelled";
  progress: number;
  epicCount: number;
  directSubtaskCount: number;
  /** @deprecated ADR-0020 Step 5 · 保留 1 minor 版本只读兼容。 */
  backlogCount: number;
}

const SUBTASK_WEIGHT = 1;

/**
 * 计算单个 Requirement 的 aggregation
 */
export async function computeRequirementAggregation(
  prisma: AggregationClient,
  requirementId: string
): Promise<RequirementAggregation | null> {
  const req = await prisma.requirement.findUnique({
    where: { id: requirementId },
    select: { id: true, status: true }
  });
  if (!req) return null;

  const directSubtasks = await prisma.task.findMany({
    where: { requirementId },
    select: { id: true, status: true, progress: true, currentNode: true }
  });
  const backlogDirectCount = directSubtasks.filter((s) => s.currentNode === "backlog").length;
  const activeSubtasks = directSubtasks.filter((s) => s.status !== "cancelled");
  const subtaskProgresses = activeSubtasks.map((s) => s.progress ?? 0);
  const backlogCount = backlogDirectCount;

  // 加权平均
  const subtaskWeightTotal = subtaskProgresses.length * SUBTASK_WEIGHT;
  const totalWeight = subtaskWeightTotal;

  let progress = 0;
  if (totalWeight > 0) {
    const weightedSum =
      subtaskProgresses.reduce((acc, p) => acc + p * SUBTASK_WEIGHT, 0);
    progress = Math.round(weightedSum / totalWeight);
  }

  // 状态推算
  // 只看"有效"桶（archive / dispatch|implementation|review / cancelled）；
  // currentNode 缺失或处于规划态（None / requirement_analysis / technical_design / task_breakdown / planning）的子任务
  // 视为"未派工"，不算 in-progress（避免数据脏 / migration 占位长期卡住状态）。
  // delivered 严格镜像 canonical Requirement.status，不再仅凭全子任务 archive 推导。
  let computedStatus = req.status as RequirementAggregation["status"];
  if (req.status !== "cancelled" && req.status !== "deferred" && req.status !== "delivered") {
    const validActiveDirect = directSubtasks.filter(
      (s) =>
        s.status !== "cancelled" &&
        (s.currentNode === "archive" ||
          ["dispatch", "implementation", "review"].includes(s.currentNode ?? ""))
    );
    const archivedDirectCount = validActiveDirect.filter((s) => s.currentNode === "archive").length;
    const inProgressDirectCount = validActiveDirect.length - archivedDirectCount;
    const hasArchive = archivedDirectCount > 0;

    if (inProgressDirectCount > 0 || hasArchive) {
      computedStatus = "delivering";
    }
  }

  return {
    requirementId: req.id,
    status: computedStatus,
    progress,
    epicCount: 0,
    directSubtaskCount: directSubtasks.length,
    backlogCount
  };
}

/**
 * Batch: 计算 project 内所有 Requirement aggregation
 */
export async function computeProjectAggregations(
  prisma: AggregationClient,
  projectId: string
): Promise<{ epics: never[]; requirements: RequirementAggregation[] }> {
  const requirements = await prisma.requirement.findMany({
    where: { projectId },
    select: { id: true }
  });

  const reqAggs = await Promise.all(requirements.map((r) => computeRequirementAggregation(prisma, r.id)));

  return {
    epics: [],
    requirements: reqAggs.filter((a): a is RequirementAggregation => a !== null)
  };
}
