import { useCallback, useEffect, useState } from "react";

import { buildApiUrl } from "./console-api.js";

interface RawTaskConsultationEvent {
  event_id: string;
  sender: "claude" | "codex";
  receiver: "claude" | "codex";
  intent: string;
  intent_score?: number;
  tokens_in?: number;
  tokens_out?: number;
  at: string;
  payload_preview?: string;
}

interface RawTaskConsultationRound {
  round_number: number;
  node_id: string;
  events: RawTaskConsultationEvent[];
}

interface RawTaskConsultationResponse {
  rounds: RawTaskConsultationRound[];
}

export interface TaskConsultationEvent {
  id: string;
  sender: string;
  receiver: string;
  intent: string;
  score?: number;
  tokensIn?: number;
  tokensOut?: number;
  at: string;
  payloadPreview?: string;
}

export interface TaskConsultationRound {
  roundNumber: number;
  nodeId: string;
  events: TaskConsultationEvent[];
}

interface UseTaskConsultationResult {
  rounds: TaskConsultationRound[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<TaskConsultationRound[]>;
}

export function useTaskConsultation(taskId: string | null): UseTaskConsultationResult {
  const [rounds, setRounds] = useState<TaskConsultationRound[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!taskId) {
      setRounds([]);
      return [];
    }

    setLoading(true);
    setError(null);
    try {
      const nextRounds = await fetchTaskConsultation(taskId);
      setRounds(nextRounds);
      return nextRounds;
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "加载 Consultation 失败");
      return [];
    } finally {
      setLoading(false);
    }
  }, [taskId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return {
    rounds,
    loading,
    error,
    refresh
  };
}

export async function fetchTaskConsultation(taskId: string): Promise<TaskConsultationRound[]> {
  const payload = await requestJson<RawTaskConsultationResponse>(
    `/api/tasks/${encodeURIComponent(taskId)}/consultation`,
    "加载 Consultation 失败"
  );

  return payload.rounds.map((round) => ({
    roundNumber: round.round_number,
    nodeId: round.node_id,
    events: round.events.map((event) => ({
      id: event.event_id,
      sender: event.sender,
      receiver: event.receiver,
      intent: event.intent,
      ...(typeof event.intent_score === "number" ? { score: event.intent_score } : {}),
      ...(typeof event.tokens_in === "number" ? { tokensIn: event.tokens_in } : {}),
      ...(typeof event.tokens_out === "number" ? { tokensOut: event.tokens_out } : {}),
      at: event.at,
      ...(event.payload_preview ? { payloadPreview: event.payload_preview } : {})
    }))
  }));
}

async function requestJson<T>(path: string, fallbackMessage: string): Promise<T> {
  const response = await fetch(buildApiUrl(path));
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
