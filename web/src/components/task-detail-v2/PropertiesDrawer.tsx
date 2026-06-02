import { DetailDrawer } from "./DetailDrawer.js";
import styles from "./PropertiesDrawer.module.css";

interface PropertiesDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  priority: string;
  progress: number;
  blockedReason: string;
  saving: boolean;
  onPriorityChange: (value: string) => void;
  onProgressChange: (value: number) => void;
  onBlockedReasonChange: (value: string) => void;
}

const PRIORITY_OPTIONS = [
  { value: "low", label: "低" },
  { value: "medium", label: "中" },
  { value: "high", label: "高" },
  { value: "urgent", label: "紧急" }
];

export function PropertiesDrawer({
  isOpen,
  onClose,
  priority,
  progress,
  blockedReason,
  saving,
  onPriorityChange,
  onProgressChange,
  onBlockedReasonChange
}: PropertiesDrawerProps) {
  return (
    <DetailDrawer isOpen={isOpen} onClose={onClose} title="任务属性">
      <div className={styles.savingHint}>{saving ? "保存中..." : "修改会自动保存"}</div>

      <label className={styles.field}>
        <span className={styles.fieldLabel}>优先级</span>
        <select
          aria-label="优先级"
          className={styles.select}
          onChange={(event) => onPriorityChange(event.target.value)}
          value={priority}
        >
          {PRIORITY_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>

      <label className={styles.field}>
        <span className={styles.fieldLabel}>
          进度 <span className={styles.fieldValue}>{progress}%</span>
        </span>
        <input
          aria-label="进度"
          className={styles.range}
          max={100}
          min={0}
          onChange={(event) => onProgressChange(Number.parseInt(event.target.value, 10) || 0)}
          type="range"
          value={progress}
        />
      </label>

      <label className={styles.field}>
        <span className={styles.fieldLabel}>阻塞原因</span>
        <textarea
          aria-label="阻塞原因"
          className={styles.textarea}
          onChange={(event) => onBlockedReasonChange(event.target.value)}
          placeholder="没有阻塞可留空"
          rows={4}
          value={blockedReason}
        />
      </label>
    </DetailDrawer>
  );
}
