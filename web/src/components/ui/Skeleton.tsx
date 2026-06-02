import styles from "./Skeleton.module.css";

interface SkeletonProps {
  className?: string;
}

export function SkeletonLine(props: SkeletonProps) {
  return <div className={`${styles.skeleton} ${styles.line} ${props.className ?? ""}`.trim()} />;
}

export function SkeletonCard(props: SkeletonProps) {
  return <div className={`${styles.skeleton} ${styles.card} ${props.className ?? ""}`.trim()} />;
}

export function SkeletonStat(props: SkeletonProps) {
  return <div className={`${styles.skeleton} ${styles.stat} ${props.className ?? ""}`.trim()} />;
}
