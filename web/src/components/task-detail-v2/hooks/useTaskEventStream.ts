import { useCallback, useEffect, useRef, useState } from "react";

import { buildApiUrl } from "../../../lib/console-api.js";
import { type ProjectionSignal, type SseEvent, type StreamStatus, useSharedTaskEventStream } from "./useSharedTaskEventStream.js";

export { lastEventIdKey } from "./useSharedTaskEventStream.js";
export type { ProjectionSignal, ProjectionSignalKind, SseEvent, StreamStatus } from "./useSharedTaskEventStream.js";

interface Options {
  fallbackAfterMs?: number;
  pollingIntervalMs?: number;
  onProjectionSignal?: (signal: ProjectionSignal) => void;
}

function timelineEventToSse(event: { kind: string; at: string; label: string; details?: Record<string, unknown> }): SseEvent {
  return { event_id: `${event.kind}:${event.at}`, event_type: event.kind, emitted_at: event.at, payload: { ...(event.details ?? {}), label: event.label } };
}

export function useTaskEventStream(taskId: string | null, options: Options = {}) {
  const [events, setEvents] = useState<SseEvent[]>([]);
  const [fallbackStatus, setFallbackStatus] = useState<StreamStatus | null>(null);
  const [fallbackError, setFallbackError] = useState<string | null>(null);
  const fallbackTimerRef = useRef(0);
  const pollingTimerRef = useRef(0);
  const fallbackAfterMs = options.fallbackAfterMs ?? 30000;
  const pollingIntervalMs = options.pollingIntervalMs ?? 5000;
  const onProjectionSignal = options.onProjectionSignal;

  const clearTimers = useCallback(() => {
    window.clearTimeout(fallbackTimerRef.current);
    window.clearInterval(pollingTimerRef.current);
  }, []);

  const poll = useCallback(async () => {
    if (!taskId) return;
    try {
      const response = await fetch(buildApiUrl(`/api/tasks/${encodeURIComponent(taskId)}/timeline`));
      if (!response.ok) throw new Error("timeline polling failed");
      const payload = (await response.json()) as { events?: Array<{ kind: string; at: string; label: string; details?: Record<string, unknown> }> };
      setEvents((payload.events ?? []).map(timelineEventToSse));
    } catch (error) {
      setFallbackError(error instanceof Error ? error.message : "timeline polling failed");
      setFallbackStatus("failed");
    }
  }, [taskId]);

  const startFallback = useCallback(() => {
    clearTimers();
    if (!fallbackAfterMs) return;
    fallbackTimerRef.current = window.setTimeout(() => {
      void poll();
      pollingTimerRef.current = window.setInterval(() => void poll(), pollingIntervalMs);
    }, fallbackAfterMs);
  }, [clearTimers, fallbackAfterMs, poll, pollingIntervalMs]);

  const shared = useSharedTaskEventStream(taskId, {
    onOpen: () => { setFallbackStatus(null); setFallbackError(null); startFallback(); },
    onEvent: (event) => { setEvents((items) => [...items, event]); setFallbackStatus(null); setFallbackError(null); startFallback(); },
    onProjection: onProjectionSignal,
    onError: (message) => { setFallbackError(message); }
  });

  useEffect(() => {
    setEvents([]);
    setFallbackStatus(null);
    setFallbackError(null);
    startFallback();
    return clearTimers;
  }, [clearTimers, startFallback, taskId]);

  return { events, status: fallbackStatus ?? shared.status, lastError: fallbackError ?? shared.lastError, reconnect: shared.reconnect };
}
