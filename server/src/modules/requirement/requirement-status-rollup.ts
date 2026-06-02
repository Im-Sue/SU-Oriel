/**
 * Requirement rollup projection helper.
 *
 * ADR-0034: Requirement.status is capability-outcome canonical. Console may
 * refresh derived rollupStatus/rollupProgress only.
 */

import type { Prisma, PrismaClient } from "@prisma/client";

import { primitiveExecutor } from "../primitive/primitive-wrapper.js";
import { computeRequirementAggregation, type AggregationClient } from "../task/progress-aggregation.js";

export type RollupClient = PrismaClient | Prisma.TransactionClient;

export interface RollupResult {
  attempted: boolean;
  updated: boolean;
  requirementId: string | null;
  oldStatus: string | null;
  newStatus: string | null;
  reason?: "no_requirement" | "no_change" | "user_locked" | "missing_aggregation";
}

/**
 * 解析 task 关联的 requirementId。
 *
 * ADR-0013 §1.1 invariant 保证：所有 subtask/epic 都有 requirementId（不为 null）。
 * 因此直接读 task.requirementId 即可，无需 epic 链路 fallback。
 */
async function resolveRequirementId(client: RollupClient, taskId: string): Promise<string | null> {
  const task = await client.task.findUnique({
    where: { id: taskId },
    select: { requirementId: true }
  });
  return task?.requirementId ?? null;
}

/**
 * 任务状态变更后刷新其 parent requirement 的 rollup projection。
 *
 * - 仅在 computed rollup 与 DB 字段不一致时 update（写放大最小）
 * - aggregation 已尊重 cancelled/deferred canonical status
 * - 调用方负责把 tx client 传进来，本函数不创建 tx
 */
export async function rollupRequirementStatusFromTask(
  client: RollupClient,
  taskId: string
): Promise<RollupResult> {
  const requirementId = await resolveRequirementId(client, taskId);
  if (!requirementId) {
    return { attempted: false, updated: false, requirementId: null, oldStatus: null, newStatus: null, reason: "no_requirement" };
  }
  return await rollupRequirementStatusById(client, requirementId);
}

/**
 * 直接按 requirementId 刷新 rollup projection（UI 单条刷新用）。
 */
export async function rollupRequirementStatusById(
  client: RollupClient,
  requirementId: string
): Promise<RollupResult> {
  const aggregation = await computeRequirementAggregation(client as AggregationClient, requirementId);
  if (!aggregation) {
    return {
      attempted: true,
      updated: false,
      requirementId,
      oldStatus: null,
      newStatus: null,
      reason: "missing_aggregation"
    };
  }
  const current = await client.requirement.findUnique({
    where: { id: requirementId },
    select: { status: true, rollupStatus: true, rollupProgress: true }
  });
  if (!current) {
    return {
      attempted: true,
      updated: false,
      requirementId,
      oldStatus: null,
      newStatus: aggregation.status,
      reason: "missing_aggregation"
    };
  }
  if (
    current.rollupStatus === aggregation.status &&
    current.rollupProgress === aggregation.progress
  ) {
    return {
      attempted: true,
      updated: false,
      requirementId,
      oldStatus: current.status,
      newStatus: aggregation.status,
      reason: "no_change"
    };
  }
  await primitiveExecutor.run({
    primitive: "rollup_requirement_status",
    mutationType: "prisma.requirement.update",
    // idempotencyKey 必须含派生结果(status/progress);否则 primitiveExecutor 持久缓存
    // 会让 rollup 只写一次、之后聚合变化的 update 被当重复跳过(rollupStatus 冻结)。
    idempotencyKey: `${requirementId}:rollup_requirement_status:${aggregation.status}:${aggregation.progress}`,
    run: async () =>
      await client.requirement.update({
        where: { id: requirementId },
        data: {
          rollupStatus: aggregation.status,
          rollupProgress: aggregation.progress
        }
      })
  });
  return {
    attempted: true,
    updated: true,
    requirementId,
    oldStatus: current.status,
    newStatus: aggregation.status
  };
}

/**
 * 项目内所有 requirement 批量回写（indexer scan 末尾 + UI 项目级刷新按钮用）。
 */
export async function rollupAllRequirementsForProject(
  client: RollupClient,
  projectId: string
): Promise<{ updated: number; checked: number; results: RollupResult[] }> {
  const requirements = await client.requirement.findMany({
    where: { projectId },
    select: { id: true }
  });
  const results: RollupResult[] = [];
  for (const req of requirements) {
    const result = await rollupRequirementStatusById(client, req.id);
    results.push(result);
  }
  return {
    updated: results.filter((r) => r.updated).length,
    checked: results.length,
    results
  };
}
