import { useEffect, useRef } from "react";

import { useTaskCheckpoint } from "./hooks/useTaskCheckpoints.js";
import styles from "./CheckpointDrawer.module.css";

interface CheckpointDrawerProps {
  taskId: string;
  transitionId: string;
  isOpen: boolean;
  onClose: () => void;
}

export function CheckpointDrawer({ taskId, transitionId, isOpen, onClose }: CheckpointDrawerProps) {
  const { checkpoint, loading, error, refetch } = useTaskCheckpoint(isOpen ? taskId : null, isOpen ? transitionId : null);
  const pending = checkpoint?.snapshotPath?.startsWith("pending:") && !checkpoint.snapshot;
  const dialogRef = useRef<HTMLElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (!isOpen) return undefined;
    returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeButtonRef.current?.focus();
    return () => {
      returnFocusRef.current?.focus();
      returnFocusRef.current = null;
    };
  }, [isOpen]);
  useEffect(() => {
    if (!isOpen) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>("button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])") ?? []);
      if (focusable.length === 0) {
        event.preventDefault();
        dialogRef.current?.focus();
        return;
      }
      const currentIndex = focusable.indexOf(document.activeElement as HTMLElement);
      const nextIndex = event.shiftKey
        ? currentIndex <= 0 ? focusable.length - 1 : currentIndex - 1
        : currentIndex === focusable.length - 1 ? 0 : currentIndex + 1;
      event.preventDefault();
      focusable[nextIndex].focus();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isOpen, onClose]);
  useEffect(() => {
    if (!pending) return undefined;
    const timer = window.setTimeout(() => void refetch(), 30000);
    return () => window.clearTimeout(timer);
  }, [pending, refetch]);
  if (!isOpen) return null;
  return (
    <div className={styles.backdrop} data-testid="checkpoint-drawer-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <aside aria-label="检查点详情" aria-modal="true" className={styles.drawer} ref={dialogRef} role="dialog" tabIndex={-1}>
        <header className={styles.header}>
          <div>
            <h2>{checkpoint?.transitionId ?? transitionId}</h2>
            {checkpoint ? <p>{checkpoint.nodeBefore ?? "未知"} {"→"} {checkpoint.nodeAfter ?? "未知"} · 版本 {checkpoint.stateRevisionAfter} · <span>{checkpoint.stateHash.slice(0, 8)}</span></p> : <p>加载检查点中…</p>}
          </div>
          <button aria-label="关闭" className={styles.close} onClick={onClose} ref={closeButtonRef} type="button">×</button>
        </header>
        <section className={styles.body}>
          {loading ? <p>加载检查点中…</p> : null}
          {error ? <p>{error}</p> : null}
          {!loading && !error && checkpoint?.snapshot ? <pre className={styles.json}><code>{JSON.stringify(checkpoint.snapshot, null, 2)}</code></pre> : null}
          {!loading && !error && pending ? <p>快照异步落盘中，30 秒后自动重试。</p> : null}
          {!loading && !error && checkpoint?.snapshotPath && !pending && !checkpoint.snapshot ? <p>快照在文件系统中，暂不支持预览：<span>{checkpoint.snapshotPath}</span></p> : null}
          {!loading && !error && !checkpoint ? <p>未找到检查点。</p> : null}
        </section>
      </aside>
    </div>
  );
}
