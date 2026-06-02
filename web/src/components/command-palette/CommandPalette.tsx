import { useEffect, useMemo, useRef, useState } from "react";

import styles from "./CommandPalette.module.css";

export interface CommandPaletteItem {
  id: string;
  label: string;
  hint: string;
  keywords?: string[];
  disabled?: boolean;
  run: () => void | Promise<void>;
}

interface CommandPaletteProps {
  commands: CommandPaletteItem[];
}

export function CommandPalette(props: CommandPaletteProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const visibleCommands = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) {
      return props.commands;
    }

    return props.commands.filter((command) => {
      const searchable = [command.label, command.hint, ...(command.keywords ?? [])].join(" ").toLowerCase();
      return fuzzyIncludes(searchable, normalizedQuery);
    });
  }, [props.commands, query]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen(true);
        return;
      }

      if (!open) {
        return;
      }

      if (event.key === "Escape") {
        event.preventDefault();
        closePalette();
        return;
      }

      if (event.key === "ArrowDown") {
        event.preventDefault();
        setActiveIndex((value) => Math.min(value + 1, Math.max(visibleCommands.length - 1, 0)));
        return;
      }

      if (event.key === "ArrowUp") {
        event.preventDefault();
        setActiveIndex((value) => Math.max(value - 1, 0));
        return;
      }

      if (event.key === "Enter") {
        event.preventDefault();
        void executeCommand(visibleCommands[activeIndex]);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [activeIndex, open, visibleCommands]);

  useEffect(() => {
    if (!open) {
      return;
    }

    setActiveIndex(0);
    window.setTimeout(() => inputRef.current?.focus(), 0);
  }, [open]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  const closePalette = () => {
    setOpen(false);
    setQuery("");
    setActiveIndex(0);
  };

  const executeCommand = async (command: CommandPaletteItem | undefined) => {
    if (!command || command.disabled) {
      return;
    }

    closePalette();
    await command.run();
  };

  if (!open) {
    return null;
  }

  return (
    <div className={styles.overlay} onClick={closePalette} role="presentation">
      <div
        aria-label="命令面板"
        aria-modal="true"
        className={styles.panel}
        onClick={(event) => event.stopPropagation()}
        role="dialog"
      >
        <div className={styles.inputWrap}>
          <label className={styles.inputLabel} htmlFor="command-palette-search">
            搜索命令
          </label>
          <input
            aria-activedescendant={visibleCommands[activeIndex]?.id}
            aria-controls="command-palette-list"
            aria-label="搜索命令"
            className={styles.input}
            id="command-palette-search"
            onChange={(event) => setQuery(event.target.value)}
            placeholder="输入页面或动作名称..."
            ref={inputRef}
            role="combobox"
            value={query}
          />
          <span className={styles.shortcut}>Ctrl K</span>
        </div>

        <div className={styles.list} id="command-palette-list" role="listbox">
          {visibleCommands.length === 0 ? <div className={styles.empty}>没有匹配命令</div> : null}
          {visibleCommands.map((command, index) => (
            <button
              aria-selected={index === activeIndex}
              className={styles.item}
              data-active={String(index === activeIndex)}
              disabled={command.disabled}
              id={command.id}
              key={command.id}
              onMouseEnter={() => setActiveIndex(index)}
              onClick={() => void executeCommand(command)}
              role="option"
              type="button"
            >
              <span className={styles.itemMain}>
                <span className={styles.itemLabel}>{command.label}</span>
                <span className={styles.itemHint}>{command.hint}</span>
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function fuzzyIncludes(value: string, query: string): boolean {
  let cursor = 0;
  for (const char of query) {
    cursor = value.indexOf(char, cursor);
    if (cursor === -1) {
      return false;
    }
    cursor += 1;
  }
  return true;
}
