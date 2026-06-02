import { useCallback, useEffect, useMemo, useState } from "react";

import { buildApiUrl } from "./console-api.js";
import { NODE_BOARD_COLUMNS } from "./node-board-config.js";
import type {
  CapabilityMatrixCapability,
  CapabilityMatrixCell
} from "../components/capability/CapabilityMatrix.js";

type CapabilityRegistryStatus = "active" | "deprecated" | "disabled";
type MatrixCellStatus = CapabilityMatrixCell["status"];

interface RawCapabilityStatusItem {
  name: string;
  binding_source: "project" | "user" | "global";
  status: CapabilityRegistryStatus;
  last_used_at: string | null;
}

interface RawCapabilityStatusResponse {
  version: "cap-matrix-v0.1";
  capabilities: RawCapabilityStatusItem[];
}

interface RawNodeRunCapabilityDecision {
  capability_requested: string;
  resolved_binding: string | null;
  decision_at: string;
  old_hint_fallback_count?: number;
  outcome?: string;
  status?: string;
  result?: string;
  fallback_chain?: unknown[];
  evidence_ref?: string;
}

interface RawNodeRun {
  version: "noderun-v0.1";
  node_id: string;
  entered_at: string;
  exited_at: string | null;
  transitions: unknown[];
  capability_decisions: RawNodeRunCapabilityDecision[];
}

export interface CapabilityMatrixView {
  nodes: string[];
  capabilities: CapabilityMatrixCapability[];
  cells: CapabilityMatrixCell[];
}

interface UseCapabilityStatusResult extends CapabilityMatrixView {
  loading: boolean;
  error: string | null;
  refresh: () => Promise<CapabilityMatrixView | null>;
}

const emptyMatrix: CapabilityMatrixView = {
  nodes: NODE_BOARD_COLUMNS.map((node) => node.key),
  capabilities: [],
  cells: []
};

export function useCapabilityStatus(taskId: string | null): UseCapabilityStatusResult {
  const [globalStatus, setGlobalStatus] = useState<RawCapabilityStatusItem[]>([]);
  const [nodeRuns, setNodeRuns] = useState<RawNodeRun[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const view = useMemo(() => buildCapabilityMatrixView(globalStatus, nodeRuns), [globalStatus, nodeRuns]);

  const refresh = useCallback(async () => {
    if (!taskId) {
      setGlobalStatus([]);
      setNodeRuns([]);
      return emptyMatrix;
    }

    setLoading(true);
    setError(null);
    try {
      const nextView = await fetchCapabilityMatrix(taskId);
      setGlobalStatus(nextView.globalStatus);
      setNodeRuns(nextView.nodeRuns);
      return nextView.view;
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "加载 Capability matrix 失败");
      return null;
    } finally {
      setLoading(false);
    }
  }, [taskId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return {
    ...view,
    loading,
    error,
    refresh
  };
}

export async function fetchCapabilityMatrix(taskId: string): Promise<{
  globalStatus: RawCapabilityStatusItem[];
  nodeRuns: RawNodeRun[];
  view: CapabilityMatrixView;
}> {
  const [statusPayload, nodeRuns] = await Promise.all([
    requestJson<RawCapabilityStatusResponse>("/api/capabilities/status", "加载 Capability status 失败"),
    requestJson<RawNodeRun[]>(`/api/noderuns/${encodeURIComponent(taskId)}`, "加载 NodeRun timeline 失败")
  ]);

  return {
    globalStatus: statusPayload.capabilities,
    nodeRuns,
    view: buildCapabilityMatrixView(statusPayload.capabilities, nodeRuns)
  };
}

export function buildCapabilityMatrixView(
  globalStatus: RawCapabilityStatusItem[],
  nodeRuns: RawNodeRun[]
): CapabilityMatrixView {
  const nodes = NODE_BOARD_COLUMNS.map((node) => node.key);
  const capabilityMap = new Map<string, CapabilityMatrixCapability>();
  const cells: CapabilityMatrixCell[] = [];
  const cellKeys = new Set<string>();

  globalStatus.forEach((capability) => {
    capabilityMap.set(capability.name, {
      id: capability.name,
      label: capability.name,
      criticality: `${capability.binding_source} · ${capability.status}`
    });
  });

  nodeRuns.forEach((run) => {
    run.capability_decisions.forEach((decision) => {
      capabilityMap.set(decision.capability_requested, {
        id: decision.capability_requested,
        label: decision.capability_requested,
        criticality: capabilityMap.get(decision.capability_requested)?.criticality
      });

      const key = `${run.node_id}:${decision.capability_requested}`;
      if (cellKeys.has(key)) {
        return;
      }
      cellKeys.add(key);

      cells.push({
        nodeId: run.node_id,
        capabilityId: decision.capability_requested,
        status: deriveDecisionStatus(decision),
        tooltip: buildDecisionTooltip(decision)
      });
    });
  });

  globalStatus
    .filter((capability) => capability.status === "disabled")
    .forEach((capability) => {
      nodes.forEach((nodeId) => {
        const key = `${nodeId}:${capability.name}`;
        if (cellKeys.has(key)) {
          return;
        }
        cellKeys.add(key);
        cells.push({
          nodeId,
          capabilityId: capability.name,
          status: "missing",
          tooltip: `${capability.name} disabled in ${capability.binding_source} capability status`
        });
      });
    });

  return {
    nodes,
    capabilities: [...capabilityMap.values()].sort((left, right) => left.id.localeCompare(right.id)),
    cells
  };
}

function deriveDecisionStatus(decision: RawNodeRunCapabilityDecision): MatrixCellStatus {
  if (!decision.resolved_binding) {
    return "missing";
  }

  const explicitStatus = [decision.outcome, decision.status, decision.result]
    .filter((value): value is string => typeof value === "string")
    .map((value) => value.toLowerCase());
  if (
    explicitStatus.includes("fallback") ||
    Number(decision.old_hint_fallback_count ?? 0) > 0 ||
    (Array.isArray(decision.fallback_chain) && decision.fallback_chain.length > 0)
  ) {
    return "fallback";
  }

  return "resolved";
}

function buildDecisionTooltip(decision: RawNodeRunCapabilityDecision): string {
  const status = deriveDecisionStatus(decision);
  if (status === "missing") {
    return `${decision.capability_requested} missing at ${decision.decision_at}`;
  }

  if (status === "fallback") {
    return `${decision.capability_requested} fallback to ${decision.resolved_binding} at ${decision.decision_at}`;
  }

  return `${decision.capability_requested} resolved by ${decision.resolved_binding} at ${decision.decision_at}`;
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
