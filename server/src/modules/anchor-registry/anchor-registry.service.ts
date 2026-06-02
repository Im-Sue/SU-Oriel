import { existsSync, statSync } from "node:fs";

import type { AnchorAllocation, PrismaClient } from "@prisma/client";

import type { MultiAnchorBrokerService } from "../anchor-broker/broker.service.js";

// "destroyed" 是已归档终态；recovery 扫描忽略它。
// 其余 active states 由 AnchorAllocationState enum 自动覆盖。
const TERMINAL_STATES = ["destroyed"] as const;

/**
 * 最近一次 heartbeat 超过此阈值即视为 ccbd 失联（默认 5 分钟）。
 * 启动时 anchor-registry 用此判断已 mount 的 anchor 是否需要标 orphaned。
 */
const STALE_HEARTBEAT_MS = 5 * 60 * 1000;

export type AnchorRecoveryAction =
  | { anchorId: string; action: "kept"; reason: string }
  | { anchorId: string; action: "marked_orphaned"; reason: string }
  | { anchorId: string; action: "marked_mount_failed"; reason: string };

export interface AnchorRegistryServiceLike {
  recoverOnStartup(): Promise<AnchorRecoveryAction[]>;
}

/**
 * AnchorRegistryService —— Console 启动时的 anchor 状态恢复服务。
 *
 * 当 Console 进程崩溃重启时，AnchorAllocation 中可能存在状态与现场不一致的 anchor：
 *
 * - 进程当时是 ready/busy，但 ccbd daemon 已经死了（socket 不在 / heartbeat 过期）
 * - 进程当时正在 mounting，但中途崩了 worktree/ccbd 启动未完成
 *
 * 本服务在 server bootstrap 阶段扫描所有 active 状态的 AnchorAllocation 行，
 * 对照 socket 文件存在性 + heartbeat 时间戳做出 best-effort 决策：
 *
 * - socket 不存在 → 直接标 mount_failed（ccbd 启动从未成功）
 * - socket 存在但 heartbeat 过期 → 标 orphaned（ccbd 可能仍在跑，但已脱钩）
 * - socket 存在且 heartbeat 新鲜 → 保留原状态，broker 后续 rehydrate 会重连
 *
 * 不修复，只标注。后续手动 destroy / cleanup 由 UI 触发。
 */
export class AnchorRegistryService implements AnchorRegistryServiceLike {
  constructor(
    private readonly client: PrismaClient,
    private readonly broker: MultiAnchorBrokerService,
    private readonly now: () => Date = () => new Date()
  ) {}

  async recoverOnStartup(): Promise<AnchorRecoveryAction[]> {
    const rows = await this.client.anchorAllocation.findMany({
      where: { state: { notIn: [...TERMINAL_STATES] } }
    });

    const actions: AnchorRecoveryAction[] = [];
    for (const row of rows) {
      actions.push(await this.classifyAndApply(row));
    }

    // Broker hydration 必须在最终状态决定后跑，避免把 orphaned anchor 注册到 routing 表
    await this.broker.hydrate();
    return actions;
  }

  private async classifyAndApply(row: AnchorAllocation): Promise<AnchorRecoveryAction> {
    if (!row.socketPath) {
      return { anchorId: row.anchorId, action: "kept", reason: "no socket assigned yet" };
    }

    const socketAlive = isSocketAlive(row.socketPath);
    if (!socketAlive) {
      if (row.state === "mount_failed") {
        return { anchorId: row.anchorId, action: "kept", reason: "already mount_failed" };
      }
      await this.client.anchorAllocation.update({
        where: { anchorId: row.anchorId },
        data: { state: "mount_failed", heartbeatAt: this.now() }
      });
      return {
        anchorId: row.anchorId,
        action: "marked_mount_failed",
        reason: `socket ${row.socketPath} not present`
      };
    }

    const heartbeatStale = isHeartbeatStale(row.heartbeatAt, this.now());
    if (heartbeatStale && row.state !== "orphaned") {
      await this.client.anchorAllocation.update({
        where: { anchorId: row.anchorId },
        data: { state: "orphaned" }
      });
      return {
        anchorId: row.anchorId,
        action: "marked_orphaned",
        reason: `heartbeat older than ${STALE_HEARTBEAT_MS / 1000}s`
      };
    }

    return { anchorId: row.anchorId, action: "kept", reason: "socket alive + heartbeat fresh" };
  }
}

function isSocketAlive(socketPath: string): boolean {
  try {
    if (!existsSync(socketPath)) return false;
    const stat = statSync(socketPath);
    return stat.isSocket();
  } catch {
    return false;
  }
}

function isHeartbeatStale(heartbeatAt: Date | null, now: Date): boolean {
  if (!heartbeatAt) return true;
  return now.getTime() - heartbeatAt.getTime() > STALE_HEARTBEAT_MS;
}
