import { useCallback, useEffect, useRef, useState } from "react";

import { buildApiUrl } from "../../../lib/console-api.js";

export type StreamStatus = "connecting" | "open" | "reconnecting" | "failed";
export interface SseEvent { event_id: string; event_type: string; emitted_at: string; payload?: Record<string, unknown>; [key: string]: unknown; }
export type ProjectionSignalKind = "stale_projection_changed" | "interaction_pending_changed" | "checkpoint_added" | "consult_round_added";
export interface ProjectionSignal { kind: ProjectionSignalKind; task_id: string; emitted_at: string; payload: Record<string, unknown>; }

export const lastEventIdKey = (taskId: string) => `task-detail-v2:lastEventId:${taskId}`;

type SharedMessage =
  | { type: "open" }
  | { type: "event"; event: SseEvent }
  | { type: "projection"; signal: ProjectionSignal }
  | { type: "error"; message: string };

interface SharedOptions {
  onEvent?: (event: SseEvent) => void;
  onProjection?: (signal: ProjectionSignal) => void;
  onOpen?: () => void;
  onError?: (message: string) => void;
}

interface StreamEntry {
  taskId: string;
  eventSource: EventSource | null;
  refCount: number;
  subscribers: Set<(message: SharedMessage) => void>;
  status: StreamStatus;
  lastError: string | null;
  retryTimer: number;
  attempt: number;
}

const streams = new Map<string, StreamEntry>();

function cursorUrl(taskId: string, lastEventId: string | null): string {
  const path = `/api/tasks/${encodeURIComponent(taskId)}/events`;
  return buildApiUrl(lastEventId ? `${path}?since=${encodeURIComponent(lastEventId)}` : path);
}

async function cursorGone(taskId: string, lastEventId: string): Promise<boolean> {
  try {
    const response = await fetch(cursorUrl(taskId, lastEventId), { headers: { Accept: "text/event-stream" } });
    await response.body?.cancel();
    return response.status === 410;
  } catch {
    return false;
  }
}

function notify(entry: StreamEntry, message: SharedMessage): void {
  for (const subscriber of entry.subscribers) subscriber(message);
}

function scheduleReconnect(entry: StreamEntry, delay?: number): void {
  window.clearTimeout(entry.retryTimer);
  const wait = delay ?? Math.min(30000, 1000 * 2 ** entry.attempt++);
  entry.retryTimer = window.setTimeout(() => {
    if (entry.refCount > 0) startConnection(entry);
  }, wait);
}

function startConnection(entry: StreamEntry): void {
  window.clearTimeout(entry.retryTimer);
  entry.eventSource?.close();
  const currentCursor = localStorage.getItem(lastEventIdKey(entry.taskId));
  entry.status = entry.status === "reconnecting" ? "reconnecting" : "connecting";
  entry.lastError = null;

  const source = new EventSource(cursorUrl(entry.taskId, currentCursor));
  entry.eventSource = source;
  source.addEventListener("open", () => {
    entry.attempt = 0;
    entry.status = "open";
    notify(entry, { type: "open" });
  });
  source.addEventListener("message", (message) => {
    const event = JSON.parse((message as MessageEvent<string>).data) as SseEvent;
    localStorage.setItem(lastEventIdKey(entry.taskId), event.event_id);
    entry.status = "open";
    notify(entry, { type: "event", event });
  });
  source.addEventListener("projection", (message) => {
    const signal = JSON.parse((message as MessageEvent<string>).data) as ProjectionSignal;
    notify(entry, { type: "projection", signal });
  });
  source.addEventListener("error", (error) => {
    entry.lastError = "SSE connection failed";
    entry.status = "reconnecting";
    source.close();
    if (entry.eventSource === source) entry.eventSource = null;
    notify(entry, { type: "error", message: entry.lastError });
    const statusCode = (error as Event & { status?: number }).status;
    if (statusCode === 410) {
      localStorage.removeItem(lastEventIdKey(entry.taskId));
      entry.attempt = 0;
      scheduleReconnect(entry, 0);
      return;
    }
    if (currentCursor) void cursorGone(entry.taskId, currentCursor).then((gone) => {
      if (gone) {
        localStorage.removeItem(lastEventIdKey(entry.taskId));
        entry.attempt = 0;
        scheduleReconnect(entry, 0);
      }
    });
    scheduleReconnect(entry);
  });
}

function ensureEntry(taskId: string): StreamEntry {
  const current = streams.get(taskId);
  if (current) return current;
  const entry: StreamEntry = { taskId, eventSource: null, refCount: 0, subscribers: new Set(), status: "connecting", lastError: null, retryTimer: 0, attempt: 0 };
  streams.set(taskId, entry);
  startConnection(entry);
  return entry;
}

function releaseEntry(taskId: string): void {
  const entry = streams.get(taskId);
  if (!entry || entry.refCount > 0) return;
  window.clearTimeout(entry.retryTimer);
  entry.eventSource?.close();
  streams.delete(taskId);
}

function reconnectSharedTaskEventStream(taskId: string): void {
  const entry = streams.get(taskId);
  if (!entry) return;
  entry.attempt = 0;
  entry.status = "reconnecting";
  notify(entry, { type: "error", message: entry.lastError ?? "SSE connection failed" });
  startConnection(entry);
}

export function useSharedTaskEventStream(taskId: string | null, options: SharedOptions = {}) {
  const optionsRef = useRef(options);
  const [status, setStatus] = useState<StreamStatus>(taskId ? "connecting" : "failed");
  const [lastError, setLastError] = useState<string | null>(null);
  optionsRef.current = options;

  useEffect(() => {
    if (!taskId) {
      setStatus("failed");
      setLastError(null);
      return undefined;
    }
    const entry = ensureEntry(taskId);
    entry.refCount += 1;
    setStatus(entry.status);
    setLastError(entry.lastError);
    const subscriber = (message: SharedMessage) => {
      if (message.type === "open") {
        setStatus("open");
        setLastError(null);
        optionsRef.current.onOpen?.();
      } else if (message.type === "event") {
        setStatus("open");
        optionsRef.current.onEvent?.(message.event);
      } else if (message.type === "projection") {
        optionsRef.current.onProjection?.(message.signal);
      } else {
        setStatus("reconnecting");
        setLastError(message.message);
        optionsRef.current.onError?.(message.message);
      }
    };
    entry.subscribers.add(subscriber);
    return () => {
      entry.subscribers.delete(subscriber);
      entry.refCount -= 1;
      releaseEntry(taskId);
    };
  }, [taskId]);

  const reconnect = useCallback(() => {
    if (taskId) reconnectSharedTaskEventStream(taskId);
  }, [taskId]);

  return { status, lastError, reconnect };
}
