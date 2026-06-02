import { createHash } from "node:crypto";
import { basename, extname } from "node:path";

import { validateDevTask } from "../generated/dev-task-validator.js";
import { getDocsStructureResolver, type DocsStructureResolver } from "./docs-structure-resolver.js";

export interface ParsedDocumentInput {
  relativePath: string;
  content: string;
  mtime: Date;
  resolver?: DocsStructureResolver;
}

export type DocumentParseStatus = "success" | "partial" | "parse_error";

export interface ParsedDocumentRecord {
  taskKey: string;
  path: string;
  kind: string;
  title: string;
  status: string | null;
  phase: string | null;
  priority: string | null;
  progress: number | null;
  summary: string | null;
  frontmatter: Record<string, string>;
  contentHash: string;
  mtime: Date;
  parseStatus: DocumentParseStatus;
  parseError: string | null;
  parseIssues: string[];
}

interface FrontmatterResult {
  frontmatter: Record<string, string>;
  body: string;
  parseStatus: DocumentParseStatus;
  issues: string[];
}

export function parseDocument(input: ParsedDocumentInput): ParsedDocumentRecord {
  const normalizedPath = input.relativePath.replace(/\\/g, "/");
  const {
    frontmatter,
    body,
    parseStatus: frontmatterParseStatus,
    issues: frontmatterIssues
  } = extractFrontmatter(input.content);
  const devTaskIssues = validateDevTaskFrontmatter(frontmatter, body);
  const parseIssues = [...frontmatterIssues, ...devTaskIssues];
  const parseStatus =
    frontmatterParseStatus === "parse_error"
      ? "parse_error"
      : parseIssues.length > 0
        ? "partial"
        : "success";
  const kind = inferDocumentKind(normalizedPath, frontmatter, input.resolver);
  const title =
    normalizeText(frontmatter.title) ?? extractHeading(body) ?? stripExtension(basename(normalizedPath));
  // CCB task identity 优先来自 frontmatter，保持 hierarchy API 与 indexer 规则一致；
  // 文件名 slug 只在旧文档未声明 task id/key 时作为兜底。
  const taskKey =
    normalizeText(frontmatter.task_id) ??
    normalizeText(frontmatter.task_key) ??
    normalizeText(frontmatter.taskKey) ??
    createTaskKey(normalizedPath) ??
    title.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fa5]+/g, "-").replace(/^-+|-+$/g, "");
  const summary = extractSummary(body);
  const progress = normalizeNumber(frontmatter.progress);

  return {
    taskKey,
    path: normalizedPath,
    kind,
    title,
    status: normalizeText(frontmatter.status),
    phase: normalizeText(frontmatter.phase),
    priority: normalizeText(frontmatter.priority),
    progress,
    summary,
    frontmatter,
    contentHash: createHash("sha256").update(input.content, "utf8").digest("hex"),
    mtime: input.mtime,
    parseStatus,
    parseError: parseIssues.length > 0 ? parseIssues.join("\n") : null,
    parseIssues
  };
}

function extractFrontmatter(content: string): FrontmatterResult {
  const matched = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (matched) {
    const frontmatter: Record<string, string> = {};
    const issues: string[] = [];
    const lines = matched[1].split(/\r?\n/);
    for (const [index, line] of lines.entries()) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) {
        continue;
      }

      const colonIndex = trimmed.indexOf(":");
      if (colonIndex === -1) {
        issues.push(`frontmatter line ${index + 2}: missing ':' separator`);
        continue;
      }

      const key = trimmed.slice(0, colonIndex).trim();
      const rawValue = trimmed.slice(colonIndex + 1).trim();
      frontmatter[key] = rawValue.replace(/^['"]|['"]$/g, "");
    }

    return {
      frontmatter,
      body: matched[2],
      parseStatus:
        issues.length > 0 ? (Object.keys(frontmatter).length > 0 ? "partial" : "parse_error") : "success",
      issues
    };
  }

  if (content.startsWith("---")) {
    return {
      frontmatter: {},
      body: content,
      parseStatus: "parse_error",
      issues: ["frontmatter line 1: missing closing '---' delimiter"]
    };
  }

  return extractListFrontmatter(content);
}

/**
 * 退化解析 CCB 风格的列表式 frontmatter：
 *   # 标题
 *
 *   - status: done
 *   - step: 6
 *
 *   ## 正文...
 * 跳过开头的 H1 与空行后，连续读取 `- key: value` 行作为元数据，
 * 直到遇到非列表行为止；解析到的列表区会从 body 中剥离，避免重复展示。
 */
