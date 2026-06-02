import { useCallback, useEffect, useState } from "react";

import { buildApiUrl } from "./console-api.js";

const DEFAULT_POLL_INTERVAL_MS = 30_000;

type TaskNodeFlowVerdict = "pass" | "wait" | "fail";
type TaskNodeFlowGuardStatus = "satisfied" | "blocked";
type TaskNodeFlowApplicability = "user_actionable" | "system_only";

interface RawTaskNodeFlowTransition {
  transition_id: string;
  source_node: string;
  target_node: string;
  verdict: TaskNodeFlowVerdict;
  at: string;
  evidence_ref?: string;
}

interface RawTaskNodeFlowAction {
  transition_id: string;
  label: string;
  guard_status: TaskNodeFlowGuardStatus;
  applicability: TaskNodeFlowApplicability;
  guard_reason?: string;
}

interface RawTaskNodeFlowResponse {
  currentNode: string;
  nodeSubstate: string;
  runtimeState: string;
  lastTransitionId: string | null;
  lastTransitionAt: string | null;
  transitions: RawTaskNodeFlowTransition[];
  applicable_actions: RawTaskNodeFlowAction[];
}

export interface TaskNodeFlowTransition {
  transitionId: string;
  sourceNode: string;
  targetNode: string;
  verdict: TaskNodeFlowVerdict;
  at: string;
}

export interface TaskNodeFlowAction {
  transitionId: string;
  label: string;
  guardStatus: TaskNodeFlowGuardStatus;
  applicability: TaskNodeFlowApplicability;
  guardReason?: string;
}

export interface TaskNodeFlowView {
  currentNode: string;
  nodeSubstate: string;
  runtimeState: string;
  lastTransitionId: string | null;
  lastTransitionAt: string | null;
  transitions: TaskNodeFlowTransition[];
  applicableActions: TaskNodeFlowAction[];
}

interface UseTaskNodeFlowOptions {
  pollIntervalMs?: number;
}

interface UseTaskNodeFlowResult {
  data: TaskNodeFlowView | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<TaskNodeFlowView | null>;
}

export function useTaskNodeFlow(taskId: string | null, options: UseTaskNodeFlowOptions = {}): UseTaskNodeFlowResult {
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const [data, setData] = useState<TaskNodeFlowView | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!taskId) {
      setData(null);
      return null;
    }

    setLoading(true);
    setError(null);
    try {
      const nextData = await fetchTaskNodeFlow(taskId);
      setData(nextData);
      return nextData;
    } catch (nextError) {
      const message = nextError instanceof Error ? nextError.message : "加载 Node Flow 失败";
      setError(message);
      return null;
    } finally {
      setLoading(false);
    }
  }, [taskId]);

  useEffect(() => {
    if (!taskId) {
      setData(null);
      setError(null);
      setLoading(false);
      return;
    }

    let active = true;

    const load = async (showLoading: boolean) => {
      if (showLoading) {
        setLoading(true);
      }
      setError(null);
      try {
        const nextData = await fetchTaskNodeFlow(taskId);
        if (active) {
          setData(nextData);
        }
      } catch (nextError) {
        if (active) {
          setError(nextError instanceof Error ? nextError.message : "加载 Node Flow 失败");
        }
      } finally {
        if (active && showLoading) {
          setLoading(false);
        }
      }
    };

    void load(true);
    const timer =
      pollIntervalMs > 0
        ? window.setInterval(() => {
            if (document.visibilityState !== "hidden") {
              void load(false);
            }
          }, pollIntervalMs)
        : null;

    return () => {
      active = false;
      if (timer !== null) {
        window.clearInterval(timer);
      }
    };
  }, [pollIntervalMs, taskId]);

  return {
    data,
    loading,
    error,
    refresh
  };
}

export async function fetchTaskNodeFlow(taskId: string): Promise<TaskNodeFlowView> {
  const payload = await requestJson<RawTaskNodeFlowResponse>(
    `/api/tasks/${encodeURIComponent(taskId)}/node-flow`,
    "加载 Node Flow 失败"
  );
  return normalizeTaskNodeFlow(payload);
}

function normalizeTaskNodeFlow(payload: RawTaskNodeFlowResponse): TaskNodeFlowView {
  return {
    currentNode: payload.currentNode,
    nodeSubstate: payload.nodeSubstate,
    runtimeState: payload.runtimeState,
    lastTransitionId: payload.lastTransitionId,
    lastTransitionAt: payload.lastTransitionAt,
    transitions: payload.transitions.map((transition) => ({
      transitionId: transition.transition_id,
      sourceNode: transition.source_node,
      targetNode: transition.target_node,
      verdict: transition.verdict,
      at: transition.at
    })),
    applicableActions: payload.applicable_actions.map((action) => ({
      transitionId: action.transition_id,
      label: action.label,
      guardStatus: action.guard_status,
      applicability: action.applicability,
      ...(action.guard_reason ? { guardReason: action.guard_reason } : {})
    }))
  };
}

async function requestJson<T>(path: string, fallbackMessage: string, init?: RequestInit): Promise<T> {
  const response = init ? await fetch(buildApiUrl(path), init) : await fetch(buildApiUrl(path));
  if (!response.ok) {
    throw new Error(await parseApiErrorMessage(response, fallbackMessage));
  }

  return (await response.json()) as T;
}

async function parseApiErrorMessage(response: Response, fallbackMessage: string): Promise<string> {
  const contentType = response.headers.get("Content-Type") ?? "";
  if (contentType.includes("application/json")) {
    try {
      const payload = (await response.json()) as { message?: string };
      if (payload.message?.trim()) {
        return payload.message;
      }
    } catch {
      return fallbackMessage;
    }
  }

  try {
    const text = await response.text();
    return text.trim() || fallbackMessage;
  } catch {
    return fallbackMessage;
  }
}
