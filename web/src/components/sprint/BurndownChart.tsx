/**
 * Phase C-C3: 燃尽图组件 (TAPD-inspired)
 *
 * SVG 简单线图：实际剩余 vs 理想 burndown line。
 * 不引入 chart 库依赖，用原生 SVG。
 */

import { useMemo } from "react";

import styles from "./BurndownChart.module.css";
import type { BurndownPointView } from "../../types/sprint.js";

interface BurndownChartProps {
  points: BurndownPointView[];
  height?: number;
}

const PADDING = { top: 16, right: 24, bottom: 28, left: 36 };

export function BurndownChart({ points, height = 220 }: BurndownChartProps) {
  const width = 600;
  const innerW = width - PADDING.left - PADDING.right;
  const innerH = height - PADDING.top - PADDING.bottom;

  const { actualPath, idealPath, maxY, ticks } = useMemo(() => {
    if (points.length < 2) {
      return { actualPath: "", idealPath: "", maxY: 1, ticks: [] as number[] };
    }
    const total = points[0].totalPoints || 1;
    const stepX = innerW / (points.length - 1);
    const yScale = (v: number) => innerH - (v / total) * innerH;

    const actualPath = points
      .map((p, i) => `${i === 0 ? "M" : "L"} ${PADDING.left + i * stepX} ${PADDING.top + yScale(p.remainingPoints)}`)
      .join(" ");
    // ideal: 直线从 (0, total) 到 (last, 0)
    const idealPath = `M ${PADDING.left} ${PADDING.top + yScale(total)} L ${PADDING.left + innerW} ${PADDING.top + yScale(0)}`;

    const ticks = [0, Math.round(total / 2), total];
    return { actualPath, idealPath, maxY: total, ticks };
  }, [points, innerH, innerW]);

  if (points.length < 2) {
    return <p className={styles.placeholder}>燃尽数据不足（至少需要 2 个时间点）</p>;
  }

  const stepX = innerW / (points.length - 1);

  return (
    <div className={styles.wrap}>
      <svg aria-label="燃尽图" className={styles.svg} viewBox={`0 0 ${width} ${height}`}>
        {/* y-axis ticks */}
        {ticks.map((t) => {
          const y = PADDING.top + (innerH - (t / maxY) * innerH);
          return (
            <g key={t}>
              <line className={styles.gridLine} x1={PADDING.left} x2={PADDING.left + innerW} y1={y} y2={y} />
              <text className={styles.axisLabel} dominantBaseline="middle" textAnchor="end" x={PADDING.left - 6} y={y}>
                {t}
              </text>
            </g>
          );
        })}

        {/* x-axis labels (start/middle/end) */}
        {[0, Math.floor(points.length / 2), points.length - 1].map((i) => {
          const x = PADDING.left + i * stepX;
          return (
            <text className={styles.axisLabel} key={i} textAnchor="middle" x={x} y={height - 8}>
              {points[i].date.slice(5)}
            </text>
          );
        })}

        {/* ideal line */}
        <path className={styles.idealLine} d={idealPath} />

        {/* actual line */}
        <path className={styles.actualLine} d={actualPath} />

        {/* dots on actual line */}
        {points.map((p, i) => {
          const cx = PADDING.left + i * stepX;
          const cy = PADDING.top + (innerH - (p.remainingPoints / maxY) * innerH);
          return <circle className={styles.dot} cx={cx} cy={cy} key={i} r={3} />;
        })}
      </svg>

      <div className={styles.legend}>
        <span className={styles.legendItem}>
          <span className={styles.legendSwatchIdeal} /> 理想线
        </span>
        <span className={styles.legendItem}>
          <span className={styles.legendSwatchActual} /> 实际剩余
        </span>
      </div>
    </div>
  );
}
