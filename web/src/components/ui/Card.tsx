import type { HTMLAttributes, ReactNode } from "react";

import styles from "./Card.module.css";

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  selected?: boolean;
  children: ReactNode;
}

export function Card({ selected = false, children, className = "", ...rest }: CardProps) {
  return (
    <div {...rest} className={`${styles.card} ${className}`.trim()} data-selected={String(selected)}>
      {children}
    </div>
  );
}
