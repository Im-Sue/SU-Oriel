import { useState } from "react";

import styles from "./DeriveFollowupDialog.module.css";
import { Button } from "../ui/Button.js";
import { Modal } from "../ui/Modal.js";
import type { DeriveFollowupType } from "../../lib/console-api.js";

interface DeriveFollowupDialogProps {
  open: boolean;
  submitting?: boolean;
  sourceHasRequirement: boolean;
  onClose: () => void;
  onConfirm: (payload: { type: DeriveFollowupType; title: string; description: string }) => void;
}

const TYPE_OPTIONS: Array<{
  value: DeriveFollowupType;
  label: string;
  description: string;
}> = [
  {
    value: "subtask",
    label: "子任务（同 Epic 内）",
    description: "立刻进入主流程的小工作，挂同一个父 Epic / Requirement，currentNode=requirement_analysis"
  },
  {
    value: "requirement",
    label: "新需求草稿（待立项）",
    description: "暂存的衍生想法，status=draft，需要时再立项启动主流程"
  }
];

export function DeriveFollowupDialog(props: DeriveFollowupDialogProps) {
  const [type, setType] = useState<DeriveFollowupType>("requirement");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");

  const subtaskDisabled = !props.sourceHasRequirement;
  const effectiveType = subtaskDisabled && type === "subtask" ? "requirement" : type;
  const canSubmit = title.trim().length > 0 && !props.submitting;

  const handleConfirm = () => {
    if (!canSubmit) return;
    props.onConfirm({ type: effectiveType, title: title.trim(), description: description.trim() });
  };

  const handleClose = () => {
    if (props.submitting) return;
    props.onClose();
    setTitle("");
    setDescription("");
    setType("requirement");
  };

  return (
    <Modal
      footer={
        <>
          <Button disabled={props.submitting} onClick={handleClose} variant="ghost">
            取消
          </Button>
          <Button disabled={!canSubmit} onClick={handleConfirm}>
            {props.submitting ? "创建中..." : "创建 →"}
          </Button>
        </>
      }
      onClose={handleClose}
      open={props.open}
      title="衍生 followup"
    >
      <div className={styles.body}>
        <p className={styles.intro}>
          基于当前任务衍生工作。子任务进入主流程立即推进；新需求作为草稿暂存。
        </p>

        <fieldset className={styles.typeGroup}>
          <legend className={styles.legend}>类型</legend>
          {TYPE_OPTIONS.map((option) => {
            const disabled = option.value === "subtask" && subtaskDisabled;
            const selected = effectiveType === option.value;
            return (
              <label
                className={styles.typeOption}
                data-disabled={disabled}
                data-selected={selected}
                key={option.value}
              >
                <input
                  checked={selected}
                  disabled={disabled}
                  name="derive-type"
                  onChange={() => setType(option.value)}
                  type="radio"
                  value={option.value}
                />
                <div className={styles.optionMeta}>
                  <div className={styles.optionLabel}>{option.label}</div>
                  <div className={styles.optionDesc}>
                    {option.description}
                    {disabled ? <span className={styles.disabledNote}>（源任务无所属需求，不可创建子任务）</span> : null}
                  </div>
                </div>
              </label>
            );
          })}
        </fieldset>

        <label className={styles.field}>
          <span className={styles.fieldLabel}>标题 *</span>
          <input
            className={styles.input}
            disabled={props.submitting}
            maxLength={200}
            onChange={(event) => setTitle(event.target.value)}
            placeholder={
              effectiveType === "subtask"
                ? "如：补 typo 修复 / 加单测覆盖 ..."
                : "如：AI 总结需求标题 / 新交互方案 ..."
            }
            type="text"
            value={title}
          />
        </label>

        <label className={styles.field}>
          <span className={styles.fieldLabel}>描述（可选）</span>
          <textarea
            className={styles.textarea}
            disabled={props.submitting}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="补充上下文，可写明触发原因 / 期望产物 / 依赖关系"
            rows={4}
            value={description}
          />
        </label>
      </div>
    </Modal>
  );
}
