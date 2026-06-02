import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router";

import { Button } from "../../components/ui/Button.js";
import { Input, Textarea } from "../../components/ui/Input.js";
import { Modal } from "../../components/ui/Modal.js";
import {
  archiveSlot,
  cancelSlotCurrentJob,
  confirmProjectCcbdRestore,
  fetchProjectCcbdStatus,
  fetchSlots,
  releaseSlot,
  renewSlot,
  type ProjectCcbdStatusView,
  type SlotLaneView,
  type SlotProjectionView,
  type SlotQueueItemView
} from "../../lib/console-api.js";
import { useProjectStore } from "../../stores/project-store.js";
import { useUIStore } from "../../stores/ui-store.js";
import styles from "./SlotsPage.module.css";

const POLL_INTERVAL_MS = 5000;

const STATE_LABEL: Record<string, string> = {
  idle: "空闲",
  bound: "已绑定",
  busy: "运行中",
  unhealthy: "异常",
  recovering: "恢复中",
  draining: "排空中"
};

interface ForceReleaseDraft {
  slotId: string;
  reason: string;
  confirmText: string;
  error: string | null;
}

function formatDateTime(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

function stateLabel(state: string): string {
  return STATE_LABEL[state] ?? state;
}

function requirementLabel(slot: SlotLaneView): string {
  if (!slot.requirement) return "未绑定 requirement";
  return slot.requirement.title;
}

function queueTitle(item: SlotQueueItemView): string {
  return item.title ?? item.requirementTitle ?? item.subjectId;
}

export function SlotsPage() {
  const navigate = useNavigate();
  const selectedProjectId = useProjectStore((state) => state.selectedProjectId);
  const projects = useProjectStore((state) => state.projects);
  const addToast = useUIStore((state) => state.addToast);
  const [projection, setProjection] = useState<SlotProjectionView | null>(null);
  const [projectCcbdStatus, setProjectCcbdStatus] = useState<ProjectCcbdStatusView | null>(null);
  const [loading, setLoading] = useState(true);
  const [releasingSlotId, setReleasingSlotId] = useState<string | null>(null);
  const [actioningSlotId, setActioningSlotId] = useState<string | null>(null);
  const [forceDraft, setForceDraft] = useState<ForceReleaseDraft | null>(null);
  const [waitNotice, setWaitNotice] = useState<string | null>(null);
  const [restoringConfig, setRestoringConfig] = useState(false);

  const selectedProjectName = useMemo(
    () => projects.find((project) => project.id === selectedProjectId)?.name ?? projection?.project.name ?? null,
    [projection?.project.name, projects, selectedProjectId]
  );

  const loadSlots = useCallback(async () => {
    if (!selectedProjectId) {
      setProjection(null);
      setProjectCcbdStatus(null);
      setLoading(false);
      return;
    }

    try {
      const [status, next] = await Promise.all([
        fetchProjectCcbdStatus(selectedProjectId),
        fetchSlots(selectedProjectId)
      ]);
      setProjectCcbdStatus(status);
      setProjection(next);
    } catch (error) {
      addToast("error", error instanceof Error ? error.message : "加载 Slot 拓扑失败");
    } finally {
      setLoading(false);
    }
  }, [addToast, selectedProjectId]);

  useEffect(() => {
    setLoading(true);
    void loadSlots();
    const intervalId = window.setInterval(() => {
      void loadSlots();
    }, POLL_INTERVAL_MS);
    return () => {
      window.clearInterval(intervalId);
    };
  }, [loadSlots]);

  const summary = useMemo(() => {
    const slots = projection?.slots ?? [];
    return {
      bound: slots.filter((slot) => slot.state === "bound").length,
      busy: slots.filter((slot) => slot.state === "busy").length,
      unhealthy: slots.filter((slot) => slot.state === "unhealthy" || slot.unhealthy).length,
      queued: projection?.queue.length ?? 0
    };
  }, [projection]);

  const handleManualRelease = async (slot: SlotLaneView) => {
    if (!selectedProjectId || slot.state === "idle") return;
    if (!window.confirm(`确认释放 ${slot.slotId} 吗？`)) return;

    setReleasingSlotId(slot.slotId);
    try {
      const next = await releaseSlot(selectedProjectId, slot.slotId, { confirm: true });
      setProjection(next);
      addToast("success", `已释放 ${slot.slotId}`);
    } catch (error) {
      addToast("error", error instanceof Error ? error.message : `释放 ${slot.slotId} 失败`);
    } finally {
      setReleasingSlotId(null);
    }
  };

  const handleConfirmForceRelease = async () => {
    if (!selectedProjectId || !forceDraft) return;
    const reason = forceDraft.reason.trim();
    const expected = `RELEASE ${forceDraft.slotId}`;
    if (!reason || forceDraft.confirmText.trim() !== expected) {
      setForceDraft({ ...forceDraft, error: `请输入原因并填写 ${expected}` });
      return;
    }

    setReleasingSlotId(forceDraft.slotId);
    try {
      const next = await releaseSlot(selectedProjectId, forceDraft.slotId, {
        confirm: true,
        force: true,
        reason
      });
      setProjection(next);
      setForceDraft(null);
      addToast("success", `已强制释放 ${forceDraft.slotId}`);
    } catch (error) {
      setForceDraft({
        ...forceDraft,
        error: error instanceof Error ? error.message : `强制释放 ${forceDraft.slotId} 失败`
      });
    } finally {
      setReleasingSlotId(null);
    }
  };

  const handleConfirmRestore = async () => {
    if (!selectedProjectId) return;
    setRestoringConfig(true);
    try {
      const result = await confirmProjectCcbdRestore(selectedProjectId);
      setProjectCcbdStatus(result.status);
      await loadSlots();
      addToast("success", "已恢复 managed config 并启动 project ccbd");
    } catch (error) {
      addToast("error", error instanceof Error ? error.message : "恢复 project ccbd 失败");
    } finally {
      setRestoringConfig(false);
    }
  };

  const handleRenew = async (slot: SlotLaneView) => {
    if (!selectedProjectId) return;
    setActioningSlotId(slot.slotId);
    try {
      const next = await renewSlot(selectedProjectId, slot.slotId);
      setProjection(next);
      addToast("success", `已续期 ${slot.slotId}`);
    } catch (error) {
      addToast("error", error instanceof Error ? error.message : `续期 ${slot.slotId} 失败`);
    } finally {
      setActioningSlotId(null);
    }
  };

  const handleArchive = async (slot: SlotLaneView) => {
    if (!selectedProjectId || !slot.requirement) return;
    if (!window.confirm(`确认归档 ${slot.slotId} 绑定的 ${slot.requirement.id} 吗？`)) return;
    setActioningSlotId(slot.slotId);
    try {
      const result = await archiveSlot(selectedProjectId, slot.slotId, { confirm: true });
      await loadSlots();
      addToast("success", `已提交归档 ${result.requirementId}`);
    } catch (error) {
      addToast("error", error instanceof Error ? error.message : `归档 ${slot.slotId} 失败`);
    } finally {
      setActioningSlotId(null);
    }
  };

  const handleCancelCurrentJob = async (slot: SlotLaneView) => {
    if (!selectedProjectId) return;
    if (!window.confirm(`确认取消 ${slot.slotId} 当前 job 吗？`)) return;
    setActioningSlotId(slot.slotId);
    try {
      const next = await cancelSlotCurrentJob(selectedProjectId, slot.slotId, { confirm: true });
      setProjection(next);
      addToast("success", `已取消 ${slot.slotId} 当前 job`);
    } catch (error) {
      addToast("error", error instanceof Error ? error.message : `取消 ${slot.slotId} 当前 job 失败`);
    } finally {
      setActioningSlotId(null);
    }
  };

  const handleWait = (slot: SlotLaneView) => {
    const message = `已保留 ${slot.slotId}，等待下一次检测或人工处理`;
    setWaitNotice(message);
    addToast("info", message);
  };

  if (!selectedProjectId) {
    return (
      <div className={styles.page}>
        <div className={styles.empty}>
          <strong>未选择项目</strong>
          <span>选择项目后可查看 Slot 拓扑。</span>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div>
          <h1 className={styles.title}>Slot 拓扑</h1>
          <p className={styles.subtitle}>
            {selectedProjectName ? `${selectedProjectName} 的运行窗口` : "当前项目运行窗口"}：main 负责协调，slot-1 到
            slot-5 承载 requirement 执行与队列调度。
          </p>
        </div>
        <dl className={styles.summary}>
          <div className={styles.summaryItem}>
            <dt>已绑定</dt>
            <dd>{summary.bound}</dd>
          </div>
          <div className={styles.summaryItem}>
            <dt>运行中</dt>
            <dd>{summary.busy}</dd>
          </div>
          <div className={styles.summaryItem}>
            <dt>异常</dt>
            <dd>{summary.unhealthy}</dd>
          </div>
          <div className={styles.summaryItem}>
            <dt>排队</dt>
            <dd>{summary.queued}</dd>
          </div>
        </dl>
      </header>

      {projectCcbdStatus?.startupBlocked && projectCcbdStatus.config.drift ? (
        <section className={styles.driftBanner} aria-label="project ccbd drift">
          <div>
            <h2>Project ccbd 启动已阻断</h2>
            <p>managed config core 字段与预期拓扑不一致，需要二次确认后才会恢复并启动。</p>
          </div>
          <pre className={styles.driftDiff}>{projectCcbdStatus.config.drift.diff}</pre>
          <Button loading={restoringConfig} onClick={() => void handleConfirmRestore()} variant="danger">
            确认恢复并启动
          </Button>
        </section>
      ) : null}

      {loading && !projection ? (
        <div className={styles.placeholder}>加载中...</div>
      ) : projection ? (
        <>
          <section className={styles.mainLane} aria-label="main lane">
            <div>
              <div className={styles.mainTitle}>
                <code>{projection.main.slotId}</code>
                <span className={styles.lockedBadge}>协调通道</span>
              </div>
              <p className={styles.mainDescription}>不承载业务绑定，不提供 release 操作。</p>
            </div>
            <span className={styles.stateBadge} data-state="idle">
              {projection.main.canBindBusiness ? "可绑定" : "不可绑定业务"}
            </span>
          </section>

          <ul className={styles.slotList}>
            {projection.slots.map((slot) => (
              <li className={styles.slotRow} data-state={slot.state} data-testid="slot-row" key={slot.slotId}>
                <div className={styles.rowTop}>
                  <div>
                    <div className={styles.rowTitle}>
                      <code className={styles.slotId}>{slot.slotId}</code>
                      <span className={styles.stateBadge} data-state={slot.state}>
                        {stateLabel(slot.state)}
                      </span>
                    </div>
                    <p className={styles.rowSubtitle}>{requirementLabel(slot)}</p>
                  </div>
                  <div className={styles.badges}>
                    {slot.stale ? (
                      <span className={styles.healthBadge} data-kind="stale" title={formatDateTime(slot.stale.detectedAt)}>
                        stale
                      </span>
                    ) : null}
                    {slot.unhealthy ? (
                      <span
                        className={styles.healthBadge}
                        data-kind="unhealthy"
                        title={slot.unhealthy.degradedReason ?? undefined}
                      >
                        unhealthy
                      </span>
                    ) : null}
                  </div>
                </div>

                <dl className={styles.meta}>
                  <div>
                    <dt>Requirement</dt>
                    <dd>
                      {slot.requirement ? (
                        <button
                          className={styles.linkButton}
                          onClick={() => navigate(`/requirements/${slot.requirement?.id}`)}
                          type="button"
                        >
                          {slot.requirement.id}
                        </button>
                      ) : (
                        <span className={styles.muted}>—</span>
                      )}
                    </dd>
                  </div>
                  <div>
                    <dt>最近活动</dt>
                    <dd>{formatDateTime(slot.lastActivityAt)}</dd>
                  </div>
                  <div>
                    <dt>绑定时间</dt>
                    <dd>{formatDateTime(slot.boundAt)}</dd>
                  </div>
                  <div>
                    <dt>运行开始</dt>
                    <dd>{formatDateTime(slot.busySince)}</dd>
                  </div>
                  <div>
                    <dt>本 slot 排队</dt>
                    <dd>{slot.queued.length}</dd>
                  </div>
                </dl>

                {slot.queued.length > 0 ? (
                  <ul className={styles.queueList}>
                    {slot.queued.map((item) => (
                      <QueueItem item={item} key={item.jobId} />
                    ))}
                  </ul>
                ) : null}

                <div className={styles.rowActions}>
                  {slot.stale ? (
                    <>
                      <Button
                        disabled={actioningSlotId === slot.slotId}
                        loading={actioningSlotId === slot.slotId}
                        onClick={() => void handleRenew(slot)}
                        size="sm"
                        variant="secondary"
                      >
                        续期 {slot.slotId}
                      </Button>
                      <Button
                        disabled={!slot.requirement || actioningSlotId === slot.slotId}
                        loading={actioningSlotId === slot.slotId}
                        onClick={() => void handleArchive(slot)}
                        size="sm"
                        variant="secondary"
                      >
                        归档 {slot.slotId}
                      </Button>
                    </>
                  ) : null}
                  {slot.unhealthy ? (
                    <>
                      <Button
                        disabled={actioningSlotId === slot.slotId}
                        loading={actioningSlotId === slot.slotId}
                        onClick={() => void handleCancelCurrentJob(slot)}
                        size="sm"
                        variant="secondary"
                      >
                        取消当前 job {slot.slotId}
                      </Button>
                      <Button onClick={() => handleWait(slot)} size="sm" variant="ghost">
                        等待 {slot.slotId}
                      </Button>
                    </>
                  ) : null}
                  {slot.state === "busy" || slot.unhealthy ? (
                    <Button
                      disabled={releasingSlotId === slot.slotId}
                      loading={releasingSlotId === slot.slotId}
                      onClick={() => setForceDraft({ slotId: slot.slotId, reason: "", confirmText: "", error: null })}
                      size="sm"
                      variant="danger"
                    >
                      强制释放 {slot.slotId}
                    </Button>
                  ) : (
                    <Button
                      disabled={slot.state === "idle" || releasingSlotId === slot.slotId}
                      loading={releasingSlotId === slot.slotId}
                      onClick={() => void handleManualRelease(slot)}
                      size="sm"
                      variant={slot.state === "idle" ? "ghost" : "secondary"}
                    >
                      释放 {slot.slotId}
                    </Button>
                  )}
                </div>
                {waitNotice?.includes(slot.slotId) ? <p className={styles.inlineNotice}>{waitNotice}</p> : null}
              </li>
            ))}
          </ul>

          <section className={styles.queuePanel} aria-label="slot queue">
            <div className={styles.queuePanelHeader}>
              <div>
                <div className={styles.queueTitle}>FIFO 队列</div>
                <p className={styles.queueMeta}>{projection.queue.length} 个请求等待空闲 slot</p>
              </div>
            </div>
            {projection.queue.length === 0 ? (
              <div className={styles.empty}>当前没有排队请求。</div>
            ) : (
              <ul className={styles.queueList}>
                {projection.queue.map((item) => (
                  <QueueItem item={item} key={item.jobId} />
                ))}
              </ul>
            )}
          </section>
        </>
      ) : (
        <div className={styles.empty}>Slot 拓扑暂不可用。</div>
      )}

      <Modal
        footer={
          <>
            <Button onClick={() => setForceDraft(null)} variant="ghost">
              取消
            </Button>
            <Button
              loading={forceDraft ? releasingSlotId === forceDraft.slotId : false}
              onClick={() => void handleConfirmForceRelease()}
              variant="danger"
            >
              确认强制释放
            </Button>
          </>
        }
        onClose={() => setForceDraft(null)}
        open={forceDraft !== null}
        title={forceDraft ? `强制释放 ${forceDraft.slotId}` : "强制释放 Slot"}
      >
        {forceDraft ? (
          <div className={styles.dialogBody}>
            <label className={styles.field} htmlFor="slot-force-release-reason">
              强制释放原因
              <Textarea
                aria-label="强制释放原因"
                id="slot-force-release-reason"
                onChange={(event) => setForceDraft({ ...forceDraft, reason: event.target.value, error: null })}
                rows={3}
                value={forceDraft.reason}
              />
            </label>
            <label className={styles.field} htmlFor="slot-force-release-confirm">
              确认文本
              <Input
                aria-label="确认文本"
                id="slot-force-release-confirm"
                onChange={(event) => setForceDraft({ ...forceDraft, confirmText: event.target.value, error: null })}
                value={forceDraft.confirmText}
              />
              <span className={styles.fieldHint}>请输入 RELEASE {forceDraft.slotId}</span>
            </label>
            {forceDraft.error ? <p className={styles.dialogError}>{forceDraft.error}</p> : null}
          </div>
        ) : null}
      </Modal>
    </div>
  );
}

function QueueItem(props: { item: SlotQueueItemView }) {
  return (
    <li className={styles.queueItem}>
      <div className={styles.rowTitle}>
        <span>{queueTitle(props.item)}</span>
        {props.item.requirementId ? <code>{props.item.requirementId}</code> : null}
      </div>
      <div className={styles.queueMeta}>
        {props.item.subjectType}:{props.item.subjectId} · {formatDateTime(props.item.queuedAt)}
      </div>
      <div className={styles.queueCommand}>{props.item.command}</div>
    </li>
  );
}
