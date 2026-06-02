/**
 * Phase A1: Tasks List 视图 (dense table，Linear/Height 风格)
 *
 * 列：title / kind / requirement / currentNode / priority / progress / updatedAt
 * 支持点击行跳转 detail，sort by 列。
 */

import { useMemo, useState } from "react";

import styles from "./TasksListView.module.css";
import { Badge } from "../../components/ui/Badge.js";
import { EmptyState } from "../../components/ui/EmptyState.js";
import { getNodeBadge, getPriorityBadge } from "../../lib/ui-mapping.js";
import type { TaskView } from "../../types/task.js";

interface TasksListViewProps {
  tasks: TaskView[];
  onTaskSelect: (taskId: string) => void;
}

type SortKey = "updatedAt" | "title" | "priority" | "progress" | "currentNode";
type SortDir = "asc" | "desc";

const PRIORITY_RANK: Record<string, number> = { urgent: 4, high: 3, medium: 2, low: 1 };
const NODE_LABEL: Record<string, string> = {
  requirement_analysis: "需求分析",
  technical_design: "技术设计",
  task_breakdown: "任务拆分",
  dispatch: "派发",
  implementation: "实施",
  review: "评审",
  archive: "归档"
};

function relativeTime(iso: string): string {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "?";
  const diff = Math.max(0, Math.floor((Date.now() - t) / 1000));
  if (diff < 60) return "刚刚";
  if (diff < 3600) return `${Math.floor(diff / 60)}m 前`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h 前`;
  if (diff < 604800) return `${Math.floor(diff / 86400)}d 前`;
  return new Date(iso).toLocaleDateString();
}

export function TasksListView({ tasks, onTaskSelect }: TasksListViewProps) {
  const [sortKey, setSortKey] = useState<SortKey>("updatedAt");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const sorted = useMemo(() => {
    const sign = sortDir === "asc" ? 1 : -1;
    return [...tasks].sort((a, b) => {
      switch (sortKey) {
        case "title":
          return sign * a.title.localeCompare(b.title);
        case "priority":
          return sign * ((PRIORITY_RANK[a.priority] ?? 0) - (PRIORITY_RANK[b.priority] ?? 0));
        case "progress":
          return sign * (a.progress - b.progress);
        case "currentNode":
          return sign * (a.currentNode ?? "").localeCompare(b.currentNode ?? "");
        case "updatedAt":
        default:
          return sign * (new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime());
      }
    });
  }, [tasks, sortKey, sortDir]);

  const handleHeaderClick = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortKey(key);
      setSortDir(key === "updatedAt" || key === "progress" || key === "priority" ? "desc" : "asc");
    }
  };

  if (tasks.length === 0) {
    return <EmptyState description="当前筛选条件下没有任务。" icon="☰" title="没有任务" />;
  }

  const sortIndicator = (key: SortKey) => (sortKey === key ? (sortDir === "asc" ? " ▲" : " ▼") : "");

  return (
    <table aria-label="任务列表" className={styles.table}>
      <thead>
        <tr>
          <th className={styles.headTitle} onClick={() => handleHeaderClick("title")}>
            标题{sortIndicator("title")}
          </th>
          <th className={styles.headKind}>类型</th>
          <th className={styles.headParent}>所属需求</th>
          <th className={styles.headNode} onClick={() => handleHeaderClick("currentNode")}>
            当前节点{sortIndicator("currentNode")}
          </th>
          <th className={styles.headPriority} onClick={() => handleHeaderClick("priority")}>
            优先级{sortIndicator("priority")}
          </th>
          <th className={styles.headProgress} onClick={() => handleHeaderClick("progress")}>
            进度{sortIndicator("progress")}
          </th>
          <th className={styles.headUpdated} onClick={() => handleHeaderClick("updatedAt")}>
            更新时间{sortIndicator("updatedAt")}
          </th>
        </tr>
      </thead>
      <tbody>
        {sorted.map((task) => {
          const nodeBadge = getNodeBadge(task.currentNode, task.nodeSubstate);
          const priorityBadge = getPriorityBadge(task.priority);
          return (
            <tr
              aria-label={`打开任务 ${task.title}`}
              className={styles.row}
              data-kind="subtask"
              key={task.id}
              onClick={() => onTaskSelect(task.id)}
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onTaskSelect(task.id);
                }
              }}
            >
              <td className={styles.cellTitle}>
                <span className={styles.title}>{task.title}</span>
                <span className={styles.taskKey}>{task.taskKey}</span>
              </td>
              <td className={styles.cellKind}>
                <Badge color="gray" label="子任务" />
              </td>
              <td className={styles.cellParent}>
                {task.requirementId ? <span className={styles.parentEpic}>需求 {task.requirementId.slice(-8)}</span> : <span className={styles.dim}>—</span>}
              </td>
              <td className={styles.cellNode}>
                {nodeBadge ? (
                  <Badge color={nodeBadge.color} label={NODE_LABEL[task.currentNode ?? ""] ?? nodeBadge.label} />
                ) : (
                  <span className={styles.dim}>—</span>
                )}
              </td>
              <td className={styles.cellPriority}>
                <span className={styles.priorityDot} data-priority={task.priority} />
                <span>{priorityBadge.label}</span>
              </td>
              <td className={styles.cellProgress}>
                <div className={styles.progressTrack}>
                  <div className={styles.progressBar} style={{ width: `${task.progress}%` }} />
                </div>
                <span className={styles.progressText}>{task.progress}%</span>
              </td>
              <td className={styles.cellUpdated}>{relativeTime(task.updatedAt)}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