function extractListFrontmatter(content: string): FrontmatterResult {
  const lines = content.split(/\r?\n/);
  let cursor = 0;

  while (cursor < lines.length) {
    const line = lines[cursor];
    if (line.trim() === "" || /^#\s+/.test(line)) {
      cursor += 1;
      continue;
    }
    break;
  }

  const listStart = cursor;
  const frontmatter: Record<string, string> = {};

  while (cursor < lines.length) {
    const line = lines[cursor];
    const trimmed = line.trim();

    if (trimmed === "") {
      cursor += 1;
      continue;
    }

    if (!trimmed.startsWith("- ")) {
      break;
    }

    const itemContent = trimmed.slice(2).trim();
    const colonIndex = itemContent.indexOf(":");
    if (colonIndex === -1) {
      break;
    }

    const key = itemContent.slice(0, colonIndex).trim();
    if (!key) {
      break;
    }

    const rawValue = itemContent.slice(colonIndex + 1).trim();
    frontmatter[key] = rawValue.replace(/^['"]|['"]$/g, "");
    cursor += 1;
  }

  if (Object.keys(frontmatter).length === 0) {
    return { frontmatter: {}, body: content, parseStatus: "success", issues: [] };
  }

  const body = [...lines.slice(0, listStart), ...lines.slice(cursor)].join("\n");
  return { frontmatter, body, parseStatus: "success", issues: [] };
}

function validateDevTaskFrontmatter(frontmatter: Record<string, string>, body: string): string[] {
  if (frontmatter.doc_type !== "dev_task") {
    return [];
  }

  return validateDevTask({
    frontmatter: {
      ...frontmatter,
      order: normalizeNumber(frontmatter.order),
      dependencies: normalizeDependencyList(frontmatter.dependencies)
    },
    body
  }).issues.map((issue) => `dev-task.${issue.path}: expected ${issue.expected}, got '${String(issue.actual ?? "")}'`);
}

function normalizeDependencyList(value: string | undefined): string[] {
  const trimmed = value?.trim();
  if (!trimmed || trimmed === "[]") return [];
  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    return trimmed
      .slice(1, -1)
      .split(",")
      .map((item) => item.trim().replace(/^['"]|['"]$/g, ""))
      .filter(Boolean);
  }
  return trimmed.split(",").map((item) => item.trim()).filter(Boolean);
}

const LEGACY_DOCUMENT_KINDS = new Set(["template", "index"]);

export function inferDocumentKind(
  relativePath: string,
  frontmatter: Record<string, string> = {},
  resolver: DocsStructureResolver = getDocsStructureResolver()
): string {
  const explicitDocType = normalizeText(frontmatter.doc_type);
  const contractDocTypes = resolver.inferDocTypesForPath(relativePath);
  if (explicitDocType && contractDocTypes.includes(explicitDocType)) {
    return explicitDocType;
  }
  if (contractDocTypes.length === 1) {
    return contractDocTypes[0];
  }

  const explicitKind = normalizeText(frontmatter.kind)?.toLowerCase();
  if (explicitKind && LEGACY_DOCUMENT_KINDS.has(explicitKind)) {
    return explicitKind;
  }

  return "other";
}

// ============ Requirement md schema helpers (slice 2) ============

export const REQUIREMENT_STATUS_VALUES = [
  "drafting",
  "planning",
  "delivering",
  "delivered",
  "deferred",
  "cancelled"
] as const;
export type RequirementStatusValue = (typeof REQUIREMENT_STATUS_VALUES)[number];

export const REQUIREMENT_OUTPUT_MODE_VALUES = [
  "requirement_only",
  "spec_only",
  "spec_plan_task"
] as const;
export type RequirementOutputModeValue = (typeof REQUIREMENT_OUTPUT_MODE_VALUES)[number];

export interface RequirementSections {
  description: string;
  verbatimSource: string;
  claudeInterpretation: string | null;
  ambiguities: string | null;
  fidelityDiff: string | null;
}

export interface NormalizedRequirementFields {
  status: RequirementStatusValue;
  source: string;
  outputMode: RequirementOutputModeValue;
  /** 校验问题：当 frontmatter 含非法枚举时记录，由 indexer 决定是否升级为 partial syncjob */
  issues: string[];
}

export interface RequirementAnalysisProjectionFields {
  analysisInputHash: string | null;
  analysisAppliedAt: Date | null;
  issues: string[];
}

export function normalizeRequirementFields(
  frontmatter: Record<string, string>
): NormalizedRequirementFields {
  const issues: string[] = [];

  const rawStatus = frontmatter.status?.trim();
  let status: RequirementStatusValue = "drafting";
  if (rawStatus && (REQUIREMENT_STATUS_VALUES as readonly string[]).includes(rawStatus)) {
    status = rawStatus as RequirementStatusValue;
  } else if (rawStatus) {
    issues.push(`非法 status='${rawStatus}'，回退 'drafting'`);
  }

  const rawSource = frontmatter.source?.trim();
  const source = rawSource === "migration" ? "migration" : "manual";

  const rawOutputMode = frontmatter.output_mode?.trim() ?? frontmatter.outputMode?.trim();
  let outputMode: RequirementOutputModeValue = "requirement_only";
  if (rawOutputMode && (REQUIREMENT_OUTPUT_MODE_VALUES as readonly string[]).includes(rawOutputMode)) {
    outputMode = rawOutputMode as RequirementOutputModeValue;
  } else if (rawOutputMode) {
    issues.push(`非法 output_mode='${rawOutputMode}'，回退 'requirement_only'`);
  }

  return { status, source, outputMode, issues };
}

export function getExplicitRequirementStatus(
  frontmatter: Record<string, string>
): RequirementStatusValue | null {
  const rawStatus = frontmatter.status?.trim();
  if (!rawStatus) return null;
  if ((REQUIREMENT_STATUS_VALUES as readonly string[]).includes(rawStatus)) {
    return rawStatus as RequirementStatusValue;
  }
  return null;
}

export function normalizeRequirementAnalysisProjectionFields(
  frontmatter: Record<string, string>
): RequirementAnalysisProjectionFields {
  const issues: string[] = [];
  const rawHash = (frontmatter.analysis_input_hash ?? frontmatter.analysisInputHash)?.trim();
  const rawAppliedAt = (frontmatter.analysis_applied_at ?? frontmatter.analysisAppliedAt)?.trim();

  let analysisInputHash: string | null = null;
  if (rawHash) {
    if (/^[a-f0-9]{64}$/.test(rawHash)) {
      analysisInputHash = rawHash;
    } else {
      issues.push(`非法 analysis_input_hash='${rawHash}'，跳过分析 hash 投影`);
    }
  }

  let analysisAppliedAt: Date | null = null;
  if (rawAppliedAt) {
    const date = new Date(rawAppliedAt);
    if (!isNaN(date.getTime())) {
      analysisAppliedAt = date;
    } else {
      issues.push(`非法 analysis_applied_at='${rawAppliedAt}'，跳过主动分析时间投影`);
    }
  }

  return { analysisInputHash, analysisAppliedAt, issues };
}

/**
 * 从 requirement markdown body 提取 5 个 section。
 * 同名 section 多次出现时取首个。空 section 返回空字符串。
 */
export function parseRequirementSections(body: string): RequirementSections {
  const sections = splitMarkdownSections(body);
  const find = (heading: string): string => {
    const matched = sections.find((s) => s.heading === heading);
    return matched ? matched.content.trim() : "";
  };
  const findOptional = (heading: string): string | null => {
    const matched = sections.find((s) => s.heading === heading);
    if (!matched) return null;
    const trimmed = matched.content.trim();
    return trimmed.length > 0 ? trimmed : null;
  };
  return {
    description: find("需求描述"),
    verbatimSource: find("原话（verbatim）") || find("原话") || find("verbatim"),
    claudeInterpretation: findOptional("Claude 解读") ?? findOptional("Claude 解读（可选）"),
    ambiguities: findOptional("歧义点") ?? findOptional("歧义点（可选）"),
    fidelityDiff: findOptional("保真差异") ?? findOptional("保真差异（可选）")
  };
}

interface MarkdownSection {
  heading: string;
  content: string;
}

function splitMarkdownSections(body: string): MarkdownSection[] {
  const lines = body.split(/\r?\n/);
  const sections: MarkdownSection[] = [];
  let current: MarkdownSection | null = null;
  for (const line of lines) {
    const headingMatch = line.match(/^##\s+(.+)$/);
    if (headingMatch) {
      if (current) sections.push(current);
      current = { heading: headingMatch[1].trim(), content: "" };
    } else if (current) {
      current.content += (current.content.length > 0 ? "\n" : "") + line;
    }
  }
  if (current) sections.push(current);
  return sections;
}

function extractHeading(content: string): string | null {
  const matched = content.match(/^#\s+(.+)$/m);
  return matched?.[1]?.trim() ?? null;
}

function extractSummary(content: string): string | null {
  const lines = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#") && !line.startsWith("```"));

  if (lines.length === 0) {
    return null;
  }

  return lines.slice(0, 2).join(" ").slice(0, 220);
}

function createTaskKey(relativePath: string): string | null {
  const base = stripExtension(basename(relativePath));
  const slug = base
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);

  return slug.length > 0 ? slug : null;
}

function stripExtension(fileName: string): string {
  return fileName.slice(0, Math.max(0, fileName.length - extname(fileName).length));
}

function normalizeText(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function normalizeNumber(value: string | undefined): number | null {
  if (!value?.trim()) {
    return null;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function isStrictIsoDate(value: string): boolean {
  if (!/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{3})?(Z|[+-]\d{2}:\d{2})$/.test(value)) {
    return false;
  }
  return !Number.isNaN(new Date(value).getTime());
}
