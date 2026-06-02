import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { Prisma, type ConsultRequest } from "@prisma/client";

import { prisma } from "../../db/prisma.js";
import { resolveCcbProjectRoot } from "../../lib/project-root.js";
import { primitiveExecutor } from "../primitive/primitive-wrapper.js";

export const CONSULT_REQUEST_MESSAGE_LIMIT = 4096;

export class ConsultRequestTaskNotFoundError extends Error { constructor() { super("任务不存在"); } }
export class ConsultRequestNodeMismatchError extends Error { constructor() { super("consult request node_id 与当前节点不匹配"); } }
export class ConsultRequestAgentNotAllowedError extends Error { constructor() { super("target_agent 不在 .ccb/ccb.config 白名单内"); } }
export class ConsultRequestPendingExistsError extends Error { constructor() { super("该任务已有 pending consult request"); } }
export class ConsultRequestNotFoundError extends Error { constructor() { super("consult request 不存在"); } }
export class ConsultRequestNotPendingError extends Error { constructor() { super("仅 pending consult request 可取消"); } }
export class ConsultRequestValidationError extends Error { constructor(message: string) { super(message); } }

export type SubmitConsultRequestInput = { taskId: string; nodeId: string; message: string; targetAgent: string; createdBy: string };

async function loadAllowedAgents(): Promise<Set<string>> {
  const path = resolve(resolveCcbProjectRoot(), ".ccb/ccb.config");
  if (!existsSync(path)) return new Set();
  const content = await readFile(path, "utf8");
  return new Set([
    ...[...content.matchAll(/^\s*\[agents\.([A-Za-z0-9_-]+)]\s*$/gm)].map((match) => match[1]),
    ...[...content.matchAll(/^\s*([A-Za-z0-9_-]+)\s*:/gm)].map((match) => match[1])
  ].filter((name): name is string => Boolean(name)));
}

export function serializeConsultRequest(row: ConsultRequest) {
  return {
    id: row.id,
    task_id: row.taskId,
    task_key: row.taskKey,
    node_id: row.nodeId,
    message: row.message,
    target_agent: row.targetAgent,
    status: row.status,
    consult_round: row.consultRound,
    created_by: row.createdBy,
    created_at: row.createdAt.toISOString(),
    consumed_at: row.consumedAt?.toISOString() ?? null
  };
}

export async function submitConsultRequest(input: SubmitConsultRequestInput): Promise<ConsultRequest> {
  const message = input.message.trim();
  if (!message || message.length > CONSULT_REQUEST_MESSAGE_LIMIT) throw new ConsultRequestValidationError("message 长度必须为 1..4096");
  const task = await prisma.task.findUnique({ where: { id: input.taskId }, select: { id: true, taskKey: true, currentNode: true } });
  if (!task) throw new ConsultRequestTaskNotFoundError();
  if (task.currentNode !== input.nodeId) throw new ConsultRequestNodeMismatchError();
  if (!(await loadAllowedAgents()).has(input.targetAgent)) throw new ConsultRequestAgentNotAllowedError();
  if (await prisma.consultRequest.count({ where: { taskId: task.id, status: "pending" } })) throw new ConsultRequestPendingExistsError();
  try {
    return await primitiveExecutor.run({
      primitive: "submit_consult_request",
      mutationType: "prisma.consultRequest.create",
      idempotencyKey: `${task.id}:consult_request:${input.nodeId}:${input.targetAgent}`,
      run: async () =>
        await prisma.consultRequest.create({
          data: { taskId: task.id, taskKey: task.taskKey, nodeId: input.nodeId, message, targetAgent: input.targetAgent, createdBy: input.createdBy }
        })
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") throw new ConsultRequestPendingExistsError();
    throw error;
  }
}

export async function getConsultRequest(taskId: string, id: string): Promise<ConsultRequest | null> {
  return await prisma.consultRequest.findFirst({ where: { taskId, id } });
}

export async function cancelConsultRequest(taskId: string, id: string): Promise<ConsultRequest> {
  const row = await getConsultRequest(taskId, id);
  if (!row) throw new ConsultRequestNotFoundError();
  if (row.status !== "pending") throw new ConsultRequestNotPendingError();
  return await primitiveExecutor.run({
    primitive: "cancel_consult_request",
    mutationType: "prisma.consultRequest.update",
    idempotencyKey: `${id}:cancel_consult_request`,
    run: async () => await prisma.consultRequest.update({ where: { id }, data: { status: "cancelled" } })
  });
}

export async function listPendingForTask(taskId: string): Promise<ConsultRequest[]> {
  return await prisma.consultRequest.findMany({ where: { taskId, status: "pending" }, orderBy: { createdAt: "asc" } });
}
