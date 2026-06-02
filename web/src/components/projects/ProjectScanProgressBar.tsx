import { useEffect, useMemo, useRef, useState } from "react";

import { fetchProjectScanStatus } from "../../lib/console-api.js";
import { useProjectStore } from "../../stores/project-store.js";
import type { ProjectScanStatusView, ProjectView } from "../../types/project.js";
import styles from "./ProjectScanProgressBar.module.css";

const POLL_INTERVAL_MS = 750;
const COMPLETE_HOLD_MS = 700;

type ScanProgressState = "hidden" | "scanning" | "complete" | "failed";

// 阶段标签：覆盖 scanProject 流水线全部 job 阶段（与后端 deriveScanPhase 白名单一致）。
const PHASE_LABELS: Record<string, string> = {
  scan: "扫描文档",
  parse: "解析文档",
  template_conformance: "模板校验",
  requirement_sync: "同步需求",
  reconcile: "归并任务",
  plugin_journal_sync: "同步事件流水",
  requirement_design_doc_sync: "同步设计文档",
  breakdown_draft_sync: "同步拆分草稿",
  requirement_rollup: "汇总状态",
  preparing: "准备中"
};

function phaseLabel(phase: string | null): string {
  if (!phase) {
    return "同步索引中";
  }
  return PHASE_LABELS[phase] ?? "同步索引中";
}

interface ProjectScanProgressBarProps {
  project: ProjectView | null;
}

function isTerminalProjectStatus(status: ProjectView["syncStatus"]): boolean {
  return status !== "scanning";
}

export function ProjectScanProgressBar({ project }: ProjectScanProgressBarProps) {
  const silentRefreshProjects = useProjectStore((state) => state.silentRefreshProjects);
  const loadProjectData = useProjectStore((state) => state.loadProjectData);
  const [scanStatus, setScanStatus] = useState<ProjectScanStatusView | null>(null);
  const [progressState, setProgressState] = useState<ScanProgressState>("hidden");
  const hideTimerRef = useRef<number | null>(null);
  const terminalHandledProjectRef = useRef<string | null>(null);
  const projectId = project?.id ?? null;

  useEffect(() => {
    terminalHandledProjectRef.current = null;
    if (hideTimerRef.current !== null) {
      window.clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
    setScanStatus(null);
    setProgressState(project?.syncStatus === "scanning" ? "scanning" : "hidden");
  }, [projectId]);

  useEffect(() => {
    if (project?.syncStatus !== "scanning") {
      return;
    }
    terminalHandledProjectRef.current = null;
    if (hideTimerRef.current !== null) {
      window.clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
    setProgressState("scanning");
  }, [project?.syncStatus]);

  useEffect(() => {
    return () => {
      if (hideTimerRef.current !== null) {
        window.clearTimeout(hideTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!projectId || project?.syncStatus !== "scanning") {
      return;
    }

    let cancelled = false;
    // 真正终态(syncStatus 非 scanning)才标完成；不再人为把 processedCount 拉到 total 伪造 100%。
    const markComplete = (nextStatus: ProjectScanStatusView) => {
      if (terminalHandledProjectRef.current === projectId) {
        return;
      }
      terminalHandledProjectRef.current = projectId;
      setScanStatus(nextStatus);
      setProgressState("complete");
      void silentRefreshProjects();
      void loadProjectData(projectId).catch(() => undefined);
      hideTimerRef.current = window.setTimeout(() => {
        if (!cancelled) {
          setProgressState("hidden");
          setScanStatus(null);
        }
      }, COMPLETE_HOLD_MS);
    };

    const markFailed = (nextStatus: ProjectScanStatusView) => {
      if (terminalHandledProjectRef.current === projectId) {
        return;
      }
      terminalHandledProjectRef.current = projectId;
      setScanStatus(nextStatus);
      setProgressState("failed");
      void silentRefreshProjects();
      void loadProjectData(projectId).catch(() => undefined);
    };

    const poll = async () => {
      try {
        const nextStatus = await fetchProjectScanStatus(projectId);
        if (cancelled) {
          return;
        }
        setScanStatus(nextStatus);
        if (
          nextStatus.projectSyncStatus === "failed" ||
          nextStatus.status === "failed" ||
          nextStatus.phaseStatus === "failed"
        ) {
          markFailed(nextStatus);
          return;
        }
        if (isTerminalProjectStatus(nextStatus.projectSyncStatus)) {
          markComplete(nextStatus);
        }
      } catch {
        // 轮询失败不打断主界面；下一次轮询继续尝试。
      }
    };

    setProgressState("scanning");
    void poll();
    const intervalId = window.setInterval(() => {
      void poll();
    }, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [loadProjectData, project?.syncStatus, projectId, silentRefreshProjects]);

  const display = useMemo(() => {
    const totalCount = scanStatus?.totalCount ?? 0;
    const rawProcessed = scanStatus?.processedCount ?? 0;
    const phase = scanStatus?.phase ?? null;
    const processedCount = Math.min(rawProcessed, totalCount || Number.MAX_SAFE_INTEGER);
    // determinate 仅在「正处于 scan 阶段且文件枚举尚未跑满」时成立；
    // 一旦 scan 阶段跑满或进入后续阶段，切换为 indeterminate + 阶段标签，scanning 期间绝不显 100%。
    const isCountingScan =
      progressState === "scanning" && phase === "scan" && totalCount > 0 && processedCount < totalCount;
    const percent =
      progressState === "complete"
        ? 100
        : isCountingScan
          ? Math.min(99, Math.round((processedCount / totalCount) * 100))
          : 0;
    return {
      processedCount,
      totalCount,
      phase,
      isCountingScan,
      percent,
      errorMessage: (scanStatus?.phaseErrorMessage ?? scanStatus?.errorMessage)?.trim() ?? ""
    };
  }, [progressState, scanStatus]);

  if (!projectId || progressState === "hidden") {
    return null;
  }

  const isIndeterminate = progressState === "scanning" && !display.isCountingScan;
  const projectName = project?.name ?? "项目";
  const label =
    progressState === "failed"
      ? "扫描失败"
      : progressState === "complete"
        ? "扫描完成"
        : display.isCountingScan
          ? PHASE_LABELS.scan
          : phaseLabel(display.phase);
  const countLabel =
    progressState === "complete"
      ? "100%"
      : progressState === "failed"
        ? "未完成"
        : display.isCountingScan
          ? `${display.processedCount}/${display.totalCount} · ${display.percent}%`
          : "进行中";

  return (
    <div className={styles.scanProgress} data-state={progressState} data-indeterminate={String(isIndeterminate)}>
      <div className={styles.progressMeta}>
        <span className={styles.progressTitle}>
          {projectName} · {label}
        </span>
        <span className={styles.progressCount}>{countLabel}</span>
      </div>
      <div
        aria-label="项目扫描进度"
        aria-valuemax={display.isCountingScan ? display.totalCount : undefined}
        aria-valuemin={display.isCountingScan ? 0 : undefined}
        aria-valuenow={display.isCountingScan ? display.processedCount : undefined}
        className={styles.progressTrack}
        role="progressbar"
      >
        <div className={styles.progressBar} style={{ width: isIndeterminate ? undefined : `${display.percent}%` }} />
      </div>
      {progressState === "failed" ? (
        <div className={styles.progressError}>{display.errorMessage || "项目扫描失败"}</div>
      ) : null}
    </div>
  );
}
