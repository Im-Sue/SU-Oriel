import type { ReactNode } from "react";

import styles from "./TaskSidebar.module.css";

interface TaskSidebarProps {
  children: ReactNode;
}

export function TaskSidebar({ children }: TaskSidebarProps) {
  return (
    <aside aria-label="任务元信息" className={styles.sidebar}>
      <div className={styles.scrollArea}>{children}</div>
    </aside>
  );
}

interface SidebarCardProps {
  title: string;
  icon?: string;
  defaultCollapsed?: boolean;
  collapsible?: boolean;
  badge?: ReactNode;
  children: ReactNode;
}

export function SidebarCard({
  title,
  icon,
  defaultCollapsed = false,
  collapsible = false,
  badge,
  children
}: SidebarCardProps) {
  if (collapsible) {
    return (
      <details className={styles.card} open={!defaultCollapsed}>
        <summary className={styles.cardHeader}>
          <span className={styles.cardTitle}>
            {icon ? <span className={styles.cardIcon} aria-hidden="true">{icon}</span> : null}
            {title}
          </span>
          {badge ? <span className={styles.cardBadge}>{badge}</span> : null}
        </summary>
        <div className={styles.cardBody}>{children}</div>
      </details>
    );
  }

  return (
    <section className={styles.card}>
      <header className={styles.cardHeader}>
        <span className={styles.cardTitle}>
          {icon ? <span className={styles.cardIcon} aria-hidden="true">{icon}</span> : null}
          {title}
        </span>
        {badge ? <span className={styles.cardBadge}>{badge}</span> : null}
      </header>
      <div className={styles.cardBody}>{children}</div>
    </section>
  );
}
