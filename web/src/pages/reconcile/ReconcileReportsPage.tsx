import { useEffect, useMemo, useState } from "react";

import { MarkdownViewer } from "../../components/shared/MarkdownViewer.js";
import { Button } from "../../components/ui/Button.js";
import { EmptyState } from "../../components/ui/EmptyState.js";
import {
  dispatchRequirementAnchorCommand,
  dispatchTaskAnchorCommand
} from "../../lib/console-api.js";
import { useDetailStore } from "../../stores/detail-store.js";
import { useProjectStore } from "../../stores/project-store.js";
import { useUIStore } from "../../stores/ui-store.js";
import styles from "./ReconcileReportsPage.module.css";

interface ReconcileAction {
  id: string;
  title: string;
  repair_level: "auto" | "approve" | "forbid";
  suggested_action: { type: string; reason?: string };
}

function parseActions(content: string): ReconcileAction[] {
  const start = content.indexOf("<!-- ccb-reconcile-actions-json");
  if (start === -1) return [];
  const jsonStart = content.indexOf("\n", start);
  const end = content.indexOf("-->", jsonStart);
  if (jsonStart === -1 || end === -1) return [];
  try {
    return JSON.parse(content.slice(jsonStart + 1, end).trim()) as ReconcileAction[];
  } catch {
    return [];
  }
}

export function ReconcileReportsPage() {
  const selectedProjectId = useProjectStore((state) => state.selectedProjectId);
  const documents = useProjectStore((state) => state.documents);
  const requirements = useProjectStore((state) => state.requirements);
  const tasks = useProjectStore((state) => state.tasks);
  const documentDetail = useDetailStore((state) => state.documentDetail);
  const loadDocumentDetail = useDetailStore((state) => state.loadDocumentDetail);
  const addToast = useUIStore((state) => state.addToast);
  const [selectedDocumentId, setSelectedDocumentId] = useState<string | null>(null);
  const [selectedActionIds, setSelectedActionIds] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);

  const reports = useMemo(
    () =>
      documents
        .filter((document) => document.path.includes("docs/.ccb/reconcile/") && document.path.endsWith(".md"))
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)),
    [documents]
  );
  const selectedReport = reports.find((report) => report.id === selectedDocumentId) ?? reports[0] ?? null;

  useEffect(() => {
    if (!selectedReport) return;
    setSelectedDocumentId(selectedReport.id);
    void loadDocumentDetail(selectedReport.id);
  }, [loadDocumentDetail, selectedReport]);

  const actions = useMemo(() => parseActions(documentDetail?.content ?? ""), [documentDetail?.content]);
  const approvable = actions.filter((action) => action.repair_level === "approve");

  const dispatchApply = async () => {
    if (!selectedProjectId || !documentDetail) return;
    const payload = {
      mode: "apply",
      scope: "project",
      report_path: documentDetail.path,
      approved_actions: selectedActionIds
    };
    setSubmitting(true);
    try {
      const requirement = requirements[0];
      if (requirement) {
        const result = await dispatchRequirementAnchorCommand(selectedProjectId, requirement.id, {
          command: "su-reconcile",
          payload
        });
        addToast("success", `已排队 /ccb:su-reconcile apply：${result.jobId}`);
        return;
      }
      const task = tasks[0];
      if (task) {
        const result = await dispatchTaskAnchorCommand(task.id, {
          command: "su-reconcile",
          payload
        });
        addToast("success", `已排队 /ccb:su-reconcile apply：${result.jobId}`);
        return;
      }
      addToast("error", "没有可用 requirement/task anchor 承载 reconcile apply");
    } catch (error) {
      addToast("error", error instanceof Error ? error.message : "提交 Reconcile 修复失败");
    } finally {
      setSubmitting(false);
    }
  };

  if (!selectedProjectId) {
    return <EmptyState description="先选择项目，再查看 Reconcile 报告。" icon="↻" title="未选择项目" />;
  }

  if (reports.length === 0) {
    return <EmptyState description="触发 /ccb:su-reconcile detect 后，报告会显示在这里。" icon="↻" title="暂无 Reconcile 报告" />;
  }

  return (
    <div className={styles.layout}>
      <section className={styles.listPane}>
        <div className={styles.reportList}>
          {reports.map((report) => (
            <button
              className={styles.reportButton}
              data-active={String(report.id === selectedReport?.id)}
              key={report.id}
              onClick={() => {
                setSelectedDocumentId(report.id);
                setSelectedActionIds([]);
                void loadDocumentDetail(report.id);
              }}
              type="button"
            >
              <span className={styles.reportTitle}>{report.title}</span>
              <span className={styles.reportPath}>{report.path}</span>
            </button>
          ))}
        </div>
      </section>

      <section className={styles.detailPane}>
        <div className={styles.toolbar}>
          <div>{approvable.length} 个待审批 action</div>
          <Button disabled={submitting || selectedActionIds.length === 0} onClick={() => void dispatchApply()}>
            提交修复
          </Button>
        </div>
        {approvable.length > 0 ? (
          <div className={styles.actions}>
            {approvable.map((action) => (
              <label className={styles.actionRow} key={action.id}>
                <input
                  checked={selectedActionIds.includes(action.id)}
                  onChange={(event) =>
                    setSelectedActionIds((items) =>
                      event.target.checked ? [...items, action.id] : items.filter((id) => id !== action.id)
                    )
                  }
                  type="checkbox"
                />
                <span>
                  <span className={styles.actionId}>{action.id}</span> · {action.suggested_action.type} · {action.title}
                </span>
              </label>
            ))}
          </div>
        ) : null}
        <div className={styles.reader}>
          <MarkdownViewer content={documentDetail?.content ?? ""} />
        </div>
      </section>
    </div>
  );
}
