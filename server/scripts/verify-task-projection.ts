/**
 * verify-task-projection
 *
 * 用法：npx tsx scripts/verify-task-projection.ts [--scan] [--project <id>]
 *
 * 不带参数：只产出 anomaly 报告，不写 DB。
 * --scan：先触发一次 scanProject（依赖 ADR-0012 indexer 合并算法收敛数据）。
 * --project <id>：指定单个项目 ID；缺省时遍历所有项目。
 *
 * 输出：每个项目一份 docs/.ccb/index/task-projection-verification.yaml，
 *      路径基于项目 localPath；若项目内不存在 docs/.ccb/index/ 则跳过写入。
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import type { PrismaClient } from "@prisma/client";

import { prisma } from "../src/db/prisma.js";
import { scanProject } from "../src/indexer/project-indexer.js";

interface Anomaly {
  category: string;
  taskKey: string | null;
  taskId: string | null;
  detail: Record<string, unknown>;
}

async function collectAnomalies(prisma: PrismaClient, projectId: string): Promise<Anomaly[]> {
  const anomalies: Anomaly[] = [];

  // 1. 子任务已进入生命周期状态但 currentNode 缺失
  const noNodeTasks = await prisma.task.findMany({
    where: { projectId, status: "reviewing", currentNode: null },
    select: { id: true, taskKey: true, title: true }
  });
  for (const t of noNodeTasks) {
    anomalies.push({
      category: "currentNode_null",
      taskKey: t.taskKey,
      taskId: t.id,
      detail: { title: t.title }
    });
  }

  return anomalies;
}

function escapeYamlString(s: string): string {
  if (/^[A-Za-z0-9_\-./:]+$/.test(s)) return s;
  return `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function emitYaml(report: {
  projectId: string;
  generatedAt: string;
  taskCount: number;
  documentCount: number;
  anomalies: Anomaly[];
}): string {
  const lines: string[] = [];
  lines.push(`schema_version: task-projection-verification-v1`);
  lines.push(`project_id: ${escapeYamlString(report.projectId)}`);
  lines.push(`generated_at: ${escapeYamlString(report.generatedAt)}`);
  lines.push(`task_count: ${report.taskCount}`);
  lines.push(`document_count: ${report.documentCount}`);
  lines.push(`anomaly_count: ${report.anomalies.length}`);
  if (report.anomalies.length === 0) {
    lines.push(`anomalies: []`);
  } else {
    lines.push(`anomalies:`);
    for (const a of report.anomalies) {
      lines.push(`  - category: ${escapeYamlString(a.category)}`);
      lines.push(`    task_key: ${a.taskKey ? escapeYamlString(a.taskKey) : "null"}`);
      lines.push(`    task_id: ${a.taskId ? escapeYamlString(a.taskId) : "null"}`);
      lines.push(`    detail: ${escapeYamlString(JSON.stringify(a.detail))}`);
    }
  }
  return lines.join("\n") + "\n";
}

async function main() {
  const args = process.argv.slice(2);
  const shouldScan = args.includes("--scan");
  const projectArgIdx = args.indexOf("--project");
  const projectIdArg = projectArgIdx >= 0 ? args[projectArgIdx + 1] : null;

  try {
    const projects = projectIdArg
      ? await prisma.project.findMany({ where: { id: projectIdArg } })
      : await prisma.project.findMany();

    if (projects.length === 0) {
      console.log("no projects found");
      return;
    }

    for (const project of projects) {
      console.log(`\n=== project: ${project.name} (${project.id}) localPath=${project.localPath}`);

      if (shouldScan) {
        console.log(`  triggering scanProject...`);
        const result = await scanProject(prisma, project.id);
        console.log(`  scan done: documents=${result.documentCount} tasks=${result.taskCount}`);
      }

      const taskCount = await prisma.task.count({ where: { projectId: project.id } });
      const documentCount = await prisma.document.count({ where: { projectId: project.id } });
      const anomalies = await collectAnomalies(prisma, project.id);

      console.log(`  task=${taskCount} document=${documentCount} anomaly=${anomalies.length}`);
      const byCategory = new Map<string, number>();
      for (const a of anomalies) {
        byCategory.set(a.category, (byCategory.get(a.category) ?? 0) + 1);
      }
      for (const [cat, n] of byCategory) {
        console.log(`    ${cat}: ${n}`);
      }

      const reportYaml = emitYaml({
        projectId: project.id,
        generatedAt: new Date().toISOString(),
        taskCount,
        documentCount,
        anomalies
      });

      const indexDir = join(project.localPath, "docs", ".ccb", "index");
      const reportPath = join(indexDir, "task-projection-verification.yaml");
      if (existsSync(indexDir)) {
        await writeFile(reportPath, reportYaml, "utf8");
        console.log(`  wrote ${reportPath}`);
      } else {
        console.log(`  skip write (no docs/.ccb/index/ in ${project.localPath})`);
      }
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
