import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join } from "node:path";

import { prisma } from "../../db/prisma.js";
import { emitEvent } from "../events/event-journal.service.js";
import { primitiveExecutor } from "./primitive-wrapper.js";

export type ConsultCodexInput = { taskId: string; nodeId: string; message: string; targetAgent: string; createdBy?: string; consultRequestId?: string; now?: Date; reply?: Record<string, unknown> };
export type ConsultCodexResult = { taskId: string; taskKey: string; round: string; message: string; beforeConsultRecordCount: number; afterConsultRecordCount: number };
export type ConsultCodexDependencies = { beforePersist?: () => Promise<void>; writeFile?: typeof writeFile; renameFile?: typeof rename; rmFile?: typeof rm };
interface DevTaskSnapshot { frontmatterLines: string[]; body: string; revision: number; }

export class ConsultCodexDevTaskConflictError extends Error {
  public constructor(
    public readonly expectedRevision: number,
    public readonly actualRevision: number
  ) {
    super(`consult_codex dev_task revision conflict: expected=${expectedRevision}, actual=${actualRevision}`);
  }
}

export class ConsultCodexNodeMismatchError extends Error {
  public constructor() { super("consult request node_id 与当前节点不匹配"); }
}

export class ConsultCodexRequestNotPendingError extends Error {
  public constructor() { super("consult request is not pending"); }
}

