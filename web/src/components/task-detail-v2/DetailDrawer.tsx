import { useEffect, useRef, type ReactNode } from "react";

import styles from "./DetailDrawer.module.css";

interface DetailDrawerProps {
  isOpen: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  width?: number;
}

export function DetailDrawer({ isOpen, title, onClose, children, width = 480 }: DetailDrawerProps) {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    previousFocusRef.current = document.activeElement as HTMLElement | null;
    const initial = dialogRef.current?.querySelector<HTMLElement>("button, [tabindex='0']");
    initial?.focus();

    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key === "Tab" && dialogRef.current) {
        const focusables = dialogRef.current.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
        );
        if (focusables.length === 0) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };

    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("keydown", handleKey);
      previousFocusRef.current?.focus();
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div className={styles.overlay} onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div
        aria-label={title}
        aria-modal="true"
        className={styles.drawer}
        ref={dialogRef}
        role="dialog"
        style={{ maxWidth: `${width}px` }}
        tabIndex={-1}
      >
        <header className={styles.header}>
          <h2 className={styles.title}>{title}</h2>
          <button aria-label="关闭" className={styles.closeButton} onClick={onClose} type="button">
            ✕
          </button>
        </header>
        <div className={styles.body}>{children}</div>
      </div>
    </div>
  );
}
