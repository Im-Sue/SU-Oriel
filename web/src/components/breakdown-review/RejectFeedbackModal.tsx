import { useState } from "react";

import styles from "./RejectFeedbackModal.module.css";
import { Button } from "../ui/Button.js";
import { Modal } from "../ui/Modal.js";

interface RejectFeedbackModalProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (reason: string) => Promise<void>;
}

const MIN_LEN = 10;
const MAX_LEN = 4000;
const PLACEHOLDER = `比如：
• PR2 范围太大，建议拆成 PR2a 编辑 form / PR2b banner 与 stale 提示
• 漏了 reanalyze 的 rate-limit 设计
• 实施 owner 调整：PR1 也给 claude 实施
• 决策 Q4d 应改为 EventJournal envelope 调整 taskId 可空，而不是新表`;

export function RejectFeedbackModal({ open, onClose, onSubmit }: RejectFeedbackModalProps) {
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const trimmed = reason.trim();
  const valid = trimmed.length >= MIN_LEN && trimmed.length <= MAX_LEN;

  const handleSubmit = async () => {
    if (!valid || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await onSubmit(trimmed);
      setReason("");
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "提交失败");
    } finally {
      setSubmitting(false);
    }
  };

  const handleClose = () => {
    if (submitting) return;
    setReason("");
    setError(null);
    onClose();
  };

  return (
    <Modal
      open={open}
      title="拒绝并送回 AI 重做"
      onClose={handleClose}
      footer={
        <div className={styles.footer}>
          <Button variant="ghost" onClick={handleClose} disabled={submitting}>
            取消
          </Button>
          <Button
            variant="danger"
            onClick={handleSubmit}
            disabled={!valid}
            loading={submitting}
          >
            送回 AI 重新拆分
          </Button>
        </div>
      }
    >
      <div className={styles.body}>
        <div className={styles.label}>
          你的反馈（会发到 anchor 里的 Claude，触发重新跑 task_breakdown）
        </div>
        <textarea
          className={styles.textarea}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder={PLACEHOLDER}
          rows={10}
          disabled={submitting}
          maxLength={MAX_LEN}
          autoFocus
        />
        <div className={styles.meta}>
          <span className={trimmed.length < MIN_LEN ? styles.counterLow : styles.counter}>
            {trimmed.length} / {MAX_LEN} · 至少 {MIN_LEN} 字符
          </span>
        </div>

        <div className={styles.hint}>
          <strong>📤 提交后会发生什么：</strong>
          <ul>
            <li>Console 会把反馈作为 anchor 指令排队，不再直接写草案状态</li>
            <li>你的反馈会随 <code>/ccb:su-revise-breakdown</code> 推送到 anchor 里 Claude 的对话</li>
            <li>Claude 重写时会把拒绝记录写进 <code>review_history</code></li>
            <li>Claude 收到后会重写 breakdown draft；你可以在 anchor 终端实时看到</li>
            <li>新草案写入后，本页会自动刷新</li>
          </ul>
        </div>

        {error ? (
          <div className={styles.error}>
            <strong>提交失败：</strong>
            <div>{error}</div>
            {/anchor/i.test(error) ? (
              <div className={styles.errorHint}>
                请先回到需求详情页触发规划 anchor，等 AI session 就绪后再回来重试。
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </Modal>
  );
}
