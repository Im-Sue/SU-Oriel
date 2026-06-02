import { useCallback, useEffect, useState } from "react";

import { buildApiUrl } from "../../../lib/console-api.js";
import type { TaskCheckpointDetail, TaskCheckpointSummary } from "../types.js";

export function useTaskCheckpoints(taskId: string | null, options: { pollingMs?: number } = {}) {
  const [checkpoints, setCheckpoints] = useState<TaskCheckpointSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pollingMs = options.pollingMs ?? 30000;
  const refetch = useCallback(async () => {
    if (!taskId) { setCheckpoints([]); return []; }
    setLoading(true); setError(null);
    try {
      const response = await fetch(buildApiUrl(`/api/tasks/${encodeURIComponent(taskId)}/checkpoints`));
      if (!response.ok) throw new Error("加载 checkpoints 失败");
      const next = (await response.json()) as TaskCheckpointSummary[];
      setCheckpoints(next);
      return next;
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "加载 checkpoints 失败");
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
  return { checkpoints, loading, error, refetch };
}

export function useTaskCheckpoint(taskId: string | null, transitionId: string | null) {
  const [checkpoint, setCheckpoint] = useState<TaskCheckpointDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const refetch = useCallback(async () => {
    if (!taskId || !transitionId) { setCheckpoint(null); return null; }
    setLoading(true); setError(null);
    try {
      const response = await fetch(buildApiUrl(`/api/tasks/${encodeURIComponent(taskId)}/checkpoints/${encodeURIComponent(transitionId)}`));
      if (!response.ok) throw new Error("加载 checkpoint 失败");
      const next = (await response.json()) as TaskCheckpointDetail;
      setCheckpoint(next);
      return next;
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "加载 checkpoint 失败");
      return null;
    } finally {
      setLoading(false);
    }
  }, [taskId, transitionId]);
  useEffect(() => { void refetch(); }, [refetch]);
  return { checkpoint, loading, error, refetch };
}
