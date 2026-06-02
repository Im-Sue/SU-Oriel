import { useMemo, useState } from "react";

import styles from "./RunsPage.module.css";
import { Badge } from "../../components/ui/Badge.js";
import { EmptyState } from "../../components/ui/EmptyState.js";
import { SegmentedControl } from "../../components/ui/SegmentedControl.js";
import { SkeletonCard } from "../../components/ui/Skeleton.js";
import { formatDayTime } from "../../lib/format.js";
import { getJobStatusBadge, getJobTypeLabel } from "../../lib/ui-mapping.js";
import { useProjectStore } from "../../stores/project-store.js";
import { useUIStore } from "../../stores/ui-store.js";

type RunsFilter = "all" | "failed";

export function RunsPage() {
  const selectedProjectId = useProjectStore((state) => state.selectedProjectId);
  const syncJobs = useProjectStore((state) => state.syncJobs);
  const loadingData = useProjectStore((state) => state.loadingData);
  const scanProject = useProjectStore((state) => state.scanProject);
  const addToast = useUIStore((state) => state.addToast);
  const openModal = useUIStore((state) => state.openModal);
  const [filter, setFilter] = useState<RunsFilter>("all");

  const sortedJobs = useMemo(
    () => [...syncJobs].sort((left, right) => new Date(right.startedAt).getTime() - new Date(left.startedAt).getTime()),
    [syncJobs]
  );
  const failedJobs = sortedJobs.filter((job) => job.status === "failed");
  const visibleJobs = filter === "failed" ? failedJobs : sortedJobs;

  const handleScan = async () => {
    try {
      await scanProject();
      addToast("success", "项目扫描已开始");
    } catch (error) {
      addToast("error", error instanceof Error ? error.message : "项目扫描失败");
    }
  };

  if (!selectedProjectId) {
    return (
      <EmptyState
        action={{ label: "创建项目", onClick: () => openModal("create-project") }}
        description="当前项目不存在或尚未创建。重新创建项目后，运行记录会从新的扫描开始累积。"
        icon="↻"
        title="还没有选中的项目"
      />
    );
  }

  if (loadingData) {
    return (
      <div className={styles.page}>
        {Array.from({ length: 3 }).map((_, index) => (
          <SkeletonCard className={styles.skeleton} key={`runs-skeleton-${index}`} />
        ))}
      </div>
    );
  }

  if (syncJobs.length === 0) {
    return (
      <EmptyState
        action={{ label: "重新扫描项目", onClick: () => void handleScan() }}
        description="执行项目扫描后会产生运行记录。"
        icon="↻"
        title="还没有运行记录"
      />
    );
  }

  return (
    <div className={styles.page}>
      <div className={styles.toolbar}>
        <div className={styles.toolbarMeta}>共 {syncJobs.length} 条记录</div>
        <SegmentedControl
          onChange={(value) => setFilter(value as RunsFilter)}
          options={[
            { value: "all", label: "全部" },
            { value: "failed", label: "仅失败" }
          ]}
          value={filter}
        />
      </div>

      {failedJobs.length > 0 ? (
        <section className={styles.alertCard}>
          <div className={styles.alertTitle}>最近失败记录</div>
          <div className={styles.alertList}>
            {failedJobs.slice(0, 3).map((job) => (
              <div className={styles.alertItem} key={job.id}>
                <div className={styles.alertMain}>{job.logSummary ?? "暂无摘要"}</div>
                <div className={styles.alertSub}>{job.errorMessage ?? "暂无错误详情"}</div>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <section className={styles.tableCard}>
        <div className={styles.tableHeader}>
          <div>类型</div>
          <div>状态</div>
          <div>开始时间</div>
          <div>摘要</div>
        </div>
        <div className={styles.tableBody}>
          {visibleJobs.map((job) => {
            const badge = getJobStatusBadge(job.status);
            return (
              <div className={styles.tableRow} key={job.id}>
                <div>{getJobTypeLabel(job.jobType)}</div>
                <div>
                  <Badge color={badge.color} label={badge.label} />
                </div>
                <div>{formatDayTime(job.startedAt)}</div>
                <div className={styles.summaryCell}>{job.logSummary ?? "暂无摘要"}</div>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
