import { useMemo, useState } from "react";

import styles from "./UnstartedRequirementStrip.module.css";
import type { RequirementView } from "../../types/requirement.js";

interface UnstartedRequirementStripProps {
  requirements: RequirementView[];
  onRequirementSelect: (requirementId: string) => void;
}

export function UnstartedRequirementStrip({ requirements, onRequirementSelect }: UnstartedRequirementStripProps) {
  const [expanded, setExpanded] = useState(false);

  const drafts = useMemo(
    () => requirements.filter((r) => ["drafting", "planning", "draft"].includes((r.status ?? "").toLowerCase())),
    [requirements]
  );

  if (drafts.length === 0) return null;

  return (
    <section aria-label="计划中需求" className={styles.strip}>
      <button
        aria-expanded={expanded}
        className={styles.header}
        onClick={() => setExpanded((v) => !v)}
        type="button"
      >
        <span className={styles.expandIcon}>{expanded ? "▾" : "▸"}</span>
        <h3 className={styles.title}>
          📋 计划中需求 <span className={styles.hint}>（从需求详情页继续分析 / 设计 / 拆分）</span>
        </h3>
        <span className={styles.count}>{drafts.length} 个</span>
      </button>
      {expanded ? (
        <ul className={styles.list}>
          {drafts.map((req) => (
            <li className={styles.item} key={req.id}>
              <span className={styles.itemIcon} title="计划中需求">
                📋
              </span>
              <button
                aria-label={`打开需求 ${req.title}`}
                className={styles.itemTitleButton}
                onClick={() => onRequirementSelect(req.id)}
                type="button"
              >
                {req.title}
              </button>
              <button
                aria-label={`继续需求: ${req.title}`}
                className={styles.actionButton}
                onClick={() => onRequirementSelect(req.id)}
                type="button"
              >
                继续 →
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
