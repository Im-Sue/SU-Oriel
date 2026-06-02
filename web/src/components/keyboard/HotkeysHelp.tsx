/**
 * Phase E3: Hotkeys help modal (Cmd+/ 唤出)
 *
 * 列出全局键盘快捷键。也注册 Cmd+/ 全局监听。
 */

import { useEffect, useState } from "react";

import styles from "./HotkeysHelp.module.css";

interface ShortcutGroup {
  title: string;
  items: { keys: string[]; desc: string }[];
}

const SHORTCUT_GROUPS: ShortcutGroup[] = [
  {
    title: "导航",
    items: [
      { keys: ["⌘", "K"], desc: "打开命令面板" },
      { keys: ["⌘", "/"], desc: "打开本快捷键帮助" },
      { keys: ["g", "o"], desc: "跳到概览" },
      { keys: ["g", "t"], desc: "跳到任务看板" },
      { keys: ["g", "m"], desc: "跳到我的工作" },
      { keys: ["g", "s"], desc: "跳到迭代" },
      { keys: ["g", "r"], desc: "跳到需求管理" },
      { keys: ["g", "l"], desc: "跳到时间线" }
    ]
  },
  {
    title: "任务列表",
    items: [
      { keys: ["j"], desc: "向下选中" },
      { keys: ["k"], desc: "向上选中" },
      { keys: ["Enter"], desc: "打开选中" },
      { keys: ["x"], desc: "切换勾选" }
    ]
  },
  {
    title: "通用",
    items: [
      { keys: ["Esc"], desc: "关闭弹层 / 取消" },
      { keys: ["?"], desc: "唤出本帮助（同 Cmd+/）" }
    ]
  }
];

export function HotkeysHelp() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      // Cmd+/ 或 Ctrl+/ 或 ? 单键
      if ((event.ctrlKey || event.metaKey) && event.key === "/") {
        event.preventDefault();
        setOpen((v) => !v);
        return;
      }
      if (event.key === "?" && !event.ctrlKey && !event.metaKey && !event.altKey) {
        const target = event.target as HTMLElement | null;
        const tag = target?.tagName?.toLowerCase();
        if (tag === "input" || tag === "textarea" || target?.isContentEditable) return;
        event.preventDefault();
        setOpen((v) => !v);
        return;
      }
      if (event.key === "Escape" && open) {
        event.preventDefault();
        setOpen(false);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open]);

  if (!open) return null;

  return (
    <div className={styles.backdrop} onMouseDown={(e) => e.target === e.currentTarget && setOpen(false)}>
      <div aria-label="键盘快捷键帮助" aria-modal="true" className={styles.modal} role="dialog">
        <header className={styles.header}>
          <h2 className={styles.title}>⌨ 键盘快捷键</h2>
          <button aria-label="关闭" className={styles.closeBtn} onClick={() => setOpen(false)} type="button">✕</button>
        </header>
        <div className={styles.body}>
          {SHORTCUT_GROUPS.map((group) => (
            <section className={styles.group} key={group.title}>
              <h3 className={styles.groupTitle}>{group.title}</h3>
              <ul className={styles.list}>
                {group.items.map((item, i) => (
                  <li className={styles.item} key={i}>
                    <span className={styles.itemDesc}>{item.desc}</span>
                    <span className={styles.itemKeys}>
                      {item.keys.map((k, j) => (
                        <kbd className={styles.kbd} key={j}>{k}</kbd>
                      ))}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
