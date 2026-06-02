import type { ReactNode } from "react";

import { Button } from "./Button.js";
import styles from "./EmptyState.module.css";

interface EmptyStateProps {
  icon: string;
  title: string;
  description: string;
  action?: {
    label: string;
    onClick: () => void;
  };
  extra?: ReactNode;
}

export function EmptyState(props: EmptyStateProps) {
  return (
    <div className={styles.emptyState}>
      <div className={styles.icon}>{props.icon}</div>
      <div className={styles.title}>{props.title}</div>
      <div className={styles.description}>{props.description}</div>
      {props.action ? <Button onClick={props.action.onClick}>{props.action.label}</Button> : null}
      {props.extra}
    </div>
  );
}
