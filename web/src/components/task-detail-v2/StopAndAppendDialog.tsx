import { useState } from "react";

import styles from "./StopAndAppendDialog.module.css";
import { Button } from "../ui/Button.js";
import { Modal } from "../ui/Modal.js";
import type { UserIntentType } from "../../lib/user-intent-api.js";

interface StopAndAppendDialogProps {
  open: boolean;
  submitting?: boolean;
  onClose: () => void;
  onConfirm: (payload: { intentType: UserIntentType; body: string }) => void;
}

const INTENT_OPTIONS: Array<{
  value: UserIntentType;
  label: string;
  description: string;
}> = [
  {
    value: "append_instruction",
    label: "追加说明",
    description:
      "AI 继续当前方向，但加入一条新指令 / 约束 / 信息（例如「数据库迁移要可回滚」）。"
  },
  {
    value: "change_direction",
    label: "修改方向",
    description: "AI 当前路径不对，要换思路（例如「方案 A 不行，改用方案 B」）。"
  },
  {
    value: "pause",
    label: "暂停",
    description: "停下来，等用户后续提供更多信息再恢复。"
  }
];

export function StopAndAppendDialog(props: StopAndAppendDialogProps) {
  const [intentType, setIntentType] = useState<UserIntentType>("append_instruction");
  const [body, setBody] = useState("");

  const canSubmit = body.trim().length > 0 && !props.submitting;

  const handleConfirm = () => {
    if (!canSubmit) return;
    props.onConfirm({ intentType, body: body.trim() });
  };

  const handleClose = () => {
    if (props.submitting) return;
    props.onClose();
    setBody("");
    setIntentType("append_instruction");
  };

  return (
    <Modal
      footer={
        <>
          <Button onClick={handleClose} variant="ghost">
            取消
          </Button>
          <Button
            disabled={!canSubmit}
            loading={props.submitting}
            onClick={handleConfirm}
            variant="danger"
          >
            停止并追加
          </Button>
        </>
      }
      onClose={handleClose}
      open={props.open}
      title="停止当前 slot 并追加说明"
    >
      <div className={styles.intro}>
        当前 slot 内的任务会被
        <strong>取消（ccbd.cancel）</strong>，sticky 绑定保留。
        你的说明会写入 <code>user_intent</code> 表，点击「恢复」时 AI 将在同一 slot 读取并接续。
      </div>

      <div className={styles.optionList} role="radiogroup" aria-label="介入方式">
        {INTENT_OPTIONS.map((opt) => (
          <label
            className={styles.optionRow}
            data-selected={intentType === opt.value}
            key={opt.value}
          >
            <input
              checked={intentType === opt.value}
              className={styles.radio}
              name="intent-type"
              onChange={() => setIntentType(opt.value)}
              type="radio"
              value={opt.value}
            />
            <div>
              <div className={styles.optionTitle}>{opt.label}</div>
              <div className={styles.optionDesc}>{opt.description}</div>
            </div>
          </label>
        ))}
      </div>

      <div className={styles.bodyBlock}>
        <label className={styles.bodyLabel} htmlFor="user-intent-body">
          详细内容 <span className={styles.required}>*</span>
        </label>
        <textarea
          className={styles.bodyText}
          id="user-intent-body"
          maxLength={5000}
          onChange={(e) => setBody(e.target.value)}
          placeholder="例如：先停下来，方案 A 实施前我想确认一下迁移可回滚的策略..."
          rows={6}
          value={body}
        />
        <div className={styles.bodyCounter}>{body.length} / 5000</div>
      </div>
    </Modal>
  );
}
