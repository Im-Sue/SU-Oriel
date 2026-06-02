/**
 * C3 一次性迁移：把现有 docs/.ccb/specs/active/*.md 迁到 docs/03_开发计划/ 开发任务文档。
 *
 * 默认 dry-run；不会自动执行。推荐先 dry-run review，再 --apply。
 *
 * 用法：
 *   pnpm tsx scripts/migrate-ccb-specs-to-docs03.ts --project=<projectId>
 *   pnpm tsx scripts/migrate-ccb-specs-to-docs03.ts --project-root=/path/to/repo --apply
 *   pnpm tsx scripts/migrate-ccb-specs-to-docs03.ts --project=<projectId> --apply --move
 */

import { PrismaClient } from "@prisma/client";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";

import { getDocsStructureResolver } from "../src/indexer/docs-structure-resolver.js";

interface Options {
  apply: boolean;
  forceOverwrite: boolean;
  move: boolean;
  projectId?: string;
  projectRoot?: string;
}

interface MigrationRow {
  sourcePath: string;
  targetPath: string;
  title: string;
  exists: boolean;
  hashMatch: boolean;
  action: "write" | "skip_same" | "conflict" | "skip_invalid";
  issue?: string;
}

function parseOptions(argv: string[]): Options {
  const options: Options = { apply: false, forceOverwrite: false, move: false };
  for (const arg of argv.slice(2)) {
    if (arg === "--apply") options.apply = true;
    else if (arg === "--force-overwrite") options.forceOverwrite = true;
    else if (arg === "--move") options.move = true;
    else if (arg.startsWith("--project=")) options.projectId = arg.slice("--project=".length);
    else if (arg.startsWith("--project-root=")) options.projectRoot = arg.slice("--project-root=".length);
    else if (arg === "--help" || arg === "-h") {
      console.log("用法见文件头注释");
      process.exit(0);
    }
  }
  return options;
}

function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

function hashContent(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

function readFrontmatter(content: string): Record<string, string> {
  const matched = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!matched) return {};
  const frontmatter: Record<string, string> = {};
  for (const line of matched[1].split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf(":");
    if (separator === -1) continue;
    frontmatter[trimmed.slice(0, separator).trim()] = trimmed.slice(separator + 1).trim().replace(/^['"]|['"]$/g, "");
  }
  return frontmatter;
}

function insertFrontmatterLine(lines: string[], afterKey: string, line: string): void {
  if (lines.some((existing) => existing.trim().startsWith(`${line.split(":")[0]}:`))) return;
  const afterIndex = lines.findIndex((existing) => existing.trim().startsWith(`${afterKey}:`));
  lines.splice(afterIndex === -1 ? lines.length : afterIndex + 1, 0, line);
}

function ensureDevTaskFrontmatter(content: string): string {
  const matched = content.match(/^(---\r?\n)([\s\S]*?)(\r?\n---[\s\S]*)$/);
  if (!matched) return content;
  const lines = matched[2].split(/\r?\n/);
  insertFrontmatterLine(lines, "title", "doc_type: dev_task");
  insertFrontmatterLine(lines, "current_node", "node_substate: awaiting_codex_pickup");
  return `${matched[1]}${lines.join("\n")}${matched[3]}`;
}

function devTaskFileName(title: string, taskId: string, namingRule: string): string {
  const subject = `${slugify(title) || "dev-task"}-${taskId.slice(-6)}`;
  const fileName = namingRule
    .replace("<模块/主题>", subject)
    .replace("<文档类型>", "开发任务")
    .replace("<部分>", subject)
    .replace("<模块>", subject);
  return fileName.endsWith(".md") ? fileName : `${fileName}.md`;
}

async function collectMarkdownFiles(root: string): Promise<string[]> {
  if (!existsSync(root)) return [];
  const entries = await readdir(root, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectMarkdownFiles(path)));
    } else if (entry.isFile() && entry.name.endsWith(".md")) {
      files.push(path);
    }
  }
  return files;
}

async function resolveProjectRoot(options: Options): Promise<string> {
  if (options.projectRoot) return resolve(options.projectRoot);
  if (!options.projectId) {
    throw new Error("--project=<projectId> 或 --project-root=<path> 必填");
  }
  const prisma = new PrismaClient();
  try {
    const project = await prisma.project.findUnique({ where: { id: options.projectId } });
    if (!project) throw new Error(`项目不存在: ${options.projectId}`);
    return resolve(project.localPath);
  } finally {
    await prisma.$disconnect();
  }
}

async function main(): Promise<void> {
  const options = parseOptions(process.argv);
  const projectRoot = await resolveProjectRoot(options);
  const sourceRoot = join(projectRoot, "docs", ".ccb", "specs", "active");
  const devTask = getDocsStructureResolver().resolveDocType("dev_task");
  const targetRoot = join(projectRoot, devTask.directory);
  const sourceFiles = await collectMarkdownFiles(sourceRoot);
  const rows: MigrationRow[] = [];
  const writes: Array<{ sourcePath: string; targetPath: string; content: string }> = [];

  for (const sourcePath of sourceFiles.sort()) {
    const rawContent = await readFile(sourcePath, "utf8");
    const frontmatter = readFrontmatter(rawContent);
    const taskId = frontmatter.task_id?.trim() || frontmatter.task_key?.trim();
    if (!taskId) {
      rows.push({
        sourcePath,
        targetPath: "",
        title: frontmatter.title ?? basename(sourcePath),
        exists: false,
        hashMatch: false,
        action: "skip_invalid",
        issue: "missing frontmatter.task_id"
      });
      continue;
    }

    const title = frontmatter.title?.trim() || basename(sourcePath, ".md");
    const targetPath = join(targetRoot, devTaskFileName(title, taskId, devTask.namingRule));
    const content = ensureDevTaskFrontmatter(rawContent);
    const exists = existsSync(targetPath);
    const hashMatch = exists ? hashContent(await readFile(targetPath, "utf8")) === hashContent(content) : false;
    const action = exists && hashMatch ? "skip_same" : exists && !options.forceOverwrite ? "conflict" : "write";
    rows.push({ sourcePath, targetPath, title, exists, hashMatch, action });
    if (action === "write") writes.push({ sourcePath, targetPath, content });
  }

  console.log(`=== ${options.apply ? "APPLY" : "dry-run"} · migrate-ccb-specs-to-docs03 ===`);
  console.log(`project_root: ${projectRoot}`);
  console.log(`source: ${sourceRoot}`);
  console.log(`target: ${targetRoot}`);
  console.table(rows.map((row) => ({
    action: row.action,
    title: row.title,
    source: row.sourcePath.replace(`${projectRoot}/`, ""),
    target: row.targetPath ? row.targetPath.replace(`${projectRoot}/`, "") : "",
    issue: row.issue ?? ""
  })));

  const conflicts = rows.filter((row) => row.action === "conflict").length;
  if (!options.apply) {
    console.log("dry-run only; add --apply to write files.");
    return;
  }
  if (conflicts > 0) {
    throw new Error(`${conflicts} 个目标文件已存在且 hash 不同；review 后可加 --force-overwrite`);
  }

  await mkdir(targetRoot, { recursive: true });
  for (const write of writes) {
    await mkdir(dirname(write.targetPath), { recursive: true });
    await writeFile(write.targetPath, write.content, "utf8");
    if (options.move) {
      await rm(write.sourcePath, { force: true });
    }
  }
  console.log(`written: ${writes.length}; moved: ${options.move ? writes.length : 0}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
