import { useMemo } from "react";

import styles from "./PlanOverviewPanel.module.css";
import { MarkdownBlock } from "./MarkdownBlock.js";
import { splitByH2 } from "./extractSections.js";
import type { BreakdownDraft, BreakdownDraftSubtask } from "../../lib/breakdown-draft-api.js";

interface PlanOverviewPanelProps {
  plan: BreakdownDraft["plan"];
  subtasks: BreakdownDraftSubtask[];
}

function ownerLabel(owner: BreakdownDraftSubtask["implementation_owner"]): { text: string; color: string } {
  if (owner === "claude") return { text: "Claude", color: "purple" };
  if (owner === "ccb_codex") return { text: "Codex", color: "blue" };
  return { text: "Auto", color: "gray" };
}

export function PlanOverviewPanel({ plan, subtasks }: PlanOverviewPanelProps) {
  const parsed = useMemo(() => splitByH2(plan.spec_outline_md ?? ""), [plan.spec_outline_md]);
  const included = subtasks.filter((s) => s.include);

  return (
    <div className={styles.root}>
      <header className={styles.header}>
        <h1 className={styles.title}>{plan.title || "（未命名技术设计）"}</h1>
        {plan.summary ? <p className={styles.summary}>{plan.summary}</p> : null}
      </header>

      <section className={styles.statCard}>
        <div className={styles.statRow}>
          <div className={styles.statItem}>
            <div className={styles.statNumber}>{included.length}</div>
            <div className={styles.statLabel}>PR 待入库</div>
          </div>
          {included.length !== subtasks.length ? (
            <div className={styles.statItem}>
              <div className={styles.statNumberMuted}>{subtasks.length - included.length}</div>
              <div className={styles.statLabel}>已取消</div>
            </div>
          ) : null}
          {plan.estimated_total_days ? (
            <div className={styles.statItem}>
              <div className={styles.statNumber}>~{plan.estimated_total_days}d</div>
              <div className={styles.statLabel}>预计工期</div>
            </div>
          ) : null}
        </div>

        <div className={styles.depGraph}>
          {included.map((sub) => {
            const owner = ownerLabel(sub.implementation_owner);
            const deps = sub.dependencies.length > 0 ? sub.dependencies : null;
            return (
              <div className={styles.depRow} key={sub.section_id}>
                <span className={styles.depBadge} data-color={owner.color}>
                  PR{sub.order}
                </span>
                <span className={styles.depTitle}>{sub.title || "（未命名）"}</span>
                {deps ? (
                  <span className={styles.depArrow}>
                    ← {deps.map((d) => d.split("-")[0].toUpperCase()).join(", ")}
                  </span>
                ) : null}
              </div>
            );
          })}
        </div>
      </section>

      {parsed.preamble ? (
        <section className={styles.section}>
          <MarkdownBlock source={parsed.preamble} />
        </section>
      ) : null}

      {parsed.sections.map((sec) => {
        const isWarning = sec.emoji === "⚠️";
        return (
          <section
            className={`${styles.section} ${isWarning ? styles.sectionWarning : ""}`.trim()}
            key={sec.title}
          >
            <h2 className={styles.sectionTitle}>
              {sec.emoji ? <span className={styles.sectionEmoji}>{sec.emoji}</span> : null}
              <span>{sec.title}</span>
            </h2>
            <MarkdownBlock source={sec.body} />
          </section>
        );
      })}

      {parsed.sections.length === 0 && !parsed.preamble ? (
        <section className={styles.section}>
          <div className={styles.placeholder}>技术设计还没有详细 spec_outline_md。</div>
        </section>
      ) : null}
    </div>
  );
}
