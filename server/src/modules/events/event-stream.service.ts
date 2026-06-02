import { prisma } from "../../db/prisma.js";
import { eventJournalRowToEnvelope, type EmittedEvent } from "./event-journal.projector.js";

export const EVENT_STREAM_POLLING_INTERVAL_MS = 1000;
export const EVENT_STREAM_HEARTBEAT_INTERVAL_MS = 30000;
export const EVENT_STREAM_BUFFER_LIMIT = 1024;

export type EventStreamCursor = { id: string; emittedAt: Date };
export type EventStreamCursorError = { kind: "cursor_not_found"; taskId: string; requestedEventId: string };
export type EventStreamCursorResult = { ok: true; cursor: EventStreamCursor | null } | { ok: false; error: EventStreamCursorError };
export type ProjectionSignalKind = "stale_projection_changed" | "interaction_pending_changed" | "checkpoint_added" | "consult_round_added";
export interface ProjectionSignal { kind: ProjectionSignalKind; task_id: string; emitted_at: string; payload: Record<string, unknown>; }
type ProjectionSignalListener = (signal: ProjectionSignal) => boolean | void;

const projectionListeners = new Map<string, Set<ProjectionSignalListener>>();

export interface StreamTaskEventsOptions {
  pollingIntervalMs?: number;
  heartbeatIntervalMs?: number;
  bufferLimit?: number;
  initialCursor?: EventStreamCursor | null;
  abortSignal?: AbortSignal;
  logger?: { warn: (obj: unknown, message: string) => void };
  onHeartbeat?: () => void;
  onProjectionSignal?: ProjectionSignalListener;
}

export interface EventStreamController { close: () => void; }

export function subscribeProjectionSignals(taskId: string, listener: ProjectionSignalListener): () => void {
  const listeners = projectionListeners.get(taskId) ?? new Set<ProjectionSignalListener>();
  listeners.add(listener);
  projectionListeners.set(taskId, listeners);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) projectionListeners.delete(taskId);
  };
}

export function publishProjectionSignal(signal: ProjectionSignal): void {
  for (const listener of [...(projectionListeners.get(signal.task_id) ?? [])]) {
    try {
      listener(signal);
    } catch {
      // Projection delivery is best-effort and must not affect the source mutation.
    }
  }
}

export async function resolveEventStreamCursor(taskId: string, eventId?: string): Promise<EventStreamCursorResult> {
  const select = { id: true, emittedAt: true } as const;
  if (eventId) {
    const resumed = await prisma.eventJournal.findFirst({
      where: { subjectType: "subtask", subjectId: taskId, eventId },
      select
    });
    return resumed ? { ok: true, cursor: resumed } : { ok: false, error: { kind: "cursor_not_found", taskId, requestedEventId: eventId } };
  }
  const cursor = await prisma.eventJournal.findFirst({
    where: { subjectType: "subtask", subjectId: taskId },
    orderBy: [{ emittedAt: "desc" }, { id: "desc" }],
    select
  });
  return { ok: true, cursor };
}

export async function streamTaskEvents(
  taskId: string,
  fromEventId: string | undefined,
  onEvent: (event: EmittedEvent) => boolean | void,
  onError: (error: unknown) => void,
  onClose: () => void,
  options: StreamTaskEventsOptions = {}
): Promise<EventStreamController> {
  const pollingIntervalMs = options.pollingIntervalMs ?? EVENT_STREAM_POLLING_INTERVAL_MS;
  const heartbeatIntervalMs = options.heartbeatIntervalMs ?? EVENT_STREAM_HEARTBEAT_INTERVAL_MS;
  const bufferLimit = options.bufferLimit ?? EVENT_STREAM_BUFFER_LIMIT;
  const signal = options.abortSignal;
  let cursor: EventStreamCursor | null = null;
  let closed = false;
  let polling = false;
  let pollTimer: NodeJS.Timeout | undefined, heartbeatTimer: NodeJS.Timeout | undefined;
  let abortHandler: (() => void) | undefined, unsubscribeProjection: (() => void) | undefined;
  const close = () => {
    if (closed) return;
    closed = true;
    if (pollTimer) clearInterval(pollTimer);
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    if (abortHandler) signal?.removeEventListener("abort", abortHandler);
    unsubscribeProjection?.();
    onClose();
  };
  if (signal) {
    abortHandler = () => close();
    if (signal.aborted) { closed = true; return { close }; }
    signal.addEventListener("abort", abortHandler, { once: true });
  }
  const resolved: EventStreamCursorResult = Object.prototype.hasOwnProperty.call(options, "initialCursor") ? { ok: true, cursor: options.initialCursor ?? null } : await resolveEventStreamCursor(taskId, fromEventId);
  if (!resolved.ok) { onError(resolved.error); close(); return { close }; }
  cursor = resolved.cursor;
  if (options.onProjectionSignal) {
    unsubscribeProjection = subscribeProjectionSignals(taskId, (projectionSignal) => {
      if (closed || signal?.aborted) return;
      if (options.onProjectionSignal?.(projectionSignal) === false) close();
    });
  }
  const poll = async () => {
    if (closed || polling || signal?.aborted) return;
    polling = true;
    try {
      const rows = await prisma.eventJournal.findMany({
        where: cursor
          ? { subjectType: "subtask", subjectId: taskId, OR: [{ emittedAt: { gt: cursor.emittedAt } }, { emittedAt: cursor.emittedAt, id: { gt: cursor.id } }] }
          : { subjectType: "subtask", subjectId: taskId },
        orderBy: [{ emittedAt: "asc" }, { id: "asc" }],
        take: bufferLimit + 1
      });
      const buffer: EmittedEvent[] = [];
      for (const row of rows) {
        if (signal?.aborted) return close();
        cursor = { id: row.id, emittedAt: row.emittedAt };
        const projected = eventJournalRowToEnvelope(row);
        if (!projected.ok) {
          options.logger?.warn({ event_id: row.eventId, kind: projected.error.kind }, "EventJournal projection skipped");
          continue;
        }
        buffer.push(projected.value);
        if (buffer.length > bufferLimit) return close();
      }
      for (const event of buffer) if (signal?.aborted || onEvent(event) === false) return close();
    } catch (error) {
      onError(error);
      close();
    } finally {
      polling = false;
    }
  };
  await poll();
  if (!closed && !signal?.aborted) {
    pollTimer = setInterval(() => void poll(), pollingIntervalMs);
    heartbeatTimer = setInterval(() => signal?.aborted ? close() : options.onHeartbeat?.(), heartbeatIntervalMs);
  }
  return { close };
}
