import type { Prisma, Task } from "@prisma/client";

import type { RollupClient } from "../requirement/requirement-status-rollup.js";

export interface EpicRollupResult {
  attempted: boolean;
  updated: boolean;
  epicId: string | null;
  oldStatus: string | null;
  newStatus: string | null;
  reason?: "no_parent_epic" | "no_change" | "missing_aggregation";
}

export interface ReconcileEpicStatusResult {
  totalEpics: number;
  updatedCount: number;
  errors: Array<{ epicId: string; message: string }>;
  results: EpicRollupResult[];
}

export async function cancelEpicStatusById(_client: RollupClient, _epicId: string): Promise<Task> {
  throw new Error("Epic 已取消，不能再执行 epic status rollup");
}

export async function revertEpicStatusToPlanning(_client: RollupClient, _epicId: string): Promise<Task> {
  throw new Error("Epic 已取消，不能再执行 epic status rollup");
}

export async function rollupEpicStatusFromSubtask(
  _client: RollupClient,
  _subtaskId: string
): Promise<EpicRollupResult> {
  return {
    attempted: false,
    updated: false,
    epicId: null,
    oldStatus: null,
    newStatus: null,
    reason: "no_parent_epic"
  };
}

export async function rollupEpicStatusById(_client: RollupClient, epicId: string): Promise<EpicRollupResult> {
  return {
    attempted: true,
    updated: false,
    epicId,
    oldStatus: null,
    newStatus: null,
    reason: "missing_aggregation"
  };
}

export async function reconcileEpicStatusForProject(
  _client: RollupClient,
  _projectId: string
): Promise<ReconcileEpicStatusResult> {
  return {
    totalEpics: 0,
    updatedCount: 0,
    errors: [],
    results: []
  };
}

export type EpicRollupTransactionClient = Prisma.TransactionClient;
