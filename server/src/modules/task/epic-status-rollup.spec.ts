import assert from "node:assert/strict";

import { test } from "vitest";

import {
  cancelEpicStatusById,
  reconcileEpicStatusForProject,
  revertEpicStatusToPlanning,
  rollupEpicStatusById,
  rollupEpicStatusFromSubtask
} from "./epic-status-rollup.js";

test("epic status rollup is retired after ADR-0028", async () => {
  await assert.rejects(() => cancelEpicStatusById({} as never, "epic-1"), /Epic 已取消/);
  await assert.rejects(() => revertEpicStatusToPlanning({} as never, "epic-1"), /Epic 已取消/);

  assert.deepEqual(await rollupEpicStatusFromSubtask({} as never, "subtask-1"), {
    attempted: false,
    updated: false,
    epicId: null,
    oldStatus: null,
    newStatus: null,
    reason: "no_parent_epic"
  });
  assert.deepEqual(await rollupEpicStatusById({} as never, "epic-1"), {
    attempted: true,
    updated: false,
    epicId: "epic-1",
    oldStatus: null,
    newStatus: null,
    reason: "missing_aggregation"
  });
  assert.deepEqual(await reconcileEpicStatusForProject({} as never, "project-1"), {
    totalEpics: 0,
    updatedCount: 0,
    errors: [],
    results: []
  });
});
