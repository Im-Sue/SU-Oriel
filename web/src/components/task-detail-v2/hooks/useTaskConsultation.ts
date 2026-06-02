import { useCallback, useEffect, useState } from "react";

import { buildApiUrl } from "../../../lib/console-api.js";
import { useProjectionChannel } from "./useProjectionChannel.js";
import type { ProjectionSignal } from "./useTaskEventStream.js";

interface RawConsultRecord {
  round?: string;
  layer?: string;
  input_summary?: string;
  codex_reply?: unknown;
  unsolicited_findings?: unknown[];
  stop_reason?: string;
  timestamp?: string;
  [key: string]: unknown;
}

interface RawConsultRecordsResponse {
  consult_records?: RawConsultRecord[];
}

export interface ConsultRound {
  round: string;
  nodeId: string;
  inputSummary: string;
  codexReply: unknown;
  unsolicitedFindings: unknown[];
  stopReason: string;
  timestamp: string;
  raw: RawConsultRecord;
}

interface UseTaskConsultationOptions {
  pollingMs?: number;
  projectionSignal?: ProjectionSignal | null;
}

export function snakeToCamelConsultRound(raw: RawConsultRecord, index = 0): ConsultRound {
  return {
    round: typeof raw.round === "string" && raw.round.trim() ? raw.round : `R${index + 1}`,
    nodeId: typeof raw.layer === "string" ? raw.layer : "",
    inputSummary: typeof raw.input_summary === "string" ? raw.input_summary : "",
    codexReply: raw.codex_reply ?? null,
    unsolicitedFindings: Array.isArray(raw.unsolicited_findings) ? raw.unsolicited_findings : [],
    stopReason: typeof raw.stop_reason === "string" ? raw.stop_reason : "",
    timestamp: typeof raw.timestamp === "string" ? raw.timestamp : "",
    raw
  };
}

export function useTaskConsultation(taskId: string | null, options: UseTaskConsultationOptions = {}) {
  const [rounds, setRounds] = useState<ConsultRound[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pollingMs = options.pollingMs ?? 30000;
  const ownProjection = useProjectionChannel(options.projectionSignal === undefined ? taskId : null);
  const projectionSignal = options.projectionSignal === undefined ? ownProjection.latest : options.projectionSignal;

  const refetch = useCallback(async () => {
    if (!taskId) { setRounds([]); return []; }
    setLoading(true); setError(null);
    try {
      const response = await fetch(buildApiUrl(`/api/tasks/${encodeURIComponent(taskId)}/consult-records`));
      if (!response.ok) throw new Error("加载 consult records 失败");
      const payload = (await response.json()) as RawConsultRecordsResponse;
      const next = (payload.consult_records ?? []).map(snakeToCamelConsultRound);
      setRounds(next);
      return next;
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "加载 consult records 失败");
      return [];
    } finally {
      setLoading(false);
    }
  }, [taskId]);

  useEffect(() => {
    void refetch();
    if (!pollingMs) return undefined;
    const timer = window.setInterval(() => void refetch(), pollingMs);
    return () => window.clearInterval(timer);
  }, [pollingMs, refetch]);

  useEffect(() => {
    if (projectionSignal?.kind !== "consult_round_added" || projectionSignal.task_id !== taskId) return;
    void refetch();
  }, [projectionSignal?.emitted_at, projectionSignal?.kind, projectionSignal?.task_id, refetch, taskId]);

  return { rounds, loading, error, refetch };
}
