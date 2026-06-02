import type { Document } from "@prisma/client";

import { prisma } from "../../db/prisma.js";

export interface ConsultRecord {
  round: string;
  layer?: string;
  input_summary?: string;
  codex_reply?: unknown;
  unsolicited_findings?: unknown[];
  stop_reason?: string;
  timestamp?: string;
  [key: string]: unknown;
}

export class ConsultRecordsTaskNotFoundError extends Error { constructor() { super("任务不存在"); } }

type DevTaskDoc = Pick<Document, "frontmatterJson" | "updatedAt" | "path">;

function parse(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try { return JSON.parse(value); } catch { return value; }
}

function record(value: unknown): Record<string, unknown> {
  const parsed = parse(value);
  return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function roundOrdinal(value: string): number {
  const match = value.match(/^R(\d+)$/i);
  return match ? Number.parseInt(match[1], 10) : Number.MAX_SAFE_INTEGER;
}

function devTaskFrontmatter(doc: DevTaskDoc | null): Record<string, unknown> {
  return record(doc?.frontmatterJson ?? "{}");
}

function consultRecords(frontmatter: Record<string, unknown>): ConsultRecord[] {
  const parsed = parse(frontmatter.consult_records ?? frontmatter.consultRecords);
  const rows = Array.isArray(parsed) ? parsed.map(record) : [];
  return rows.flatMap((row, index) => {
    const round = text(row.round) ?? `R${index + 1}`;
    const next: ConsultRecord = { ...row, round };
    return [next];
  }).sort((left, right) => {
    const byRound = roundOrdinal(left.round) - roundOrdinal(right.round);
    if (byRound !== 0) return byRound;
    return String(left.timestamp ?? "").localeCompare(String(right.timestamp ?? ""));
  });
}

export async function listConsultRecords(taskId: string): Promise<ConsultRecord[]> {
  const task = await prisma.task.findUnique({ where: { id: taskId }, select: { id: true, projectId: true, taskKey: true } });
  if (!task) throw new ConsultRecordsTaskNotFoundError();
  const docs = await prisma.document.findMany({
    where: { projectId: task.projectId, taskKey: task.taskKey, kind: "dev_task" },
    select: { path: true, frontmatterJson: true, updatedAt: true }
  });
  const devTaskDoc = docs.sort((left, right) => left.path.localeCompare(right.path))[0] ?? null;
  return consultRecords(devTaskFrontmatter(devTaskDoc));
}
