import type { ReactNode } from "react";

import styles from "./ActiveNodePanel.module.css";
import type { NodeDetail, NodeStatus } from "./types.js";

interface ActiveNodePanelProps {
  node: NodeDetail;
  isCurrent: boolean;
  actionsSlot?: ReactNode;
  consultationSlot?: ReactNode;
  activitySlot?: ReactNode;
  emptyHint?: ReactNode;
}

const STATUS_LABEL: Record<NodeStatus, string> = {
  done: "已完成",
  in_progress: "进行中",
  blocked: "阻塞",
  pending: "等待",
  idle: "未开始",
  archive: "已归档"
};

const STATUS_COLOR: Record<NodeStatus, string> = {
  done: "green",
  in_progress: "blue",
  blocked: "red",
  pending: "yellow",
  idle: "gray",
  archive: "gray"
};

export function ActiveNodePanel({
  node,
  isCurrent,
  actionsSlot,
  consultationSlot,
  activitySlot,
  emptyHint
}: ActiveNodePanelProps) {
  return (
    <article aria-label={`${node.label} 详情`} className={styles.panel} role="region">
      <header className={styles.header}>
        <div className={styles.titleBlock}>
          <h2 className={styles.title}>{node.label}</h2>
          <span className={styles.statusPill} data-color={STATUS_COLOR[node.status]}>
            {STATUS_LABEL[node.status]}
          </span>
          {isCurrent ? <span className={styles.currentBadge}>当前节点</span> : <span className={styles.viewingBadge}>查看节点</span>}
        </div>
        {node.substate ? (
          <div className={styles.substate}>
            <span className={styles.substateLabel}>子状态</span>
            <code className={styles.substateValue}>{node.substate}</code>
          </div>
        ) : null}
      </header>

      {actionsSlot ? (
        <section aria-label="可执行动作" className={styles.section}>
          <div className={styles.sectionLabel}>可执行动作</div>
          {actionsSlot}
        </section>
      ) : null}

      {consultationSlot ? (
        <section aria-label="协商对话" className={styles.section}>
          <div className={styles.sectionLabel}>协商对话</div>
          {consultationSlot}
        </section>
      ) : null}

      {activitySlot ? (
        <section aria-label="节点活动" className={styles.section}>
          <div className={styles.sectionLabel}>节点活动</div>
          {activitySlot}
        </section>
      ) : null}

      {!actionsSlot && !consultationSlot && !activitySlot && emptyHint ? (
        <div className={styles.empty}>{emptyHint}</div>
      ) : null}
    </article>
  );
}
