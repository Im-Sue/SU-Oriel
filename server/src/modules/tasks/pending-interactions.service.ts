import type { ConsultRequest, Document, ReviewIntent } from "@prisma/client";

import { prisma } from "../../db/prisma.js";

export type PendingInteractionKind = "review_intent" | "consult_request" | "approval_record" | "pending_user_decision";
export type PendingInteractionSource = "ReviewIntent" | "ConsultRequest" | "dev_task.approval_records" | "dev_task.pending_user_decision";
export interface PendingInteraction { id: string; kind: PendingInteractionKind; source_table: PendingInteractionSource; node_id?: string; summary: string; cta_label: string; cta_action: string; created_at: string; raw_ref: string; }
export interface PendingInteractionResponse { task_id: string; pending: PendingInteraction[]; count: number; }
export class PendingInteractionsTaskNotFoundError extends Error { constructor() { super("任务不存在"); } }

type DevTaskDoc = Pick<Document, "frontmatterJson" | "updatedAt" | "path">;
const labels: Record<string, string> = { mark_review_pass: "Review pass", request_replan: "Request replan", request_escalate: "Request escalate" };
const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === "object" && !Array.isArray(value));
const parse = (value: unknown): unknown => { if (typeof value !== "string") return value; try { return JSON.parse(value); } catch { return value; } };
const record = (value: unknown): Record<string, unknown> => (isRecord(parse(value)) ? parse(value) as Record<string, unknown> : {});
const text = (value: unknown): string | undefined => (typeof value === "string" && value.trim() ? value.trim() : undefined);
const brief = (value: string | undefined, fallback: string): string => (value ?? fallback).replace(/\s+/g, " ").trim().slice(0, 120);
const dateIso = (value: unknown, fallback: Date): string => { const date = text(value) ? new Date(text(value) ?? "") : fallback; return Number.isNaN(date.getTime()) ? fallback.toISOString() : date.toISOString(); };

function reviewPayload(intent: ReviewIntent): Record<string, unknown> {
  const parsed = parse(intent.payloadJson);
  return typeof parsed === "string" ? { summary: parsed } : record(parsed);
}

function reviewIntentPending(intent: ReviewIntent, fallbackNode: string | null): PendingInteraction {
  const payload = reviewPayload(intent);
  const node_id = text(payload.node_id ?? payload.nodeId) ?? fallbackNode ?? undefined;
  return {
    id: intent.id, kind: "review_intent", source_table: "ReviewIntent", ...(node_id ? { node_id } : {}),
    summary: brief(text(payload.summary ?? payload.comment ?? payload.intent), `Review intent: ${intent.intentType}`),
    cta_label: labels[intent.intentType] ?? "Review", cta_action: `open_review_intent:${intent.id}`,
    created_at: intent.createdAt.toISOString(), raw_ref: `review_intent:${intent.id}`
  };
}

function consultRequestPending(consultRequest: ConsultRequest, fallbackNode: string | null): PendingInteraction {
  const node_id = text(consultRequest.nodeId) ?? fallbackNode ?? undefined;
  return {
    id: consultRequest.id, kind: "consult_request", source_table: "ConsultRequest", ...(node_id ? { node_id } : {}),
    summary: `等待 consult ${consultRequest.targetAgent}: ${brief(consultRequest.message, "Consult request").slice(0, 80)}`,
    cta_label: "查看 consult 请求", cta_action: `open_consult_request:${consultRequest.id}`,
    created_at: consultRequest.createdAt.toISOString(), raw_ref: `consult_request:${consultRequest.id}`
  };
}

function devTaskFrontmatter(doc: DevTaskDoc | null): Record<string, unknown> {
  return record(doc?.frontmatterJson ?? "{}");
}

function approvalRecords(frontmatter: Record<string, unknown>, devTaskDoc: DevTaskDoc): PendingInteraction[] {
  const parsed = parse(frontmatter.approval_records ?? frontmatter.approvalRecords);
  const rows = Array.isArray(parsed) ? parsed.map(record) : [];
  return rows.flatMap((approval, index) => {
    if (approval.decided !== false) return [];
    const id = text(approval.id) ?? String(index);
    const node_id = text(approval.node_id ?? approval.nodeId);
    return [{
      id: `approval_record:${id}`, kind: "approval_record", source_table: "dev_task.approval_records", ...(node_id ? { node_id } : {}),
      summary: brief(text(approval.summary ?? approval.question ?? approval.gate), "Approval pending"), cta_label: "审批",
      cta_action: `open_approval_record:${id}`, created_at: dateIso(approval.created_at ?? approval.createdAt ?? approval.timestamp, devTaskDoc.updatedAt),
      raw_ref: `dev_task#approval_records[${index}]`
    }];
  });
}

function pendingUserDecision(frontmatter: Record<string, unknown>, devTaskDoc: DevTaskDoc): PendingInteraction[] {
  const decision = record(frontmatter.pending_user_decision ?? frontmatter.pendingUserDecision);
  if (Object.keys(decision).length === 0) return [];
  const id = text(decision.id) ?? "current";
  const node_id = text(decision.node_id ?? decision.nodeId);
  return [{
    id: `pending_user_decision:${id}`, kind: "pending_user_decision", source_table: "dev_task.pending_user_decision", ...(node_id ? { node_id } : {}),
    summary: brief(text(decision.summary ?? decision.question ?? decision.prompt), "Pending user decision"), cta_label: "决策",
    cta_action: `open_pending_user_decision:${id}`, created_at: dateIso(decision.created_at ?? decision.createdAt ?? decision.timestamp, devTaskDoc.updatedAt),
    raw_ref: "dev_task#pending_user_decision"
  }];
}

export async function listPendingInteractions(taskId: string): Promise<PendingInteractionResponse> {
  const task = await prisma.task.findUnique({ where: { id: taskId }, select: { id: true, projectId: true, taskKey: true, currentNode: true } });
  if (!task) throw new PendingInteractionsTaskNotFoundError();
  const [intents, consultRequests, docs] = await Promise.all([
    prisma.reviewIntent.findMany({ where: { taskId: task.id, projectId: task.projectId, status: "pending" }, orderBy: { createdAt: "asc" } }),
    prisma.consultRequest.findMany({ where: { taskId: task.id, status: "pending" }, orderBy: { createdAt: "asc" } }),
    prisma.document.findMany({ where: { projectId: task.projectId, taskKey: task.taskKey, kind: "dev_task" }, select: { path: true, frontmatterJson: true, updatedAt: true } })
  ]);
  const devTaskDoc = docs.sort((left, right) => left.path.localeCompare(right.path))[0] ?? null;
  const frontmatter = devTaskFrontmatter(devTaskDoc);
  const pending = [
    ...intents.map((intent) => reviewIntentPending(intent, task.currentNode)),
    ...consultRequests.map((consultRequest) => consultRequestPending(consultRequest, task.currentNode)),
    ...(devTaskDoc ? approvalRecords(frontmatter, devTaskDoc) : []),
    ...(devTaskDoc ? pendingUserDecision(frontmatter, devTaskDoc) : [])
  ].sort((left, right) => new Date(left.created_at).getTime() - new Date(right.created_at).getTime());
  return { task_id: task.id, pending, count: pending.length };
}
