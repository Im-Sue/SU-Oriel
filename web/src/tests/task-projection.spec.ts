import { describe, expect, it } from "vitest";

import {
  NODE_BOARD_COLUMNS,
  createTaskBoardProjection,
  deriveTaskBoardLane,
  getTaskAttentionSummary,
  isEpicContainerTask
} from "../lib/node-board-config.js";
import type { TaskView } from "../types/task.js";

function task(overrides: Partial<TaskView>): TaskView {
  return {
    id: overrides.id ?? "task-1",
    projectId: "project-1",
    taskKey: overrides.taskKey ?? "task-1",
    title: overrides.title ?? "任务",
    summary: null,
    status: overrides.status ?? "reviewing",
    phase: overrides.phase ?? "planning",
    currentNode: overrides.currentNode ?? null,
    nodeSubstate: overrides.nodeSubstate ?? null,
    runtimeState: overrides.runtimeState ?? null,
    lastTransitionId: null,
    semanticKind: overrides.semanticKind ?? null,
    priority: "medium",
    progress: 20,
    step: null,
    blockedReason: overrides.blockedReason ?? null,
    requirementId: null,
    reviewStatus: null,
    updatedAt: "2026-04-27T00:00:00.000Z"
  };
}

describe("任务节点看板投影派生", () => {
  it("用 currentNode + runtimeState 派生 board lane，archive 归入 done 列", () => {
    expect(
      deriveTaskBoardLane(
        task({
          status: "done",
          phase: "archive",
          currentNode: "archive",
          runtimeState: "completed"
        })
      )
    ).toBe("archive");
    expect(deriveTaskBoardLane(task({ currentNode: "implementation", phase: "archive" }))).toBe("implementation");
    expect(deriveTaskBoardLane(task({ runtimeState: "blocked", currentNode: "review" }))).toBe("review");
  });

  it("计数、过滤和列分桶共用同一 board projection", () => {
    const projection = createTaskBoardProjection(
      [
        task({ id: "active", currentNode: "implementation" }),
        task({ id: "archived", status: "done", currentNode: "archive", runtimeState: "completed" })
      ],
      { includeArchived: false }
    );

    expect(projection.totalTaskCount).toBe(2);
    expect(projection.visibleTasks).toHaveLength(1);
    expect(projection.hiddenArchivedCount).toBe(1);
    expect(projection.columns.find((column) => column.key === "archive")?.tasks).toHaveLength(0);

    const withArchive = createTaskBoardProjection(
      [
        task({ id: "active", currentNode: "implementation" }),
        task({ id: "archived", status: "done", currentNode: "archive", runtimeState: "completed" })
      ],
      { includeArchived: true }
    );
    expect(withArchive.columns.find((column) => column.key === "archive")?.tasks.map((item) => item.id)).toContain("archived");
  });

  it("NODE_BOARD_COLUMNS 固定为 SP-B20 四个子任务执行列", () => {
    expect(NODE_BOARD_COLUMNS.map((column) => column.key)).toEqual([
      "dispatch",
      "implementation",
      "review",
      "archive"
    ]);
  });

  it("planning nodes no longer appear on task board and map to dispatch queue", () => {
    expect(deriveTaskBoardLane(task({ currentNode: "requirement_analysis" }))).toBe("dispatch");
    expect(deriveTaskBoardLane(task({ currentNode: "technical_design" }))).toBe("dispatch");
    expect(deriveTaskBoardLane(task({ currentNode: "task_breakdown" }))).toBe("dispatch");
  });

  it("Task board treats all tasks as child subtasks and no longer exposes Epic containers", () => {
    expect(isEpicContainerTask(task({ kind: "subtask" }))).toBe(false);
    expect(isEpicContainerTask(task({ semanticKind: "planning_container" }))).toBe(false);
    expect(isEpicContainerTask(task({ semanticKind: "bug_fix" }))).toBe(false);
  });

  it("Sidebar 关注数只统计阻塞或异常任务", () => {
    const summary = getTaskAttentionSummary([
      task({ id: "running", runtimeState: "running" }),
      task({ id: "blocked-runtime", runtimeState: "blocked" }),
      task({ id: "blocked-reason", blockedReason: "waiting on runtime" })
    ]);

    expect(summary.total).toBe(3);
    expect(summary.attention).toBe(2);
  });
});
