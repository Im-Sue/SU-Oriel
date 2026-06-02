import { useMemo } from "react";

import styles from "./SubtaskDetailPanel.module.css";
import { MarkdownBlock } from "./MarkdownBlock.js";
import { splitByH2 } from "./extractSections.js";
import type { BreakdownDraftSubtask } from "../../lib/breakdown-draft-api.js";

interface SubtaskDetailPanelProps {
  subtask: BreakdownDraftSubtask | undefined;
  allSectionIds: string[];
}

function ownerInfo(owner: BreakdownDraftSubtask["implementation_owner"]): { label: string; color: string } {
  if (owner === "claude") return { label: "Claude", color: "purple" };
  if (owner === "ccb_codex") return { label: "Codex", color: "blue" };
  return { label: "Auto", color: "gray" };
}

function priorityChip(priority: BreakdownDraftSubtask["priority"]): { label: string; color: string } {
  if (priority === "high") return { label: "高优先级", color: "red" };
  if (priority === "medium") return { label: "中优先级", color: "amber" };
  return { label: "低优先级", color: "gray" };
}

export function SubtaskDetailPanel({ subtask, allSectionIds }: SubtaskDetailPanelProps) {
  const parsed = useMemo(
    () => splitByH2(subtask?.spec_section_md ?? ""),
    [subtask?.spec_section_md]
  );

  if (!subtask) {
    return <div className={styles.empty}>← 从左侧选择一个 PR</div>;
  }

  const owner = ownerInfo(subtask.implementation_owner);
  const priority = priorityChip(subtask.priority);
  const depTitles = subtask.dependencies
    .map((dep) => {
      const idx = allSectionIds.indexOf(dep);
      return idx >= 0 ? `PR${idx + 1}` : dep;
    });

  return (
    <div className={styles.root}>
      <header className={styles.header}>
        <div className={styles.headerRow}>
          <span className={styles.prTag}>PR{subtask.order}</span>
          <span className={styles.ownerBadge} data-color={owner.color}>
            {owner.label}
          </span>
          <span className={styles.priorityChip} data-color={priority.color}>
            {priority.label}
          </span>
          {!subtask.include ? <span className={styles.cancelledTag}>已取消，不入库</span> : null}
        </div>
        <h1 className={styles.title}>{subtask.title || "（未命名）"}</h1>
        {subtask.summary ? <p className={styles.summary}>{subtask.summary}</p> : null}
        {depTitles.length > 0 ? (
          <div className={styles.depRow}>
            <span className={styles.depLabel}>依赖：</span>
            {depTitles.map((d) => (
              <span className={styles.depTag} key={d}>
                {d}
              </span>
            ))}
          </div>
        ) : null}
        <div className={styles.metaRow}>
          <span className={styles.metaItem}>
            <span className={styles.metaKey}>section_id</span>
            <code className={styles.metaValue}>{subtask.section_id}</code>
          </span>
          <span className={styles.metaItem}>
            <span className={styles.metaKey}>order</span>
            <code className={styles.metaValue}>{subtask.order}</code>
          </span>
        </div>
      </header>

      {parsed.preamble ? (
        <section className={styles.section}>
          <MarkdownBlock source={parsed.preamble} />
        </section>
      ) : null}

      {parsed.sections.map((sec) => (
        <section className={styles.section} key={sec.title}>
          <h2 className={styles.sectionTitle}>
            {sec.emoji ? <span className={styles.sectionEmoji}>{sec.emoji}</span> : null}
            <span>{sec.title}</span>
          </h2>
          <MarkdownBlock source={sec.body} />
        </section>
      ))}

      {parsed.sections.length === 0 && !parsed.preamble ? (
        <section className={styles.section}>
          <div className={styles.placeholder}>该 PR 还没有 spec_section_md。</div>
        </section>
      ) : null}
    </div>
  );
}
