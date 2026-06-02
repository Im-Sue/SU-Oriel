import { useCallback, useEffect, useState } from "react";

import { buildApiUrl } from "./console-api.js";

export interface ActivityEvent {
  eventId: string;
  eventType: string;
  taskId?: string;
  projectId?: string;
  at: string;
  summary?: string;
  payload: Record<string, unknown>;
}

interface RawActivityEvent {
  event_id: string;
  event_type: string;
  task_id?: string;
  project_id?: string;
  at: string;
  summary?: string;
  payload?: Record<string, unknown>;
}

interface RawActivityResponse {
  events: RawActivityEvent[];
}

interface UseActivityRecentOptions {
  enabled?: boolean;
  limit?: number;
}

interface UseActivityRecentResult {
  events: ActivityEvent[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<ActivityEvent[]>;
}

export function useActivityRecent(options: UseActivityRecentOptions = {}): UseActivityRecentResult {
  const enabled = options.enabled ?? true;
  const limit = options.limit ?? 10;
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!enabled) {
      setEvents([]);
      return [];
    }

    setLoading(true);
    setError(null);
    try {
      const nextEvents = await fetchActivityRecent(limit);
      setEvents(nextEvents);
      return nextEvents;
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "加载 Activity Feed 失败");
      return [];
    } finally {
      setLoading(false);
    }
  }, [enabled, limit]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return {
    events,
    loading,
    error,
    refresh
  };
}

export async function fetchActivityRecent(limit = 10): Promise<ActivityEvent[]> {
  const payload = await requestJson<RawActivityResponse>(
    `/api/activity/recent?limit=${encodeURIComponent(String(limit))}`,
    "加载 Activity Feed 失败"
  );

  return payload.events.map((event) => ({
    eventId: event.event_id,
    eventType: event.event_type,
    ...(event.task_id ? { taskId: event.task_id } : {}),
    ...(event.project_id ? { projectId: event.project_id } : {}),
    at: event.at,
    ...(event.summary ? { summary: event.summary } : {}),
    payload: event.payload ?? {}
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
