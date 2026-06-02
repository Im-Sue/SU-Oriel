/**
 * Phase A4: Tasks Filter Bar + Saved Views
 *
 * 维度：priority (urgent/high/medium/low) / kind (epic/subtask) / hasAttention
 * URL：?filter=priority:high|urgent;kind:subtask
 * Saved Views：localStorage 存 (name → filter object)
 */

import { useEffect, useState } from "react";

import styles from "./TasksFilterBar.module.css";

const SAVED_VIEWS_KEY = "ccb-console:tasks-saved-views";

export interface TaskFilter {
  priority: Set<string>; // urgent / high / medium / low
  kind: Set<string>; // epic / subtask
  hasAttention: boolean;
}

export interface SavedView {
  name: string;
  filter: { priority: string[]; kind: string[]; hasAttention: boolean };
}

const PRIORITY_OPTIONS = [
  { value: "urgent", label: "紧急", color: "red" },
  { value: "high", label: "高", color: "orange" },
  { value: "medium", label: "中", color: "blue" },
  { value: "low", label: "低", color: "gray" }
];

const KIND_OPTIONS = [
  { value: "epic", label: "Epic", color: "purple" },
  { value: "subtask", label: "子任务", color: "gray" }
];

export function emptyFilter(): TaskFilter {
  return { priority: new Set(), kind: new Set(), hasAttention: false };
}

export function isFilterActive(filter: TaskFilter): boolean {
  return filter.priority.size > 0 || filter.kind.size > 0 || filter.hasAttention;
}

export function serializeFilter(filter: TaskFilter): string {
  const parts: string[] = [];
  if (filter.priority.size > 0) parts.push(`priority:${[...filter.priority].join("|")}`);
  if (filter.kind.size > 0) parts.push(`kind:${[...filter.kind].join("|")}`);
  if (filter.hasAttention) parts.push("attention:1");
  return parts.join(";");
}

export function parseFilter(raw: string | null): TaskFilter {
  const filter = emptyFilter();
  if (!raw) return filter;
  for (const part of raw.split(";")) {
    const [key, value] = part.split(":");
    if (!key || !value) continue;
    if (key === "priority") value.split("|").forEach((v) => filter.priority.add(v));
    else if (key === "kind") value.split("|").forEach((v) => filter.kind.add(v));
    else if (key === "attention" && value === "1") filter.hasAttention = true;
  }
  return filter;
}