function parseScalarFrontmatter(lines: string[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const index = line.indexOf(":");
    if (index === -1) continue;
    result[line.slice(0, index).trim()] = line.slice(index + 1).trim().replace(/^['"]|['"]$/g, "");
  }
  return result;
}

function extractFrontmatter(content: string): DevTaskSnapshot {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---([\s\S]*)$/);
  if (!match) throw new Error("dev_task 文档缺少 frontmatter");
  const frontmatterLines = match[1].split(/\r?\n/);
  const revision = Number.parseInt(parseScalarFrontmatter(frontmatterLines).revision ?? "", 10);
  return { frontmatterLines, body: match[2], revision: Number.isFinite(revision) ? revision : 0 };
}

function parseConsultRecords(raw: string | undefined): Array<Record<string, unknown>> {
  if (!raw) return [];
  const parsed = JSON.parse(raw) as unknown;
  return Array.isArray(parsed) ? parsed.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object")) : [];
}

function updateFrontmatterScalar(lines: string[], key: string, value: string): string[] {
  const next = [...lines];
  const index = next.findIndex((line) => line.slice(0, line.indexOf(":")).trim() === key);
  if (index === -1) next.push(`${key}: ${value}`);
  else next[index] = `${key}: ${value}`;
  return next;
}

function buildDevTaskContent(snapshot: DevTaskSnapshot, records: Array<Record<string, unknown>>, revision: number): string {
  let lines = updateFrontmatterScalar(snapshot.frontmatterLines, "consult_records", JSON.stringify(records));
  lines = updateFrontmatterScalar(lines, "revision", String(revision));
  return `---\n${lines.join("\n")}\n---${snapshot.body}`;
}

async function resolveDevTaskDocument(task: { projectId: string; taskKey: string; project: { localPath: string } }) {
  const document = await prisma.document.findFirst({
    where: { projectId: task.projectId, taskKey: task.taskKey, kind: "dev_task" },
    orderBy: { path: "asc" },
    select: { id: true, path: true }
  });
  if (!document) {
    throw new Error(`dev_task document not found for task ${task.taskKey}`);
  }
  const path = isAbsolute(document.path) ? document.path : join(task.project.localPath, document.path);
  return { documentId: document.id, path };
}

async function assertDevTaskUnchanged(path: string, original: string, expectedRevision: number): Promise<void> {
  const current = await readFile(path, "utf8");
  if (current === original) return;
  throw new ConsultCodexDevTaskConflictError(expectedRevision, extractFrontmatter(current).revision);
}

function frontmatterJson(lines: string[], records: Array<Record<string, unknown>>, revision: number): string {
  return JSON.stringify({ ...parseScalarFrontmatter(lines), revision, consult_records: records });
}

async function emitDevTaskWriteConflict(input: {
  taskId: string;
  conflict: ConsultCodexDevTaskConflictError;
  writer: string;
  emittedAt: string;
  correlationId?: string | null;
}): Promise<void> {
  await emitEvent({
    event_id: randomUUID(),
    event_type: "state_write_conflict",
    subject_type: "subtask",
    subject_id: input.taskId,
    emitted_at: input.emittedAt,
    source_actor: "codex",
    source_component: "primitive_executor",
    correlation_id: input.correlationId ?? undefined,
    state_revision_seen: input.conflict.expectedRevision,
    idempotency_key: [
      "consult_codex",
      "dev_task_write_conflict",
      input.taskId,
      input.correlationId ?? "none",
      input.conflict.expectedRevision,
      input.conflict.actualRevision
    ].join(":"),
    payload: {
      resource_type: "dev_task",
      expected_revision: input.conflict.expectedRevision,
      actual_revision: input.conflict.actualRevision,
      writer: input.writer,
      primitive: "consult_codex"
    }
  });
}

export async function runConsultCodexPrimitive(
  input: ConsultCodexInput,
  dependencies: ConsultCodexDependencies = {}
): Promise<ConsultCodexResult> {
  const deps = { writeFile, renameFile: rename, rmFile: rm, ...dependencies };
  return await primitiveExecutor.run({
    primitive: "consult_codex",
    mutationType: "dev_task document CAS + prisma.$transaction",
    idempotencyKey: input.consultRequestId ?? `${input.taskId}:consult_codex:${input.nodeId}`,
    run: async () => {
      const task = await prisma.task.findUnique({
        where: { id: input.taskId },
        select: { id: true, projectId: true, taskKey: true, currentNode: true, project: { select: { localPath: true } } }
      });
      if (!task) throw new Error("任务不存在");
      if (task.currentNode !== input.nodeId) throw new ConsultCodexNodeMismatchError();

      const devTask = await resolveDevTaskDocument(task);
      const original = await readFile(devTask.path, "utf8");
      const snapshot = extractFrontmatter(original);
      const records = parseConsultRecords(parseScalarFrontmatter(snapshot.frontmatterLines).consult_records);
      const round = `R${records.length + 1}`;
      const timestamp = (input.now ?? new Date()).toISOString();
      const record = {
        round,
        layer: input.nodeId,
        input_summary: input.message.slice(0, 240),
        codex_reply: input.reply ?? { recommendation: "consult_request_recorded", target_agent: input.targetAgent },
        unsolicited_findings: [],
        stop_reason: "converged",
        timestamp
      };
      const nextRecords = [...records, record];
      const nextRevision = snapshot.revision + 1;
      const nextContent = buildDevTaskContent(snapshot, nextRecords, nextRevision);
      const tempPath = `${devTask.path}.tmp-consult-${process.pid}-${Date.now()}`;
      let renamed = false;

      try {
        await mkdir(dirname(tempPath), { recursive: true });
        await deps.writeFile(tempPath, nextContent, "utf8");
        await deps.beforePersist?.();
        await assertDevTaskUnchanged(devTask.path, original, snapshot.revision);
        await deps.renameFile(tempPath, devTask.path);
        renamed = true;
        const hash = createHash("sha256").update(nextContent, "utf8").digest("hex");
        await prisma.$transaction(async (tx) => {
          if (input.consultRequestId) {
            const updated = await tx.consultRequest.updateMany({
              where: { id: input.consultRequestId, taskId: task.id, status: "pending" },
              data: { status: "consumed", consumedAt: new Date(timestamp), consultRound: round }
            });
            if (updated.count !== 1) throw new ConsultCodexRequestNotPendingError();
          }
          await tx.document.update({
            where: { id: devTask.documentId },
            data: { frontmatterJson: frontmatterJson(snapshot.frontmatterLines, nextRecords, nextRevision), contentHash: hash, mtime: new Date(timestamp) }
          });
        });
      } catch (error) {
        await deps.rmFile(tempPath, { force: true });
        if (renamed) {
          const restorePath = `${devTask.path}.restore-consult-${process.pid}-${Date.now()}`;
          await deps.writeFile(restorePath, original, "utf8");
          await deps.renameFile(restorePath, devTask.path);
        }
        if (error instanceof ConsultCodexDevTaskConflictError) {
          await emitDevTaskWriteConflict({
            taskId: task.id,
            conflict: error,
            writer: input.createdBy ?? input.targetAgent,
            emittedAt: timestamp,
            correlationId: input.consultRequestId ?? null
          });
        }
        throw error;
      }

      return { taskId: task.id, taskKey: task.taskKey, round, message: input.message, beforeConsultRecordCount: records.length, afterConsultRecordCount: nextRecords.length };
    }
  });
}
