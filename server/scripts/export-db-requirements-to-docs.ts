/**
 * Slice 2 · 一次性 export：把现有 DB Requirement 导出为人读需求文档。
 *
 * 用法（必须 --project=<projectId>）：
 *   pnpm tsx scripts/export-db-requirements-to-docs.ts --project=<projectId>                    # dry-run
 *   pnpm tsx scripts/export-db-requirements-to-docs.ts --project=<projectId> --apply            # 写
 *   pnpm tsx scripts/export-db-requirements-to-docs.ts --project=<projectId> --apply --force-overwrite  # 强制覆盖差异
 *
 * 安全设计（R1 must-fix #4）：
 * - --project 必填（避免误对所有项目）
 * - dry-run 输出表（含 path / exists / hash_match）
 * - --apply 默认仅写新文件 + skip hash 一致；hash 不同 拒绝（要 --force-overwrite）
 * - 文件名 <createdAt-date>-<slug>-<id-last-6>.md
 * - 输出目录经 docs-structure resolver 定位，当前为 docs/02_需求设计/
 */

import { PrismaClient } from "@prisma/client";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";

import { resolveDocType } from "../src/indexer/docs-structure-resolver.js";
import { renderRequirementMarkdown } from "../src/indexer/project-indexer.js";

interface Options {
  apply: boolean;
  forceOverwrite: boolean;
  projectId?: string;
}

function parseOptions(argv: string[]): Options {
  const opts: Options = { apply: false, forceOverwrite: false };
  for (const arg of argv.slice(2)) {
    if (arg === "--apply") opts.apply = true;
    else if (arg === "--force-overwrite") opts.forceOverwrite = true;
    else if (arg.startsWith("--project=")) opts.projectId = arg.slice("--project=".length);
    else if (arg === "--help" || arg === "-h") {
      console.log("用法见文件头注释");
      process.exit(0);
    }
  }
  return opts;
}

function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9一-龥]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

function hashContent(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

interface ExportRow {
  shortId: string;
  title: string;
  targetPath: string;
  exists: boolean;
  hashMatch: boolean;
}

async function main(): Promise<void> {
  const opts = parseOptions(process.argv);
  if (!opts.projectId) {
    console.error("错误：--project=<projectId> 必填");
    process.exit(1);
  }

  const prisma = new PrismaClient();
  try {
    const project = await prisma.project.findUnique({ where: { id: opts.projectId } });
    if (!project) {
      console.error(`错误：项目 ${opts.projectId} 不存在`);
      process.exit(1);
    }

    const requirements = await prisma.requirement.findMany({
      where: { projectId: opts.projectId },
      orderBy: { createdAt: "asc" }
    });

    console.log(`=== ${opts.apply ? "APPLY" : "dry-run"} · export-db-requirements-to-docs ===`);
    console.log(`项目: ${project.name} (${opts.projectId})`);
    console.log(`需求总数: ${requirements.length}`);
    console.log();

    const rows: ExportRow[] = [];
    const writeOps: Array<{ filePath: string; content: string; row: ExportRow }> = [];
    const requirementDocsDir = resolveDocType("requirement").directory;

    for (const req of requirements) {
      const dateStr = new Date(req.createdAt).toISOString().slice(0, 10);
      const slug = slugify(req.title) || "requirement";
      const idSuffix = req.id.slice(-6);
      const fileName = `${dateStr}-${slug}-${idSuffix}.md`;
      const filePath = join(project.localPath, requirementDocsDir, fileName);
      const targetPath = relative(project.localPath, filePath).replace(/\\/g, "/");

      const content = renderRequirementMarkdown({
        id: req.id,
        title: req.title,
        createdAt: req.createdAt,
        updatedAt: req.updatedAt,
        status: req.status,
        source: req.source,
        description: req.description,
        verbatimSource: req.verbatimSource ?? req.description,
        claudeInterpretation: req.claudeInterpretation,
        ambiguities: req.ambiguities,
        fidelityDiff: req.fidelityDiff
      });

      let exists = false;
      let hashMatch = false;
      if (existsSync(filePath)) {
        exists = true;
        const existingContent = await readFile(filePath, "utf8");
        hashMatch = hashContent(existingContent) === hashContent(content);
      }

      const row: ExportRow = {
        shortId: req.id.slice(0, 12),
        title: req.title.slice(0, 40),
        targetPath,
        exists,
        hashMatch
      };
      rows.push(row);
      writeOps.push({ filePath, content, row });
    }

    // 输出表
    console.log(
      `| ${"short_id".padEnd(12)} | ${"title".padEnd(40)} | ${"target".padEnd(60)} | ${"exists".padEnd(6)} | ${"hash_match".padEnd(10)} |`
    );
    console.log(`|${"-".repeat(14)}|${"-".repeat(42)}|${"-".repeat(62)}|${"-".repeat(8)}|${"-".repeat(12)}|`);
    for (const row of rows) {
      console.log(
        `| ${row.shortId.padEnd(12)} | ${row.title.padEnd(40)} | ${row.targetPath.padEnd(60)} | ${(row.exists ? "yes" : "no").padEnd(6)} | ${(row.exists ? (row.hashMatch ? "yes" : "no") : "-").padEnd(10)} |`
      );
    }
    console.log();

    const summary = {
      will_write_new: rows.filter((r) => !r.exists).length,
      will_skip_match: rows.filter((r) => r.exists && r.hashMatch).length,
      conflict_diff: rows.filter((r) => r.exists && !r.hashMatch).length
    };
    console.log(`将新写: ${summary.will_write_new}`);
    console.log(`已存在 hash 一致 跳过: ${summary.will_skip_match}`);
    console.log(`已存在 hash 不同（冲突）: ${summary.conflict_diff}`);

    if (!opts.apply) {
      console.log();
      console.log("(dry-run only — 加 --apply 实际执行)");
      return;
    }

    if (summary.conflict_diff > 0 && !opts.forceOverwrite) {
      console.error();
      console.error(`错误：${summary.conflict_diff} 个文件存在且 hash 不同。`);
      console.error("加 --force-overwrite 才能覆盖；请先 review 这些差异。");
      process.exit(1);
    }

    let writtenCount = 0;
    for (const op of writeOps) {
      if (op.row.exists && op.row.hashMatch) continue;
      if (op.row.exists && !opts.forceOverwrite) continue; // 安全网（理论上 conflict_diff>0 已 exit）
      await mkdir(dirname(op.filePath), { recursive: true });
      await writeFile(op.filePath, op.content, "utf8");
      writtenCount += 1;
    }
    console.log();
    console.log(`✓ 已写入 ${writtenCount} 个文件`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
