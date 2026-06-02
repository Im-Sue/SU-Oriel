import { useCallback, useEffect, useState } from "react";

import { buildApiUrl } from "../../../lib/console-api.js";
import { useProjectionChannel } from "./useProjectionChannel.js";
import type { ProjectionSignal } from "./useTaskEventStream.js";

interface RawConsultRequest {
  id: string;
  task_id: string;
  task_key: string;
  node_id: string;
  message: string;
  target_agent: string;
  status: string;
  consult_round: string | null;
  created_by: string;
  created_at: string;
  consumed_at: string | null;
}

interface ConsultRequestResponse {
  request?: RawConsultRequest;
  error?: string;
  message?: string;
}

export interface ConsultRequest {
  id: string;
  taskId: string;
  taskKey: string;
  nodeId: string;
  message: string;
  targetAgent: string;
  status: string;
  consultRound: string | null;
  createdBy: string;
  createdAt: string;
  consumedAt: string | null;
}

interface UsePendingConsultOptions {
  projectionSignal?: ProjectionSignal | null;
}

const DEFAULT_CCB_TOKEN = "dev-token";

function ccbToken(): string {
  return (import.meta.env.VITE_CCB_TOKEN as string | undefined)?.trim() || DEFAULT_CCB_TOKEN;
}

function toConsultRequest(raw: RawConsultRequest): ConsultRequest {
  return {
    id: raw.id,
    taskId: raw.task_id,
    taskKey: raw.task_key,
    nodeId: raw.node_id,
    message: raw.message,
    targetAgent: raw.target_agent,
    status: raw.status,
    consultRound: raw.consult_round,
    createdBy: raw.created_by,
    createdAt: raw.created_at,
    consumedAt: raw.consumed_at
  };
}

async function responsePayload(response: Response): Promise<ConsultRequestResponse> {
  try {
    return (await response.json()) as ConsultRequestResponse;
  } catch {
    return {};
  }
}

function submitErrorMessage(status: number, payload: ConsultRequestResponse): string {
  const detail = payload.error ?? payload.message ?? "";
  if (status === 401) return "未授权：缺少或无效的 x-ccb-token。";
  if (status === 429) return "请求过于频繁，请 30 秒后重试。";
  if (status === 409 && /node_id|不匹配/.test(detail)) return "当前节点已变化，请刷新后重试。";
  if (status === 409 && /pending|已有/.test(detail)) return "该任务已有 pending consult request，请等待或取消后再试。";
  return detail || "提交 consult request 失败。";
}

export function usePendingConsult(taskId: string | null, nodeId: string | null, options: UsePendingConsultOptions = {}) {
  const [pending, setPending] = useState<ConsultRequest | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const ownProjection = useProjectionChannel(options.projectionSignal === undefined ? taskId : null);
  const projectionSignal = options.projectionSignal === undefined ? ownProjection.latest : options.projectionSignal;

  const submit = useCallback(async (message: string, targetAgent = "ccb_codex"): Promise<ConsultRequest | null> => {
    const trimmed = message.trim();
    if (!taskId || !nodeId || !trimmed) { setSubmitError("请输入 consult 内容。"); return null; }
    setSubmitting(true); setSubmitError(null);
    try {
      const response = await fetch(buildApiUrl(`/api/tasks/${encodeURIComponent(taskId)}/nodes/${encodeURIComponent(nodeId)}/consult-requests`), {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-ccb-token": ccbToken() },
        body: JSON.stringify({ message: trimmed, target_agent: targetAgent })
      });
      const payload = await responsePayload(response);
      if (!response.ok || !payload.request) throw new Error(submitErrorMessage(response.status, payload));
      const next = toConsultRequest(payload.request);
      setPending(next);
      return next;
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : "提交 consult request 失败。");
      return null;
    } finally {
      setSubmitting(false);
    }
  }, [nodeId, taskId]);

  const cancel = useCallback(async (id: string): Promise<ConsultRequest | null> => {
    if (!taskId || !id) return null;
    setSubmitError(null);
    try {
      const response = await fetch(buildApiUrl(`/api/tasks/${encodeURIComponent(taskId)}/consult-requests/${encodeURIComponent(id)}`), {
        method: "DELETE",
        headers: { "x-ccb-token": ccbToken() }
      });
      const payload = await responsePayload(response);
      if (!response.ok || !payload.request) throw new Error(submitErrorMessage(response.status, payload));
      const next = toConsultRequest(payload.request);
      setPending(null);
      return next;
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : "取消 consult request 失败。");
      return null;
    }
  }, [taskId]);

  useEffect(() => {
    if (projectionSignal?.kind !== "consult_round_added" || projectionSignal.task_id !== taskId) return;
    const requestId = projectionSignal.payload.consult_request_id;
    setPending((current) => requestId && current?.id !== requestId ? current : null);
  }, [projectionSignal?.emitted_at, projectionSignal?.kind, projectionSignal?.payload, projectionSignal?.task_id, taskId]);

  return { pending, submit, cancel, submitting, submitError };
}
