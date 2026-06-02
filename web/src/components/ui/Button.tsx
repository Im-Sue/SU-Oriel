import type { ButtonHTMLAttributes, ReactNode } from "react";

import styles from "./Button.module.css";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md";
  loading?: boolean;
  children: ReactNode;
}

export function Button({
  variant = "primary",
  size = "md",
  loading = false,
  className = "",
  children,
  disabled,
  ...rest
}: ButtonProps) {
  return (
    <button
      {...rest}
      className={`${styles.button} ${styles[variant]} ${styles[size]} ${className}`.trim()}
      disabled={disabled || loading}
      type={rest.type ?? "button"}
    >
      {loading ? <span className={styles.spinner}>●</span> : null}
      <span>{children}</span>
    </button>
  );
}
