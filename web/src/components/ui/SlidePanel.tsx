import { useEffect } from "react";
import type { ReactNode } from "react";

import styles from "./SlidePanel.module.css";

interface SlidePanelProps {
  open: boolean;
  title: string;
  children: ReactNode;
  onClose: () => void;
}

export function SlidePanel(props: SlidePanelProps) {
  useEffect(() => {
    if (!props.open) {
      return;
    }

    // 详情面板的开关由路由控制，ESC 只触发外部关闭回调。
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        props.onClose();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [props.onClose, props.open]);

  if (!props.open) {
    return null;
  }

  return (
    <aside aria-label={props.title} className={styles.panel} data-open="true" role="dialog">
      <div className={styles.header}>
        <div>{props.title}</div>
        <button className={styles.closeButton} onClick={props.onClose} type="button">
          ×
        </button>
      </div>
      <div className={styles.content}>{props.children}</div>
    </aside>
  );
}
