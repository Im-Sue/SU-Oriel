import styles from "./SubtaskListPanel.module.css";
import type { BreakdownDraftSubtask } from "../../lib/breakdown-draft-api.js";

interface SubtaskListPanelProps {
  subtasks: BreakdownDraftSubtask[];
  selectedIndex: number;
  onSelect: (index: number) => void;
}

function priorityChip(priority: BreakdownDraftSubtask["priority"]): { label: string; color: string } {
  if (priority === "high") return { label: "高", color: "red" };
  if (priority === "medium") return { label: "中", color: "amber" };
  return { label: "低", color: "gray" };
}

function ownerInfo(owner: BreakdownDraftSubtask["implementation_owner"]): { label: string; color: string } {
  if (owner === "claude") return { label: "Claude", color: "purple" };
  if (owner === "ccb_codex") return { label: "Codex", color: "blue" };
  return { label: "Auto", color: "gray" };
}

function derivedRole(title: string): string | null {
  const lower = title.toLowerCase();
  if (/backend|后端|api|server/.test(lower)) return "Backend";
  if (/frontend|前端|ui|web/.test(lower)) return "Frontend";
  if (/reanalyze|重新解析|reparse/.test(lower)) return "Reanalyze";
  if (/migration|migrate/.test(lower)) return "Migration";
  if (/refactor|重构/.test(lower)) return "Refactor";
  if (/test|测试/.test(lower)) return "Tests";
  if (/doc|docs|文档/.test(lower)) return "Docs";
  return null;
}

export function SubtaskListPanel({ subtasks, selectedIndex, onSelect }: SubtaskListPanelProps) {
  return (
    <div className={styles.root}>
      <div className={styles.header}>
        <div className={styles.title}>拆分（{subtasks.length} 个 PR）</div>
        <div className={styles.subtitle}>
          {subtasks.filter((s) => s.include).length} 个待入库
        </div>
      </div>

      <ul className={styles.list}>
        {subtasks.map((sub, idx) => {
          const owner = ownerInfo(sub.implementation_owner);
          const priority = priorityChip(sub.priority);
          const role = derivedRole(sub.title);
          const selected = idx === selectedIndex;
          const dimmed = !sub.include;

          return (
            <li key={sub.section_id}>
              <button
                type="button"
                className={styles.card}
                data-selected={selected}
                data-dimmed={dimmed}
                onClick={() => onSelect(idx)}
                aria-label={`选中 PR${sub.order} ${sub.title}`}
              >
                <div className={styles.cardHead}>
                  <span className={styles.prTag}>PR{sub.order}</span>
                  {role ? <span className={styles.roleTag}>{role}</span> : null}
                  {dimmed ? <span className={styles.cancelledTag}>已取消</span> : null}
                </div>
                <div className={styles.cardTitle}>{sub.title || "（未命名）"}</div>
                {sub.summary ? (
                  <div className={styles.cardSummary}>{sub.summary}</div>
                ) : null}
                <div className={styles.cardFoot}>
                  <span className={styles.ownerBadge} data-color={owner.color}>
                    {owner.label}
                  </span>
                  <span className={styles.priorityChip} data-color={priority.color}>
                    {priority.label}优
                  </span>
                  {sub.dependencies.length > 0 ? (
                    <span className={styles.depHint}>
                      ← {sub.dependencies.map((d) => d.split("-")[0].toUpperCase()).join(", ")}
                    </span>
                  ) : null}
                </div>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
