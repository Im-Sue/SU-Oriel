import styles from "./StatusStrip.module.css";
import { useTaskCheckpoints } from "./hooks/useTaskCheckpoints.js";
import type { TaskDetailView } from "../../types/task.js";

interface StatusStripProps {
  task: TaskDetailView;
  onOpenProperties: () => void;
  onOpenReview: () => void;
  onOpenAdvanced: () => void;
  onOpenCheckpoints: () => void;
}

const PRIORITY_LABEL: Record<string, string> = {
  low: "低",
  medium: "中",
  high: "高",
  urgent: "紧急"
};

const PRIORITY_COLOR: Record<string, string> = {
  low: "gray",
  medium: "blue",
  high: "orange",
  urgent: "red"
};

const REVIEW_LABEL: Record<string, string> = {
  passed: "通过",
  needs_followup: "需跟进",
  design_conflict: "设计冲突",
  unknown: "未知"
};

const REVIEW_COLOR: Record<string, string> = {
  passed: "green",
  needs_followup: "yellow",
  design_conflict: "red",
  unknown: "gray"
};

export function StatusStrip({
  task,
  onOpenProperties,
  onOpenReview,
  onOpenAdvanced,
  onOpenCheckpoints
}: StatusStripProps) {
  const { checkpoints } = useTaskCheckpoints(task.id);
  const checkpointCount = Array.isArray(checkpoints) ? checkpoints.length : 0;
  const reviewStatus = task.reviewStatus ?? "unknown";

  return (
    <div aria-label="任务状态栏" className={styles.strip} role="region">
      <button aria-label="编辑优先级" className={styles.chip} onClick={onOpenProperties} type="button">
        <span className={styles.chipLabel}>优先级</span>
        <span className={styles.chipValue} data-color={PRIORITY_COLOR[task.priority] ?? "gray"}>
          {PRIORITY_LABEL[task.priority] ?? task.priority}
        </span>
      </button>

      <button aria-label="编辑进度" className={styles.chip} onClick={onOpenProperties} type="button">
        <span className={styles.chipLabel}>进度</span>
        <div className={styles.progressBar}>
          <div className={styles.progressFill} style={{ width: `${task.progress}%` }} />
          <span className={styles.progressText}>{task.progress}%</span>
        </div>
      </button>

      <button aria-label="查看评审" className={styles.chip} onClick={onOpenReview} type="button">
        <span className={styles.chipLabel}>评审</span>
        <span className={styles.chipValue} data-color={REVIEW_COLOR[reviewStatus] ?? "gray"}>
          {REVIEW_LABEL[reviewStatus] ?? reviewStatus}
        </span>
      </button>

      <button aria-label="查看检查点" className={styles.chip} onClick={onOpenCheckpoints} type="button">
        <span className={styles.chipLabel}>检查点</span>
        <span className={styles.chipValue} data-color="gray">
          {checkpointCount}
        </span>
      </button>

      <div className={styles.spacer} />

      <button aria-label="高级 / 调试" className={styles.advancedButton} onClick={onOpenAdvanced} type="button">
        ⚙ 高级
      </button>
    </div>
  );
}
