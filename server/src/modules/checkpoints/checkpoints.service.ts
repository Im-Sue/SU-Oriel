import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import type { Prisma, TaskCheckpoint } from "@prisma/client";

import { prisma } from "../../db/prisma.js";
import { primitiveExecutor } from "../primitive/primitive-wrapper.js";

export const CHECKPOINT_INLINE_LIMIT_BYTES = 200 * 1024;
export class CheckpointTaskNotFoundError extends Error { constructor() { super("任务不存在"); } }

export type CheckpointSummary = Pick<TaskCheckpoint, "id" | "taskId" | "taskKey" | "transitionId" | "nodeBefore" | "nodeAfter" | "stateRevisionAfter" | "stateHash" | "snapshotPath"> & { createdAt: string };
export type CheckpointDetail = CheckpointSummary & { snapshot: Record<string, unknown> | null };
export interface WriteCheckpointInput { projectLocalPath: string; taskId: string; taskKey: string; transitionId: string; nodeBefore: string | null; nodeAfter: string | null; stateRevisionAfter: number; snapshot: Record<string, unknown>; }
interface PendingSnapshotWrite { checkpointId: string; projectLocalPath: string; relativePath: string; json: string; }

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value as Record<string, unknown>).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function checkpointPath(taskKey: string, transitionId: string, stateHash: string): string {
  const safeTaskKey = taskKey.replace(/[^a-zA-Z0-9._-]/g, "_");
  const safeTransitionId = transitionId.replace(/[^a-zA-Z0-9._-]/g, "_");
  return `docs/.ccb/drafts/checkpoints/${safeTaskKey}/${safeTransitionId}-${stateHash.slice(0, 8)}.json`;
}

function serialize(row: TaskCheckpoint): CheckpointSummary {
  return { id: row.id, taskId: row.taskId, taskKey: row.taskKey, transitionId: row.transitionId, nodeBefore: row.nodeBefore, nodeAfter: row.nodeAfter, stateRevisionAfter: row.stateRevisionAfter, stateHash: row.stateHash, snapshotPath: row.snapshotPath, createdAt: row.createdAt.toISOString() };
}

export function taskProjectionSnapshot(input: { taskId: string; taskKey: string; currentNode: string | null; nodeSubstate?: string | null; runtimeState?: string | null; status?: string | null; lastTransitionId?: string | null; stateRevisionSeen: number; }): Record<string, unknown> {
  return { taskId: input.taskId, taskKey: input.taskKey, currentNode: input.currentNode, nodeSubstate: input.nodeSubstate ?? null, runtimeState: input.runtimeState ?? null, status: input.status ?? null, lastTransitionId: input.lastTransitionId ?? null, stateRevisionSeen: input.stateRevisionSeen };
}

export async function createTaskCheckpointInTransaction(tx: Prisma.TransactionClient, input: WriteCheckpointInput): Promise<{ checkpoint: TaskCheckpoint; pendingSnapshot: PendingSnapshotWrite | null }> {
  const json = canonicalJson(input.snapshot);
  const stateHash = createHash("sha256").update(json).digest("hex");
  const inline = Buffer.byteLength(json, "utf8") <= CHECKPOINT_INLINE_LIMIT_BYTES;
  const relativePath = inline ? null : checkpointPath(input.taskKey, input.transitionId, stateHash);
  const checkpoint = await primitiveExecutor.run({
    primitive: "create_task_checkpoint",
    mutationType: "prisma.taskCheckpoint.create",
    idempotencyKey: `${input.taskId}:checkpoint:${input.transitionId}`,
    run: async () =>
      await tx.taskCheckpoint.create({
        data: {
          taskId: input.taskId,
          taskKey: input.taskKey,
          transitionId: input.transitionId,
          nodeBefore: input.nodeBefore,
          nodeAfter: input.nodeAfter,
          stateRevisionAfter: input.stateRevisionAfter,
          stateHash,
          snapshotInline: inline ? json : null,
          snapshotPath: relativePath ? `pending:${relativePath}` : null
        }
      })
  });
  return { checkpoint, pendingSnapshot: relativePath ? { checkpointId: checkpoint.id, projectLocalPath: input.projectLocalPath, relativePath, json } : null };
}

export function scheduleCheckpointSnapshotWrite(pending: PendingSnapshotWrite | null): void {
  if (!pending) return;
  setImmediate(() => { void persistCheckpointSnapshot(pending); });
}

async function persistCheckpointSnapshot(pending: PendingSnapshotWrite): Promise<void> {
  const absolutePath = join(pending.projectLocalPath, pending.relativePath);
  await mkdir(dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, pending.json, "utf8");
  await primitiveExecutor.run({
    primitive: "mark_task_checkpoint_snapshot_written",
    mutationType: "prisma.taskCheckpoint.update",
    idempotencyKey: `${pending.checkpointId}:snapshot-written`,
    run: async () =>
      await prisma.taskCheckpoint.update({ where: { id: pending.checkpointId }, data: { snapshotPath: pending.relativePath } })
  });
}

export async function writeCheckpointForTransitionForTest(input: WriteCheckpointInput): Promise<TaskCheckpoint> {
  const { checkpoint, pendingSnapshot } = await prisma.$transaction(async (tx) => await createTaskCheckpointInTransaction(tx, input));
  scheduleCheckpointSnapshotWrite(pendingSnapshot);
  return checkpoint;
}

export async function listCheckpoints(taskId: string): Promise<CheckpointSummary[]> {
  const task = await prisma.task.findUnique({ where: { id: taskId }, select: { id: true } });
  if (!task) throw new CheckpointTaskNotFoundError();
  const rows = await prisma.taskCheckpoint.findMany({ where: { taskId }, orderBy: { createdAt: "asc" } });
  return rows.map(serialize);
}

export async function getCheckpoint(taskId: string, transitionId: string): Promise<CheckpointDetail | null> {
  const task = await prisma.task.findUnique({ where: { id: taskId }, select: { id: true, project: { select: { localPath: true } } } });
  if (!task) throw new CheckpointTaskNotFoundError();
  const row = await prisma.taskCheckpoint.findUnique({ where: { taskId_transitionId: { taskId, transitionId } } });
  if (!row) return null;
  const summary = serialize(row);
  if (row.snapshotInline) return { ...summary, snapshot: JSON.parse(row.snapshotInline) as Record<string, unknown> };
  if (row.snapshotPath && !row.snapshotPath.startsWith("pending:")) return { ...summary, snapshot: JSON.parse(await readFile(join(task.project.localPath, row.snapshotPath), "utf8")) as Record<string, unknown> };
  return { ...summary, snapshot: null };
}

export async function evictOldCheckpoints(taskId: string): Promise<number> {
  const task = await prisma.task.findUnique({ where: { id: taskId }, select: { currentNode: true } });
  if (!task) return 0;
  const rows = await prisma.taskCheckpoint.findMany({ where: { taskId }, orderBy: { createdAt: "asc" } });
  if (rows.length <= 50) return 0;
  const candidates = rows
    .filter((row) => row.nodeAfter !== task.currentNode && row.nodeAfter !== "archive")
    .slice(0, Math.max(0, rows.length - 5));
  const toDelete = candidates.slice(0, rows.length - 50);
  if (toDelete.length === 0) return 0;
  const result = await prisma.taskCheckpoint.deleteMany({ where: { id: { in: toDelete.map((row) => row.id) } } });
  return result.count;
}
