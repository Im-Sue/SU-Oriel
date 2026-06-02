import { useCallback, useEffect, useState } from "react";

import { buildApiUrl } from "../../../lib/console-api.js";
import type { PendingInteraction } from "../types.js";

interface RawPendingInteraction { id: string; kind: PendingInteraction["kind"]; source_table: string; node_id?: string; summary: string; cta_label: string; cta_action: string; created_at: string; raw_ref: string; }
interface RawPendingResponse { pending: RawPendingInteraction[]; }

export function snakeToCamelPendingInteraction(raw: RawPendingInteraction): PendingInteraction {
  return { id: raw.id, kind: raw.kind, nodeId: raw.node_id ?? "", sourceTable: raw.source_table, summary: raw.summary, ctaLabel: raw.cta_label, ctaAction: raw.cta_action, createdAt: raw.created_at, rawRef: raw.raw_ref };
}

export function usePendingInteractions(taskId: string | null, options: { pollingMs?: number } = {}) {
  const [data, setData] = useState<PendingInteraction[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pollingMs = options.pollingMs ?? 30000;

  const refetch = useCallback(async () => {
    if (!taskId) { setData([]); return []; }
    setLoading(true); setError(null);
    try {
      const response = await fetch(buildApiUrl(`/api/tasks/${encodeURIComponent(taskId)}/pending-interactions`));
      if (!response.ok) throw new Error("加载 pending interactions 失败");
      const payload = (await response.json()) as RawPendingResponse;
      const next = payload.pending.map(snakeToCamelPendingInteraction);
      setData(next);
      return next;
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "加载 pending interactions 失败");
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

  return { data, loading, error, refetch };
}
