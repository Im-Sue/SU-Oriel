import type { ReactNode } from "react";

import styles from "./Badge.module.css";
import type { BadgeColor } from "../../lib/ui-mapping.js";

interface BadgeProps {
  label: ReactNode;
  color: BadgeColor;
}

export function Badge(props: BadgeProps) {
  return <span className={`${styles.badge} ${styles[props.color]}`}>{props.label}</span>;
}
