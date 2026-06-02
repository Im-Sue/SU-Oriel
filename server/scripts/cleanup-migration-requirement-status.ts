/**
 * Slice 1 · 一次性 cleanup 脚本
 *
 * 重算所有 status NOT IN ('cancelled', 'deferred') 的 Requirement.status，
 * 把按 aggregation 应当被回写的旧数据修正一次。
 *
 * 用法：
 *   pnpm tsx scripts/cleanup-migration-requirement-status.ts             # dry-run（默认）
 *   pnpm tsx scripts/cleanup-migration-requirement-status.ts --apply     # 实际执行
 *   pnpm tsx scripts/cleanup-migration-requirement-status.ts --project=<projectId>   # 限定项目
 *
 * 不动 cancelled/deferred（用户显式决策不被覆盖）。
 */

import { PrismaClient } from "@prisma/client";

import { rollupRequirementStatusById } from "../src/modules/requirement/requirement-status-rollup.js";

interface Options {
  apply: boolean;
  projectId?: string;
}

function parseOptions(argv: string[]): Options {
  const opts: Options = { apply: false };
  for (const arg of argv.slice(2)) {
    if (arg === "--apply") opts.apply = true;
    else if (arg.startsWith("--project=")) opts.projectId = arg.slice("--project=".length);
    else if (arg === "--help" || arg === "-h") {
      console.log("用法见文件头注释");
      process.exit(0);
    }
  }
  return opts;
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s.padEnd(n);
  return s.slice(0, n - 1) + "…";
}

async function main(): Promise<void> {
  const opts = parseOptions(process.argv);
  const prisma = new PrismaClient();

  try {
    const where: { status: { notIn: string[] }; projectId?: string } = {
      status: { notIn: ["cancelled", "deferred"] }
    };
    if (opts.projectId) where.projectId = opts.projectId;

    const candidates = await prisma.requirement.findMany({
      where,
      select: { id: true, title: true, status: true, projectId: true }
    });

    console.log(`=== ${opts.apply ? "APPLY" : "dry-run"} · cleanup-migration-requirement-status ===`);
    console.log(`候选 ${candidates.length} 条（status NOT IN cancelled/deferred${opts.projectId ? ` · project=${opts.projectId}` : ""}）`);
    console.log();

    const willUpdate: Array<{
      id: string;
      title: string;
      oldStatus: string;
      newStatus: string;
    }> = [];

    /**
     * 处理一条需求的两步策略：
     *   1. 优先用 rollup helper（progress-aggregation 推算）
     *   2. 若 rollup no_change 且该需求 source='migration' 且 0 子任务 → 视为 stale 占位，归 cancelled
     */
    async function processOne(
      client: typeof prisma | Parameters<Parameters<typeof prisma.$transaction>[0]>[0]
    ): Promise<void> {
      for (const req of candidates) {
        const result = await rollupRequirementStatusById(client, req.id);
        if (result.updated) {
          willUpdate.push({
            id: req.id,
            title: req.title,
            oldStatus: result.oldStatus ?? "?",
            newStatus: result.newStatus ?? "?"
          });
          continue;
        }
        // 孤儿 migration 占位：source='migration' && 0 子任务 → cancelled
        const fullReq = await prisma.requirement.findUnique({
          where: { id: req.id },
          select: { source: true, status: true }
        });
        if (fullReq?.source !== "migration") continue;
        const childCount = await prisma.task.count({ where: { requirementId: req.id } });
        if (childCount > 0) continue;
        if (fullReq.status === "cancelled" || fullReq.status === "deferred") continue;

        await client.requirement.update({
          where: { id: req.id },
          data: { status: "cancelled" }
        });
        willUpdate.push({
          id: req.id,
          title: req.title,
          oldStatus: fullReq.status,
          newStatus: "cancelled"
        });
      }
    }

    if (opts.apply) {
      await processOne(prisma);
    } else {
      // dry-run：临时 tx 内做 update + 故意 rollback
      try {
        await prisma.$transaction(async (tx) => {
          await processOne(tx);
          throw new Error("__DRY_RUN_ROLLBACK__");
        });
      } catch (error) {
        if (!(error instanceof Error) || error.message !== "__DRY_RUN_ROLLBACK__") {
          throw error;
        }
      }
    }

    if (willUpdate.length === 0) {
      console.log("✓ 0 条需求需要更新（已全部对齐 aggregation）");
      return;
    }

    console.log(`| ${"short_id".padEnd(12)} | ${"title".padEnd(40)} | ${"old".padEnd(10)} | ${"new".padEnd(10)} |`);
    console.log(`|${"-".repeat(14)}|${"-".repeat(42)}|${"-".repeat(12)}|${"-".repeat(12)}|`);
    for (const item of willUpdate) {
      console.log(
        `| ${item.id.slice(0, 12).padEnd(12)} | ${truncate(item.title, 40)} | ${item.oldStatus.padEnd(10)} | ${item.newStatus.padEnd(10)} |`
      );
    }
    console.log();
    console.log(`总计 ${opts.apply ? "已更新" : "将更新"}: ${willUpdate.length}`);
    console.log(`未变化: ${candidates.length - willUpdate.length}`);

    if (!opts.apply) {
      console.log();
      console.log("(dry-run only — 加 --apply 实际执行)");
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
