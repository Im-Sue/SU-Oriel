import { useMemo, useState } from "react";

import styles from "./HealthPanel.module.css";
import {
  dispatchRequirementAnchorCommand,
  dispatchTaskAnchorCommand
} from "../../lib/console-api.js";
import { useProjectStore } from "../../stores/project-store.js";
import { useUIStore } from "../../stores/ui-store.js";

interface HealthPanelProps {
  projectId: string;
  onTaskSelect: (taskId: string) => void;
}

export function HealthPanel({ projectId, onTaskSelect }: HealthPanelProps) {
  void onTaskSelect;
  const [expanded, setExpanded] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const documents = useProjectStore((state) => state.documents);
  const requirements = useProjectStore((state) => state.requirements);
  const tasks = useProjectStore((state) => state.tasks);
  const addToast = useUIStore((state) => state.addToast);

  const reports = useMemo(
    () =>
      documents
        .filter((document) => document.path.includes("docs/.ccb/reconcile/") && document.path.endsWith(".md"))
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)),
    [documents]
  );
  const latestReport = reports[0] ?? null;

  const dispatchDetect = async () => {
    if (!projectId) return;
    const payload = {
      mode: "detect",
      scope: "project",
      source: "health-panel"
    };
    setSubmitting(true);
    try {
      const requirement = requirements.find((item) => item.projectId === projectId) ?? requirements[0];
      if (requirement) {
        const result = await dispatchRequirementAnchorCommand(projectId, requirement.id, {
          command: "su-reconcile",
          payload
        });
        addToast("success", `已排队 /ccb:su-reconcile：${result.jobId}`);
        return;
      }
      const task = tasks.find((item) => item.projectId === projectId) ?? tasks[0];
      if (task) {
        const result = await dispatchTaskAnchorCommand(task.id, {
          command: "su-reconcile",
          payload
        });
        addToast("success", `已排队 /ccb:su-reconcile：${result.jobId}`);
        return;
      }
      addToast("error", "没有可用 requirement/task anchor 承载 reconcile detect");
    } catch (error) {
      addToast("error", error instanceof Error ? error.message : "发送 Reconcile 指令失败");
    } finally {
      setSubmitting(false);
    }
  };

  if (!latestReport) return null;

  return (
    <section aria-label="Reconcile 报告" className={styles.panel}>
      <button
        aria-expanded={expanded}
        className={styles.header}
        onClick={() => setExpanded((value) => !value)}
        type="button"
      >
        <span className={styles.expandIcon}>{expanded ? "▾" : "▸"}</span>
        <h3 className={styles.title}>
          Reconcile 报告
          <span className={styles.hint}>（状态漂移由 /ccb:su-reconcile 自检报告承载）</span>
        </h3>
        <span className={styles.count}>{reports.length} 份报告</span>
      </button>
      {expanded ? (
        <>
          <div className={styles.batchBar}>
            <span className={styles.batchHint}>最新报告：{latestReport.title}</span>
            <button
              className={styles.batchButton}
              disabled={submitting}
              onClick={() => void dispatchDetect()}
              type="button"
            >
              {submitting ? "排队中..." : "生成 Reconcile 报告"}
            </button>
          </div>
          <ul className={styles.list}>
            {reports.map((report) => (
              <li className={styles.item} key={report.id}>
                <span className={styles.categoryBadge} data-color="amber">
                  report
                </span>
                <span className={styles.taskTitle}>{report.title}</span>
                <span className={styles.currentState}>{report.updatedAt}</span>
                <span className={styles.currentState}>{report.path}</span>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </section>
  );
}