function loadSavedViews(): SavedView[] {
  try {
    const raw = localStorage.getItem(SAVED_VIEWS_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as SavedView[];
  } catch {
    return [];
  }
}

function saveSavedViews(views: SavedView[]) {
  try {
    localStorage.setItem(SAVED_VIEWS_KEY, JSON.stringify(views));
  } catch {
    // ignore
  }
}

interface TasksFilterBarProps {
  filter: TaskFilter;
  onFilterChange: (filter: TaskFilter) => void;
}

export function TasksFilterBar({ filter, onFilterChange }: TasksFilterBarProps) {
  const [savedViews, setSavedViews] = useState<SavedView[]>(() => loadSavedViews());
  const [savePopOpen, setSavePopOpen] = useState(false);
  const [newViewName, setNewViewName] = useState("");

  useEffect(() => {
    saveSavedViews(savedViews);
  }, [savedViews]);

  const togglePriority = (value: string) => {
    const next = new Set(filter.priority);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    onFilterChange({ ...filter, priority: next });
  };

  const toggleKind = (value: string) => {
    const next = new Set(filter.kind);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    onFilterChange({ ...filter, kind: next });
  };

  const clearAll = () => onFilterChange(emptyFilter());

  const applyView = (view: SavedView) => {
    onFilterChange({
      priority: new Set(view.filter.priority),
      kind: new Set(view.filter.kind),
      hasAttention: view.filter.hasAttention
    });
  };

  const saveCurrent = () => {
    const name = newViewName.trim();
    if (!name) return;
    const next: SavedView = {
      name,
      filter: {
        priority: [...filter.priority],
        kind: [...filter.kind],
        hasAttention: filter.hasAttention
      }
    };
    setSavedViews((prev) => [...prev.filter((v) => v.name !== name), next]);
    setNewViewName("");
    setSavePopOpen(false);
  };

  const deleteView = (name: string) => {
    setSavedViews((prev) => prev.filter((v) => v.name !== name));
  };

  const active = isFilterActive(filter);

  return (
    <div aria-label="任务筛选" className={styles.bar}>
      <div className={styles.group}>
        <span className={styles.groupLabel}>优先级:</span>
        {PRIORITY_OPTIONS.map((opt) => (
          <button
            aria-pressed={filter.priority.has(opt.value)}
            className={styles.chip}
            data-active={filter.priority.has(opt.value)}
            data-color={opt.color}
            key={opt.value}
            onClick={() => togglePriority(opt.value)}
            type="button"
          >
            {opt.label}
          </button>
        ))}
      </div>

      <div className={styles.group}>
        <span className={styles.groupLabel}>类型:</span>
        {KIND_OPTIONS.map((opt) => (
          <button
            aria-pressed={filter.kind.has(opt.value)}
            className={styles.chip}
            data-active={filter.kind.has(opt.value)}
            data-color={opt.color}
            key={opt.value}
            onClick={() => toggleKind(opt.value)}
            type="button"
          >
            {opt.label}
          </button>
        ))}
      </div>

      <button
        aria-pressed={filter.hasAttention}
        className={styles.attentionBtn}
        data-active={filter.hasAttention}
        onClick={() => onFilterChange({ ...filter, hasAttention: !filter.hasAttention })}
        type="button"
      >
        🔔 仅看需要处理
      </button>

      <div className={styles.spacer} />

      {savedViews.length > 0 ? (
        <select
          aria-label="加载已保存视图"
          className={styles.savedViewSelect}
          onChange={(e) => {
            const view = savedViews.find((v) => v.name === e.target.value);
            if (view) applyView(view);
          }}
          value=""
        >
          <option value="">已保存视图...</option>
          {savedViews.map((v) => (
            <option key={v.name} value={v.name}>
              {v.name}
            </option>
          ))}
        </select>
      ) : null}

      {active ? (
        <>
          <button
            aria-label="保存当前筛选为视图"
            className={styles.saveBtn}
            onClick={() => setSavePopOpen((v) => !v)}
            type="button"
          >
            💾 保存视图
          </button>
          <button aria-label="清除筛选" className={styles.clearBtn} onClick={clearAll} type="button">
            ✕ 清除
          </button>
        </>
      ) : null}

      {savePopOpen ? (
        <div className={styles.savePop}>
          <input
            aria-label="视图名称"
            className={styles.savePopInput}
            onChange={(e) => setNewViewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") saveCurrent();
              if (e.key === "Escape") setSavePopOpen(false);
            }}
            placeholder="视图名称（如：紧急 + epic）"
            value={newViewName}
            autoFocus
          />
          <button className={styles.savePopBtn} onClick={saveCurrent} type="button">保存</button>
          {savedViews.length > 0 ? (
            <details className={styles.savePopManage}>
              <summary>管理已保存</summary>
              <ul className={styles.savePopList}>
                {savedViews.map((v) => (
                  <li className={styles.savePopItem} key={v.name}>
                    <span>{v.name}</span>
                    <button
                      aria-label={`删除视图 ${v.name}`}
                      className={styles.savePopDelete}
                      onClick={() => deleteView(v.name)}
                      type="button"
                    >
                      ✕
                    </button>
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export function applyTaskFilter<T extends { priority: string; kind?: string; status?: string; runtimeState?: string | null; blockedReason?: string | null; reviewStatus?: string | null }>(
  tasks: T[],
  filter: TaskFilter
): T[] {
  return tasks.filter((task) => {
    if (filter.priority.size > 0 && !filter.priority.has(task.priority)) return false;
    if (filter.kind.size > 0 && !filter.kind.has(task.kind ?? "subtask")) return false;
    if (filter.hasAttention) {
      const runtime = task.runtimeState?.toLowerCase();
      const review = task.reviewStatus?.toLowerCase();
      const isAttention =
        runtime === "blocked" ||
        runtime === "failed" ||
        Boolean(task.blockedReason?.trim()) ||
        review === "needs_followup" ||
        review === "design_conflict";
      if (!isAttention) return false;
    }
    return true;
  });
}
