import { useCallback, useMemo, useState } from "react";

import { useSharedTaskEventStream } from "./useSharedTaskEventStream.js";
import type { ProjectionSignal, ProjectionSignalKind } from "./useTaskEventStream.js";

export function useProjectionChannel(taskId: string | null) {
  const [signals, setSignals] = useState<ProjectionSignal[]>([]);
  const onProjectionSignal = useCallback((signal: ProjectionSignal) => {
    setSignals((items) => [...items, signal]);
  }, []);
  useSharedTaskEventStream(taskId, { onProjection: onProjectionSignal });
  const latest = signals.at(-1);
  const byKind = useCallback((kind: ProjectionSignalKind) => signals.filter((signal) => signal.kind === kind), [signals]);
  return useMemo(() => ({ signals, latest, byKind }), [byKind, latest, signals]);
}
