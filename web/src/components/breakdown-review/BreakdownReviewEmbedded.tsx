import { useCallback, useEffect, useRef, useState } from "react";

import { PlanOverviewPanel } from "./PlanOverviewPanel.js";
import { RejectFeedbackModal } from "./RejectFeedbackModal.js";
import { SubtaskDetailPanel } from "./SubtaskDetailPanel.js";
import { SubtaskListPanel } from "./SubtaskListPanel.js";
import styles from "./BreakdownReviewEmbedded.module.css";
import { Button } from "../ui/Button.js";
import {
  type BreakdownDraftResult,
  fetchBreakdownDraft,
  materializeRequirement,
  rejectAndFeedback
} from "../../lib/breakdown-draft-api.js";
import { fetchEventJournalEvents, startRequirementPlanningAnchor } from "../../lib/console-api.js";
import { useProjectStore } from "../../stores/project-store.js";
import { useUIStore } from "../../stores/ui-store.js";

interface BreakdownReviewEmbeddedProps {
  requirementId: string;
  onAfterMaterialize?: (requirementId: string) => void;
}

const POLL_INTERVAL_MS = 3000;

function formatRelative(iso: string): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return iso;
  const diffSec = Math.round((Date.now() - then) / 1000);
  if (diffSec < 5) return "刚刚";
  if (diffSec < 60) return `${diffSec} 秒前`;
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)} 分钟前`;
  if (diffSec < 86_400) return `${Math.floor(diffSec / 3600)} 小时前`;
  return new Date(iso).toLocaleString();
}

export function BreakdownReviewEmbedded({ requirementId, onAfterMaterialize }: BreakdownReviewEmbeddedProps) {
  const addToast = useUIStore((state) => state.addToast);
  const selectedProjectId = useProjectStore((state) => state.selectedProjectId);
  const loadProjectData = useProjectStore((state) => state.loadProjectData);

  const [result, setResult] = useState<BreakdownDraftResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [materializing, setMaterializing] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [awaitingRewrite, setAwaitingRewrite] = useState(false);
  const [pendingRejectJobId, setPendingRejectJobId] = useState<string | null>(null);
  const [pendingMaterializeJobId, setPendingMaterializeJobId] = useState<string | null>(null);

  const lastUpdatedAtRef = useRef<string | null>(null);

  const load = useCallback(
    async (silent = false) => {
      if (!silent) setLoading(true);
      try {
        const fresh = await fetchBreakdownDraft(requirementId);
        if (fresh) {
          if (
            awaitingRewrite &&
            lastUpdatedAtRef.current &&
            fresh.draft.updated_at !== lastUpdatedAtRef.current &&
            fresh.draft.review_history?.[fresh.draft.review_history.length - 1]?.action !== "rejected"
          ) {
            // AI 写入了新版本（不再是 reject 收尾）
            setAwaitingRewrite(false);
            addToast("success", "AI 已写入新版草案，请重新审查");
          }
          lastUpdatedAtRef.current = fresh.draft.updated_at;
          setResult(fresh);
          setError(null);
        } else {
          setResult(null);
          setError("草案尚未生成。请回到需求详情页触发生成拆分草案，等 AI 写入后再审查。");
        }
      } catch (e) {
        if (!silent) {
          setError(e instanceof Error ? e.message : "加载草案失败");
        }
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [requirementId, awaitingRewrite, addToast]
  );

  useEffect(() => {
    void load();
  }, [load]);

  // Poll while awaiting AI rewrite
  useEffect(() => {
    if (!awaitingRewrite) return;
    const handle = window.setInterval(() => {
      if (typeof document !== "undefined" && document.hidden) return;
      void load(true);
    }, POLL_INTERVAL_MS);
    return () => window.clearInterval(handle);
  }, [awaitingRewrite, load]);

  useEffect(() => {
    if (!pendingRejectJobId) return;
    const checkDispatch = async () => {
      try {
        const events = await fetchEventJournalEvents({
          subjectType: "requirement",
          subjectId: requirementId,
          limit: 20
        });
        const matched = events.items.find((event) => {
          if (event.eventType !== "anchor_dispatch_submitted" && event.eventType !== "anchor_dispatch_failed") {
            return false;
          }
          return event.payload.jobId === pendingRejectJobId;
        });
        if (!matched) return;
        setPendingRejectJobId(null);
        if (matched.eventType === "anchor_dispatch_submitted") {
          addToast("success", "反馈已送达 anchor · 等待 AI 重写...");
          return;
        }
        const message = typeof matched.payload.errorMessage === "string" ? matched.payload.errorMessage : "Anchor dispatch 失败";
        setAwaitingRewrite(false);
        addToast("error", `反馈派出失败：${message}`);
      } catch {
        // 下一轮继续尝试。
      }
    };
    void checkDispatch();
    const handle = window.setInterval(() => {
      if (typeof document !== "undefined" && document.hidden) return;
      void checkDispatch();
    }, POLL_INTERVAL_MS);
    return () => window.clearInterval(handle);
  }, [addToast, pendingRejectJobId, requirementId]);

  useEffect(() => {
    if (!pendingMaterializeJobId) return;
    const checkDispatch = async () => {
      try {
        const events = await fetchEventJournalEvents({
          subjectType: "requirement",
          subjectId: requirementId,
          limit: 20
        });
        const matched = events.items.find((event) => {
          if (event.eventType !== "anchor_dispatch_submitted" && event.eventType !== "anchor_dispatch_failed") {
            return false;
          }
          return event.payload.jobId === pendingMaterializeJobId;
        });
        if (!matched) return;
        setPendingMaterializeJobId(null);
        setMaterializing(false);
        if (matched.eventType === "anchor_dispatch_submitted") {
          addToast("success", "物化指令已送达 anchor · 等待子任务生成...");
          if (selectedProjectId) {
            await loadProjectData(selectedProjectId);
          }
          return;
        }
        const message = typeof matched.payload.errorMessage === "string" ? matched.payload.errorMessage : "Anchor dispatch 失败";
        addToast("error", `物化派出失败：${message}`);
      } catch {
        // 下一轮继续尝试。
      }
    };
    void checkDispatch();
    const handle = window.setInterval(() => {
      if (typeof document !== "undefined" && document.hidden) return;
      void checkDispatch();
    }, POLL_INTERVAL_MS);
    return () => window.clearInterval(handle);
  }, [addToast, loadProjectData, pendingMaterializeJobId, requirementId, selectedProjectId]);

  const handleMaterialize = async () => {
    if (!result) return;
    const included = result.draft.subtasks.filter((s) => s.include);
    if (included.length === 0) {
      addToast("error", "至少要保留 1 个 SubTask 才能入库");
      return;
    }
    const proceed = window.confirm(
      `确认入库？将在当前需求下创建 ${included.length} 个子任务。该操作不可撤销。`
    );
    if (!proceed) return;
    if (!selectedProjectId) {
      addToast("error", "请先选择项目");
      return;
    }

    setMaterializing(true);
    try {
      await startRequirementPlanningAnchor(selectedProjectId, requirementId);
      const out = await materializeRequirement(selectedProjectId, requirementId, result.hash);
      setPendingMaterializeJobId(out.jobId);
      addToast("success", `已排队送往 anchor ${out.anchorId.slice(-8)}：${out.jobId}`);
      if (onAfterMaterialize) onAfterMaterialize(requirementId);
      await loadProjectData(selectedProjectId);
    } catch (e) {
      addToast("error", e instanceof Error ? e.message : "入库失败");
      setMaterializing(false);
    }
  };

  const handleReject = async (reason: string) => {
    if (!result) return;
    if (!selectedProjectId) {
      throw new Error("请先选择项目");
    }
    await startRequirementPlanningAnchor(selectedProjectId, requirementId);
    const out = await rejectAndFeedback(selectedProjectId, requirementId, reason, result.hash);
    setAwaitingRewrite(true);
    setPendingRejectJobId(out.jobId);
    addToast("success", `已排队送回 anchor ${out.anchorId.slice(-8)}：${out.jobId}`);
    await loadProjectData(selectedProjectId);
  };

  if (loading) {
    return <div className={styles.empty}>加载草案中…</div>;
  }

  if (error || !result) {
    return (
      <div className={styles.errorState}>
        <div className={styles.errorIcon}>⏳</div>
        <div className={styles.errorMsg}>{error ?? "无草案"}</div>
        <Button size="sm" variant="secondary" onClick={() => void load()}>
          刷新
        </Button>
      </div>
    );
  }

  const { draft, hash } = result;
  const rejectedCount = (draft.review_history ?? []).filter((e) => e.action === "rejected").length;
  const lastRejected = (draft.review_history ?? [])
    .slice()
    .reverse()
    .find((e) => e.action === "rejected");

  return (
    <div className={styles.root}>
      <header className={styles.header}>
        <div className={styles.metaRow}>
          <span className={styles.statusBadge} data-status={draft.status}>
            {draft.status === "draft"
              ? "草案"
              : draft.status === "reviewing"
                ? "审查中"
                : draft.status === "approved"
                  ? "已批准"
                  : draft.status === "consumed"
                    ? "已入库"
                    : "已取消"}
          </span>
          <span className={styles.metaItem}>
            更新于 <strong>{formatRelative(draft.updated_at)}</strong>
          </span>
          <span className={styles.metaItem}>
            生成方 <code>{draft.generated_by === "ai_session" ? draft.generation_source.cc_agent ?? "ai" : "手动"}</code>
          </span>
          <span className={styles.metaItem}>
            hash <code className={styles.hash}>{hash.slice(0, 10)}</code>
          </span>
          {rejectedCount > 0 ? (
            <span className={styles.rejectedHistory}>已拒绝 {rejectedCount} 次</span>
          ) : null}
        </div>
        <div className={styles.actions}>
          <Button
            variant="ghost"
            onClick={() => setRejectOpen(true)}
            disabled={materializing || awaitingRewrite || Boolean(pendingMaterializeJobId) || draft.status === "consumed" || draft.status === "cancelled"}
          >
            ✗ 拒绝并送回 AI
          </Button>
          <Button
            variant="primary"
            onClick={handleMaterialize}
            loading={materializing}
            disabled={draft.status === "consumed" || draft.status === "cancelled" || Boolean(pendingMaterializeJobId)}
          >
            ✓ 同意并入库
          </Button>
        </div>
      </header>

      {awaitingRewrite ? (
        <div className={styles.rewriteBanner}>
          <span className={styles.rewriteSpinner}>🔄</span>
          <div>
            <strong>已送回 AI · 等待重写中</strong>
            <div className={styles.rewriteMeta}>
              检测到新草案后会自动刷新（每 {POLL_INTERVAL_MS / 1000} 秒检查一次）
              {lastRejected?.note ? (
                <>
                  {" · "}最后反馈：<em>{lastRejected.note.slice(0, 80)}{lastRejected.note.length > 80 ? "…" : ""}</em>
                </>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}

      <div className={styles.threeCol}>
        <div className={styles.colLeft}>
          <PlanOverviewPanel plan={draft.plan} subtasks={draft.subtasks} />
        </div>
        <div className={styles.colMid}>
          <SubtaskListPanel
            subtasks={draft.subtasks}
            selectedIndex={selectedIdx}
            onSelect={setSelectedIdx}
          />
        </div>
        <div className={styles.colRight}>
          <SubtaskDetailPanel
            subtask={draft.subtasks[selectedIdx]}
            allSectionIds={draft.subtasks.map((s) => s.section_id)}
          />
        </div>
      </div>

      <RejectFeedbackModal
        open={rejectOpen}
        onClose={() => setRejectOpen(false)}
        onSubmit={handleReject}
      />
    </div>
  );
}
