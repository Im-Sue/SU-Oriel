import { DetailDrawer } from "./DetailDrawer.js";
import styles from "./ReviewDrawer.module.css";
import type { ReviewIntentView, TaskDetailView } from "../../types/task.js";

interface ReviewDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  task: TaskDetailView;
  isExecutable: boolean;
  reviewComment: string;
  busy: boolean;
  onCommentChange: (value: string) => void;
  onCreateIntent: (intentType: ReviewIntentView["intentType"]) => void;
  onCancelIntent: (intentId: string) => void;
}

const REVIEW_INTENT_ACTIONS: Array<{ intentType: ReviewIntentView["intentType"]; label: string; primary?: boolean }> = [
  { intentType: "mark_review_pass", label: "标记评审通过", primary: true },
  { intentType: "request_replan", label: "申请重新规划" },
  { intentType: "request_escalate", label: "申请升级" }
];

const REVIEW_STATUS_LABEL: Record<string, string> = {
  passed: "通过",
  needs_followup: "需跟进",
  design_conflict: "设计冲突",
  unknown: "未知"
};

const REVIEW_STATUS_COLOR: Record<string, string> = {
  passed: "green",
  needs_followup: "yellow",
  design_conflict: "red",
  unknown: "gray"
};

const INTENT_TYPE_LABEL: Record<string, string> = {
  mark_review_pass: "标记评审通过",
  request_replan: "申请重新规划",
  request_escalate: "申请升级"
};

const INTENT_STATUS_LABEL: Record<string, string> = {
  pending: "待处理",
  consumed: "已处理",
  cancelled: "已取消"
};

const INTENT_STATUS_COLOR: Record<string, string> = {
  pending: "yellow",
  consumed: "green",
  cancelled: "gray"
};

function formatVerification(value: unknown): Array<{ label: string; value: string }> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  return Object.entries(value as Record<string, unknown>).map(([label, v]) => ({ label, value: String(v) }));
}

export function ReviewDrawer({
  isOpen,
  onClose,
  task,
  isExecutable,
  reviewComment,
  busy,
  onCommentChange,
  onCreateIntent,
  onCancelIntent
}: ReviewDrawerProps) {
  const verificationItems = formatVerification(task.verificationResult);
  const reviewStatus = task.reviewStatus ?? "unknown";

  return (
    <DetailDrawer isOpen={isOpen} onClose={onClose} title="评审详情">
      <div className={styles.section}>
        <div className={styles.sectionLabel}>{`评审状态：${REVIEW_STATUS_LABEL[reviewStatus] ?? reviewStatus}`}</div>
        <span className={styles.statusPill} data-color={REVIEW_STATUS_COLOR[reviewStatus] ?? "gray"}>
          {REVIEW_STATUS_LABEL[reviewStatus] ?? reviewStatus}
        </span>
      </div>

      {verificationItems.length > 0 ? (
        <div className={styles.section}>
          <div className={styles.sectionLabel}>验证结果</div>
          <div className={styles.verifications}>
            {verificationItems.map((item) => (
              <div className={styles.verifyRow} key={item.label}>
                <span>{`${item.label}: ${item.value}`}</span>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {task.reviewFollowup.length > 0 ? (
        <div className={styles.section}>
          <div className={styles.sectionLabel}>跟进事项</div>
          <ul className={styles.followupList}>
            {task.reviewFollowup.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {isExecutable ? (
        <div className={styles.section}>
          <div className={styles.sectionLabel}>提交评审决策</div>
          <textarea
            aria-label="评审备注"
            className={styles.textarea}
            disabled={busy}
            onChange={(event) => onCommentChange(event.target.value)}
            placeholder="评审备注（可选）"
            rows={3}
            value={reviewComment}
          />
          <div className={styles.actions}>
            {REVIEW_INTENT_ACTIONS.map((action) => (
              <button
                className={action.primary ? styles.primaryAction : styles.secondaryAction}
                disabled={busy}
                key={action.intentType}
                onClick={() => onCreateIntent(action.intentType)}
                type="button"
              >
                {action.label}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <p className={styles.placeholder}>史诗任务（容器）仅展示评审结果</p>
      )}

      {task.reviewIntents.length > 0 ? (
        <div className={styles.section}>
          <div className={styles.sectionLabel}>历史评审意图</div>
          <ul className={styles.intentList}>
            {task.reviewIntents.map((intent) => (
              <li className={styles.intentItem} key={intent.id}>
                <span className={styles.intentType}>{INTENT_TYPE_LABEL[intent.intentType] ?? intent.intentType}</span>
                <span className={styles.intentStatus} data-color={INTENT_STATUS_COLOR[intent.status] ?? "gray"}>
                  {INTENT_STATUS_LABEL[intent.status] ?? intent.status}
                </span>
                {isExecutable && intent.status === "pending" ? (
                  <button
                    className={styles.cancelButton}
                    disabled={busy}
                    onClick={() => onCancelIntent(intent.id)}
                    type="button"
                  >
                    取消
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </DetailDrawer>
  );
}
