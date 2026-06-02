import styles from "./NodeStepper.module.css";
import type { NodeId, NodeStatus, TaskDetailNode } from "./types.js";

interface NodeStepperProps {
  nodes: TaskDetailNode[];
  selectedNodeId: NodeId;
  currentNodeId: NodeId;
  onSelect: (id: NodeId) => void;
}

const STATUS_LABEL: Record<NodeStatus, string> = {
  done: "已完成",
  in_progress: "进行中",
  blocked: "阻塞",
  pending: "等待",
  idle: "未开始",
  archive: "已归档"
};

function statusGlyph(status: NodeStatus, isCurrent: boolean): string {
  if (status === "done" || status === "archive") return "✓";
  if (status === "blocked") return "!";
  if (status === "in_progress") return isCurrent ? "▶" : "•";
  if (status === "pending") return "…";
  return "○";
}

export function NodeStepper({ nodes, selectedNodeId, currentNodeId, onSelect }: NodeStepperProps) {
  return (
    <nav aria-label="任务节点" className={styles.stepper}>
      <ol className={styles.list}>
        {nodes.map((node, index) => {
          const isSelected = node.id === selectedNodeId;
          const isCurrent = node.id === currentNodeId;
          const isLast = index === nodes.length - 1;
          return (
            <li className={styles.item} data-status={node.status} data-current={isCurrent} key={node.id}>
              <button
                aria-current={isCurrent ? "step" : undefined}
                aria-label={`${node.label} · ${STATUS_LABEL[node.status]}`}
                className={styles.button}
                data-selected={isSelected}
                onClick={() => onSelect(node.id)}
                type="button"
              >
                <span className={styles.dot}>{statusGlyph(node.status, isCurrent)}</span>
                <span className={styles.label}>{node.label}</span>
                {isCurrent ? <span className={styles.currentTag}>当前</span> : null}
              </button>
              {!isLast ? <span aria-hidden="true" className={styles.connector} data-passed={node.status === "done" || node.status === "archive"} /> : null}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
