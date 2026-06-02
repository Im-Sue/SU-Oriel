import { DetailDrawer } from "./DetailDrawer.js";
import styles from "./WorkspaceDrawer.module.css";
import type { TaskWorkspaceView } from "../../types/task.js";

interface WorkspaceDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  activeWorkspace: TaskWorkspaceView | null;
  historicalWorkspaces: TaskWorkspaceView[];
  isExecutable: boolean;
  onCopyPath: (path: string) => void;
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

export function WorkspaceDrawer({
  isOpen,
  onClose,
  activeWorkspace,
  historicalWorkspaces,
  isExecutable,
  onCopyPath
}: WorkspaceDrawerProps) {
  return (
    <DetailDrawer isOpen={isOpen} onClose={onClose} title="工作区详情">
      {!isExecutable ? (
        <p className={styles.placeholder}>史诗任务（容器）不创建工作区。</p>
      ) : activeWorkspace ? (
        <>
          <div className={styles.section}>
            <div className={styles.sectionLabel}>状态</div>
            <span className={styles.statusPill} data-color={STATUS_COLOR[activeWorkspace.status] ?? "gray"}>
              ● {STATUS_LABEL[activeWorkspace.status] ?? activeWorkspace.status}
            </span>
          </div>

          <div className={styles.section}>
            <div className={styles.sectionLabel}>分支</div>
            <code className={styles.code}>{activeWorkspace.branchName}</code>
          </div>

          <div className={styles.section}>
            <div className={styles.sectionLabel}>路径</div>
            <code className={styles.code}>{activeWorkspace.workspacePath}</code>
            <button className={styles.button} onClick={() => onCopyPath(activeWorkspace.workspacePath)} type="button">
              复制路径
            </button>
          </div>

          {activeWorkspace.errorMessage ? (
            <div className={styles.error}>{activeWorkspace.errorMessage}</div>
          ) : null}

        </>
      ) : (
        <>
          <p className={styles.placeholder}>当前任务还没有工作区</p>
        </>
      )}

      {historicalWorkspaces.length > 0 ? (
        <details className={styles.history} open>
          <summary>历史工作区 ({historicalWorkspaces.length})</summary>
          <ul className={styles.historyList}>
            {historicalWorkspaces.map((ws) => (
              <li className={styles.historyItem} key={ws.id}>
                <code className={styles.historyBranch}>{ws.branchName}</code>
                <span className={styles.historyStatus} data-color={STATUS_COLOR[ws.status] ?? "gray"}>
                  {STATUS_LABEL[ws.status] ?? ws.status}
                </span>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </DetailDrawer>
  );
}
