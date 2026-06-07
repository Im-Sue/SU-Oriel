/**
 * d21ff1/pr7 最终 smoke:隔离临时 ccb 项目 + route 层直驱 resize 全序列。
 *
 * 序列:grow → 绑定需求到新 slot(置 busy)→ shrink 被拒 → 释放 → shrink 成功 → 再 grow。
 * 三验证点:pane ready / 扩回旧会话不恢复(pane id 变化+agents 目录保留)/ 其他 slot 无中断(pane id 稳定)。
 *
 * 一次性验收脚本:不进测试套件,执行后自清理(ccb kill -f + rm 临时目录)。
 * 用法:cd server && DATABASE_URL=ignored pnpm tsx scripts/d21ff1-pr7-smoke.ts
 */

import { execSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const stamp = (label: string, detail: string) => {
  console.log(`[smoke] ${label}: ${detail}`);
};

const root = mkdtempSync(join(tmpdir(), "d21ff1-pr7-smoke-"));
const projectRoot = join(root, "project");
const dbPath = join(root, "smoke.db");
mkdirSync(join(projectRoot, ".ccb"), { recursive: true });

process.env.DATABASE_URL = `file:${dbPath}`;
delete process.env.VITEST;

const tmuxSock = join(projectRoot, ".ccb", "ccbd", "tmux.sock");

function panes(): Map<string, string> {
  const result = spawnSync("tmux", ["-S", tmuxSock, "list-panes", "-a", "-F", "#{window_name}|#{pane_id}"], {
    encoding: "utf8"
  });
  const map = new Map<string, string>();
  if (result.status !== 0) return map;
  for (const line of result.stdout.trim().split("\n")) {
    const [windowName, paneId] = line.split("|");
    if (windowName && paneId && windowName.startsWith("slot-")) {
      // 每个 slot window 有 sidebar+agent panes;记录首个 pane id 作为窗口指纹
      if (!map.has(windowName)) map.set(windowName, paneId);
    }
  }
  return map;
}

async function main() {
  // 1. 生成 3-slot managed config 并落盘
  const { renderManagedCcbConfig, projectSlotTopology } = await import(
    "../src/modules/project-ccbd/managed-config.service.js"
  );
  const seedProjectId = "smoke-project";
  const initial = renderManagedCcbConfig({
    projectId: seedProjectId,
    projectRoot,
    topology: projectSlotTopology(3),
    existingConfigText: null,
    slotAgentOverridesJson: null
  });
  writeFileSync(join(projectRoot, ".ccb", "ccb.config"), initial.configText, "utf8");
  stamp("setup", `projectRoot=${projectRoot} 3-slot managed config written`);

  // 2. 空库建 schema(普通 db push,无破坏 flags)
  execSync(`pnpm prisma db push --schema prisma/schema.prisma --skip-generate`, {
    cwd: join(process.cwd()),
    env: { ...process.env },
    stdio: "pipe"
  });
  stamp("setup", "smoke.db schema pushed");

  // 3. 启动隔离 ccbd
  execSync("ccb", { cwd: projectRoot, stdio: "pipe", timeout: 120_000 });
  stamp("setup", "isolated ccb started");
  const basePanes = panes();
  stamp("baseline", `panes=${JSON.stringify([...basePanes.entries()])}`);
  if (basePanes.size !== 3) throw new Error(`expected 3 slot windows at baseline, got ${basePanes.size}`);

  // 4. 种子数据 + app
  const { prisma } = await import("../src/db/prisma.js");
  const { buildApp } = await import("../src/app.js");
  const project = await prisma.project.create({
    data: { name: "d21ff1 pr7 smoke", localPath: projectRoot, slotCount: 3 }
  });
  const requirement = await prisma.requirement.create({
    data: { projectId: project.id, title: "smoke requirement", description: "occupies tail slot" }
  });
  const app = buildApp({ enableFileWatcher: false, fileWatcherService: null, startupProjectScan: null });
  await app.ready();

  const record: string[] = [];
  const post = async (direction: "grow" | "shrink") =>
    await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/slots/resize`,
      payload: { direction }
    });

  // 5. grow → slot-4 pane ready
  const grow1 = await post("grow");
  if (grow1.statusCode !== 200) throw new Error(`grow#1 failed: ${grow1.statusCode} ${grow1.body}`);
  const afterGrow1 = panes();
  const slot4PaneA = afterGrow1.get("slot-4");
  record.push(`grow#1 -> 200, mode=${grow1.json().resize.mode}, slot-4 pane=${slot4PaneA ?? "MISSING"}`);
  if (!slot4PaneA) throw new Error("VERIFY-1 pane ready FAILED: slot-4 pane missing after grow");
  stamp("VERIFY-1", `pane ready: slot-4 pane ${slot4PaneA} exists`);

  // 6. 绑定需求到 slot-4 并置 busy → shrink 应被拒
  await prisma.slotBinding.create({
    data: {
      projectId: project.id,
      slotId: "slot-4",
      requirementId: requirement.id,
      state: "busy",
      boundAt: new Date()
    }
  });
  const shrinkRejected = await post("shrink");
  const rejectedBody = shrinkRejected.json();
  record.push(`shrink#1 (slot-4 busy) -> ${shrinkRejected.statusCode}, reason=${rejectedBody.reason}`);
  if (shrinkRejected.statusCode !== 409 || rejectedBody.reason !== "slot_not_idle") {
    throw new Error(`expected 409 slot_not_idle, got ${shrinkRejected.statusCode} ${shrinkRejected.body}`);
  }
  stamp("step", `shrink rejected as expected: ${rejectedBody.reason}`);

  // 7. 释放 → shrink 成功
  await prisma.slotBinding.deleteMany({ where: { projectId: project.id, slotId: "slot-4" } });
  const shrinkOk = await post("shrink");
  if (shrinkOk.statusCode !== 200) throw new Error(`shrink#2 failed: ${shrinkOk.statusCode} ${shrinkOk.body}`);
  const afterShrink = panes();
  record.push(`shrink#2 -> 200, mode=${shrinkOk.json().resize.mode}, slot-4 pane=${afterShrink.get("slot-4") ?? "removed"}`);
  if (afterShrink.has("slot-4")) throw new Error("slot-4 window still present after shrink");

  // 8. 再 grow → 新 pane id ≠ 旧 pane id(扩回旧会话不恢复)
  const grow2 = await post("grow");
  if (grow2.statusCode !== 200) throw new Error(`grow#2 failed: ${grow2.statusCode} ${grow2.body}`);
  const afterGrow2 = panes();
  const slot4PaneB = afterGrow2.get("slot-4");
  record.push(`grow#2 -> 200, slot-4 pane=${slot4PaneB ?? "MISSING"} (was ${slot4PaneA})`);
  if (!slot4PaneB) throw new Error("slot-4 pane missing after grow-back");
  if (slot4PaneB === slot4PaneA) throw new Error("VERIFY-2 FAILED: grow-back reused old pane (session restore?)");
  const agentsDirKept = existsSync(join(projectRoot, ".ccb", "agents", "slot4_claude"));
  stamp(
    "VERIFY-2",
    `grow-back no session restore: new pane ${slot4PaneB} ≠ old ${slot4PaneA}; agents dir kept on disk=${agentsDirKept}(by design)`
  );

  // 9. 其他 slot 无中断:slot-1..3 pane id 全程稳定
  for (const slotId of ["slot-1", "slot-2", "slot-3"]) {
    const before = basePanes.get(slotId);
    const after = afterGrow2.get(slotId);
    if (!before || before !== after) {
      throw new Error(`VERIFY-3 FAILED: ${slotId} pane changed (${before} -> ${after})`);
    }
  }
  stamp("VERIFY-3", `other slots uninterrupted: slot-1..3 pane ids stable ${JSON.stringify([...basePanes.entries()])}`);

  // 10. 终态 DB 校验
  const finalProject = await prisma.project.findUnique({ where: { id: project.id } });
  record.push(`final slotCount=${finalProject?.slotCount}`);
  if (finalProject?.slotCount !== 4) throw new Error(`expected final slotCount 4, got ${finalProject?.slotCount}`);

  await app.close();
  await prisma.$disconnect();
  console.log("\n=== SMOKE RECORD ===");
  for (const line of record) console.log(line);
  console.log("=== ALL VERIFY POINTS PASSED ===");
}

let failed = false;
try {
  await main();
} catch (error) {
  failed = true;
  console.error("[smoke] FAILED:", error);
} finally {
  try {
    execSync("ccb kill -f", { cwd: projectRoot, stdio: "pipe", timeout: 60_000 });
    stamp("teardown", "ccb kill -f done");
  } catch {
    stamp("teardown", "ccb kill -f skipped/failed");
  }
  rmSync(root, { recursive: true, force: true });
  stamp("teardown", `removed ${root}`);
}
process.exit(failed ? 1 : 0);
