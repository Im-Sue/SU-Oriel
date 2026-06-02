import { SidebarCard } from "./TaskSidebar.js";
import styles from "./WorkspaceCard.module.css";
import type { TaskWorkspaceView } from "../../../types/task.js";

interface WorkspaceCardProps {
  activeWorkspace: TaskWorkspaceView | null;
  isExecutable: boolean;
  onCopyPath: (path: string) => void;
  onOpenDetail: () => void;
}

const STATUS_LABEL: Record<string, string> = {
  ready: "就绪",
  in_use: "使用中",
  creating: "创建中",
  cleanup_pending: "待清理",
  cleaned: "已清理",
  failed: "失败"
};

const STATUS_COLOR: Record<string, string> = {
  ready: "green",
  in_use: "blue",
  creating: "yellow",
  cleanup_pending: "yellow",
  cleaned: "gray",
  failed: "red"
};

export function WorkspaceCard({
  activeWorkspace,
  isExecutable,
  onCopyPath,
  onOpenDetail
}: WorkspaceCardProps) {
  if (!isExecutable) {
    return (
      <SidebarCard title="工作区" icon="🗂">
        <p className={styles.placeholder}>史诗任务（容器）不创建工作区</p>
      </SidebarCard>
    );
  }

  if (!activeWorkspace) {
    return (
      <SidebarCard title="工作区" icon="🗂">
        <p className={styles.placeholder}>当前任务还没有工作区</p>
      </SidebarCard>
    );
  }

  return (
    <SidebarCard title="工作区" icon="🗂">
      <div className={styles.statusRow}>
        <span className={styles.statusPill} data-color={STATUS_COLOR[activeWorkspace.status] ?? "gray"}>
          ● {STATUS_LABEL[activeWorkspace.status] ?? activeWorkspace.status}
        </span>
      </div>
      <div className={styles.row}>
        <span className={styles.rowLabel}>分支</span>
        <code className={styles.code}>{activeWorkspace.branchName}</code>
      </div>
      <div className={styles.row}>
        <span className={styles.rowLabel}>路径</span>
        <code className={styles.code}>{activeWorkspace.workspacePath}</code>
      </div>
      <div className={styles.actions}>
        <button
          aria-label="复制工作区路径"
          className={styles.button}
          onClick={() => onCopyPath(activeWorkspace.workspacePath)}
          type="button"
        >
          复制路径
        </button>
        <button
          aria-label="查看工作区详情"
          className={styles.button}
          onClick={onOpenDetail}
          type="button"
        >
          查看详情
        </button>
      </div>
    </SidebarCard>
  );
}
