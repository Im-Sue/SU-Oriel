import { Card } from "../ui/Card.js";
import styles from "./MetricCard.module.css";

type ComponentSize = "sm" | "md" | "lg";
type ComponentTone = "default" | "success" | "warn" | "danger";

export interface MetricCardTrend {
  delta: number;
  direction: "up" | "down";
}

export interface MetricCardProps {
  label: string;
  value: number | string;
  tone?: ComponentTone;
  size?: ComponentSize;
  subStatus?: string;
  trend?: MetricCardTrend;
}

export function MetricCard({ label, value, tone = "default", size = "md", subStatus, trend }: MetricCardProps) {
  return (
    <Card className={`${styles.card} ${styles[size]} ${styles[tone]}`} data-testid="metric-card" data-tone={tone}>
      <div className={styles.header}>
        <p className={styles.label}>{label}</p>
        {trend ? (
          <span className={`${styles.trend} ${styles[trend.direction]}`} data-testid="metric-trend">
            {trend.delta > 0 ? "+" : ""}
            {trend.delta}
          </span>
        ) : null}
      </div>
      <p className={styles.value}>{value}</p>
      {subStatus ? <p className={styles.subStatus}>{subStatus}</p> : null}
    </Card>
  );
}
