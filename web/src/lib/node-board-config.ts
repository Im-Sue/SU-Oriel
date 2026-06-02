import type { TaskView } from "../types/task.js";

export const NODE_BOARD_COLUMNS = [
  {
    key: "dispatch",
    label: "待派工",
    gate: null,
    guide: {
      title: "下一步：派工给 Codex 执行",
      description: "从需求拆分出的子任务等待派工。",
      command: "/ccb:su-dispatch"
    }
  },
  {
    key: "implementation",
    label: "执行中",
    gate: null,
    guide: {
      title: "下一步：等待执行回执",
      description: "子任务正在实现，完成后进入评审。",
      command: null
    }
  },
  {
    key: "review",
    label: "待评审",
    gate: { marker: "R", title: "出口门：最终验收" },
    guide: {
      title: "下一步：审查并验收",
      description: "查看回执后执行 /ccb:su-review。",
      command: "/ccb:su-review"
    }
  },
  {
    key: "archive",
    label: "已完成",
    gate: null,
    guide: {
      title: "任务已完成",
      description: "需要收尾时执行 /ccb:su-archive。",
      command: "/ccb:su-archive"
    }
  }
] as const;

export type NodeBoardColumnKey = (typeof NODE_BOARD_COLUMNS)[number]["key"];

export type TaskBoardItem = TaskView & {
  boardLane: NodeBoardColumnKey;
};

export interface TaskBoardProjection {
  totalTaskCount: number;
  visibleTaskCount: number;
  activeTaskCount: number;
  archivedCount: number;
  hiddenArchivedCount: number;
  visibleTasks: TaskBoardItem[];
  columns: Array<(typeof NODE_BOARD_COLUMNS)[number] & { tasks: TaskBoardItem[] }>;
  nodeSummary: Array<(typeof NODE_BOARD_COLUMNS)[number] & { count: number }>;
}

const NODE_LABEL_MAP: Record<NodeBoardColumnKey, string> = Object.fromEntries(
  NODE_BOARD_COLUMNS.map((column) => [column.key, column.label])
) as Record<NodeBoardColumnKey, string>;

export function isCanonicalNodeId(value: string | null | undefined): value is NodeBoardColumnKey {
  return Boolean(value && value in NODE_LABEL_MAP);
}

export function getNodeLabel(currentNode: string): string {
  return isCanonicalNodeId(currentNode) ? NODE_LABEL_MAP[currentNode] : currentNode;
}

export function deriveTaskBoardLane(
  task: Pick<TaskView, "status" | "currentNode" | "runtimeState" | "reviewStatus">
): NodeBoardColumnKey {
  const status = task.status?.trim().toLowerCase();
  const currentNode = task.currentNode?.trim().toLowerCase();
  const runtimeState = task.runtimeState?.trim().toLowerCase();
  const reviewStatus = task.reviewStatus?.trim().toLowerCase();

  if (
    status === "done" ||
    status === "cancelled" ||
    status === "archived" ||
    status === "completed" ||
    runtimeState === "completed"
  ) {
    return "archive";
  }
  if (reviewStatus === "pending" || reviewStatus === "needs_followup") {
    return "review";
  }
  if (currentNode === "archive") {
    return "archive";
  }
  if (currentNode === "review") {
    return "review";
  }
  if (currentNode === "implementation") {
    return "implementation";
  }
  return "dispatch";
}

export function isTaskArchived(task: Pick<TaskView, "status" | "currentNode" | "runtimeState" | "reviewStatus">): boolean {
  return deriveTaskBoardLane(task) === "archive";
}

export function isTaskAttentionNeeded(
  task: Pick<TaskView, "status" | "runtimeState" | "blockedReason" | "reviewStatus">
): boolean {
  const runtimeState = task.runtimeState?.trim().toLowerCase();
  const reviewStatus = task.reviewStatus?.trim().toLowerCase();

  return (
    runtimeState === "blocked" ||
    runtimeState === "failed" ||
    Boolean(task.blockedReason?.trim()) ||
    reviewStatus === "needs_followup" ||
    reviewStatus === "design_conflict"
  );
}

export function getTaskAttentionSummary(tasks: TaskView[]): { total: number; attention: number } {
  return {
    total: tasks.length,
    attention: tasks.filter((task) => isTaskAttentionNeeded(task)).length
  };
}

export function isEpicContainerTask(_task: Pick<TaskView, "semanticKind" | "kind">): boolean {
  return false;
}

export function isExecutableTask(task: Pick<TaskView, "semanticKind" | "kind" | "status" | "currentNode" | "runtimeState" | "reviewStatus">): boolean {
  return !isTaskArchived(task);
}

export function createTaskBoardProjection(
  tasks: TaskView[],
  options: { includeArchived?: boolean; includeEpics?: boolean } = {}
): TaskBoardProjection {
  const includeArchived = Boolean(options.includeArchived);
  const allTasks = tasks
    .map((task) => ({
      ...task,
      boardLane: deriveTaskBoardLane(task)
    }))
    .sort((left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime());
  const visibleTasks = includeArchived ? allTasks : allTasks.filter((task) => !isTaskArchived(task));
  const archivedCount = allTasks.filter((task) => isTaskArchived(task)).length;
  const columns = NODE_BOARD_COLUMNS.map((column) => ({
    ...column,
    tasks: visibleTasks.filter((task) => task.boardLane === column.key)
  }));

  return {
    totalTaskCount: allTasks.length,
    visibleTaskCount: visibleTasks.length,
    activeTaskCount: visibleTasks.filter((task) => task.boardLane === "implementation").length,
    archivedCount,
    hiddenArchivedCount: includeArchived ? 0 : archivedCount,
    visibleTasks,
    columns,
    nodeSummary: columns.map((column) => ({
      ...column,
      count: column.tasks.length
    }))
  };
}
