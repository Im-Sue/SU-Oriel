import { DetailDrawer } from "./DetailDrawer.js";
import styles from "./CheckpointsListDrawer.module.css";
import { useTaskCheckpoints } from "./hooks/useTaskCheckpoints.js";

interface CheckpointsListDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  taskId: string;
  onSelect: (transitionId: string) => void;
}

function relativeTime(iso: string): string {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "未知时间";
  const diff = Math.max(0, Math.floor((Date.now() - t) / 1000));
  if (diff < 60) return `${diff}s 前`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m 前`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h 前`;
  return `${Math.floor(diff / 86400)}d 前`;
}

export function CheckpointsListDrawer({ isOpen, onClose, taskId, onSelect }: CheckpointsListDrawerProps) {
  const { checkpoints, loading, error } = useTaskCheckpoints(isOpen ? taskId : null);
  const safeCheckpoints = Array.isArray(checkpoints) ? checkpoints : [];

  return (
    <DetailDrawer isOpen={isOpen} onClose={onClose} title="检查点">
      {loading && safeCheckpoints.length === 0 ? (
        <p className={styles.placeholder}>加载中…</p>
      ) : error ? (
        <p className={styles.error}>{error}</p>
      ) : safeCheckpoints.length === 0 ? (
        <p className={styles.placeholder}>暂无检查点。每次状态转移完成后会自动写入快照。</p>
      ) : (
        <ul className={styles.list}>
          {safeCheckpoints.map((cp) => (
            <li key={cp.id}>
              <button
                aria-label={`打开 ${cp.transitionId} 的检查点`}
                className={styles.item}
                onClick={() => {
                  onSelect(cp.transitionId);
                  onClose();
                }}
                type="button"
              >
                <div className={styles.itemTop}>
                  <span className={styles.transition}>
                    {cp.nodeBefore ?? "?"} → {cp.nodeAfter ?? "?"}
                  </span>
                  <span className={styles.time}>{relativeTime(cp.createdAt)}</span>
                </div>
                <div className={styles.itemBottom}>
                  <code className={styles.transitionId}>{cp.transitionId}</code>
                  <code className={styles.hash}>hash: {cp.stateHash.slice(0, 8)}</code>
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </DetailDrawer>
  );
}
