import { useEffect, useRef, useState } from "react";

import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import "@xterm/xterm/css/xterm.css";

import { createPtyClient, type PtyClient, type PtyClientStatus } from "../../lib/ai-cli-ws.js";
import styles from "./EmbeddedTerminal.module.css";

interface EmbeddedTerminalProps {
  sessionId: string;
  title: string;
  active: boolean;
  onExit?: (code: number, signal: string | null) => void;
  onClose?: () => void;
  onError?: (code: string, message: string) => void;
}

const STATUS_LABEL: Record<PtyClientStatus, string> = {
  connecting: "连接中",
  open: "已连接",
  reconnecting: "重连中",
  closed: "已关闭",
  error: "异常"
};

export function EmbeddedTerminal(props: EmbeddedTerminalProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const ptyRef = useRef<PtyClient | null>(null);
  const lastDimRef = useRef<{ cols: number; rows: number }>({ cols: 100, rows: 30 });
  const [status, setStatus] = useState<PtyClientStatus>("connecting");
  const [exitInfo, setExitInfo] = useState<{ code: number; signal: string | null } | null>(null);
  const [epoch, setEpoch] = useState(0);

  useEffect(() => {
    if (!containerRef.current) {
      return;
    }

    setStatus("connecting");
    setExitInfo(null);

    const term = new Terminal({
      fontSize: 13,
      fontFamily: "'JetBrains Mono', 'Cascadia Code', 'Consolas', 'Menlo', monospace",
      cursorBlink: true,
      scrollback: 5000,
      allowProposedApi: true,
      theme: {
        background: "#0b1020",
        foreground: "#e2e8f0",
        cursor: "#22c55e",
        black: "#1f2937",
        red: "#f87171",
        green: "#4ade80",
        yellow: "#facc15",
        blue: "#60a5fa",
        magenta: "#c084fc",
        cyan: "#22d3ee",
        white: "#e5e7eb",
        brightBlack: "#475569",
        brightRed: "#fca5a5",
        brightGreen: "#86efac",
        brightYellow: "#fde047",
        brightBlue: "#93c5fd",
        brightMagenta: "#d8b4fe",
        brightCyan: "#67e8f9",
        brightWhite: "#f8fafc"
      }
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.loadAddon(new WebLinksAddon());
    const unicode = new Unicode11Addon();
    term.loadAddon(unicode);
    term.unicode.activeVersion = "11";

    term.open(containerRef.current);
    try {
      fitAddon.fit();
    } catch {
      // 容器尺寸 0 时 fit 会抛错，忽略
    }
    const initialDim = { cols: term.cols, rows: term.rows };
    lastDimRef.current = initialDim;

    const client = createPtyClient(props.sessionId, {
      onStatusChange: (next) => setStatus(next),
      onOutput: (data) => term.write(data),
      onReady: () => {
        client.sendResize(initialDim.cols, initialDim.rows);
      },
      onExit: (code, signal) => {
        setExitInfo({ code, signal });
        props.onExit?.(code, signal);
        term.write(`\r\n\x1b[90m[进程已退出 code=${code}${signal ? ` signal=${signal}` : ""}]\x1b[0m\r\n`);
      },
      onError: (code, message) => {
        props.onError?.(code, message);
        term.write(`\r\n\x1b[31m[${code}] ${message}\x1b[0m\r\n`);
      }
    });

    term.onData((data) => client.sendInput(data));

    let rafId = 0;
    const resize = () => {
      if (!fitAddon || !term) {
        return;
      }
      try {
        fitAddon.fit();
      } catch {
        return;
      }
      const cols = term.cols;
      const rows = term.rows;
      if (cols === lastDimRef.current.cols && rows === lastDimRef.current.rows) {
        return;
      }
      lastDimRef.current = { cols, rows };
      client.sendResize(cols, rows);
    };

    // rAF 节流：避免 ResizeObserver 在 fit() 引发的微小尺寸抖动里被反复触发。
    // 配合 css 层的 min-height:0 / overflow:hidden，彻底封住「内容撑大父级」的反馈循环。
    const observer = new ResizeObserver(() => {
      if (rafId) {
        return;
      }
      rafId = requestAnimationFrame(() => {
        rafId = 0;
        resize();
      });
    });
    observer.observe(containerRef.current);

    terminalRef.current = term;
    fitAddonRef.current = fitAddon;
    ptyRef.current = client;

    return () => {
      if (rafId) {
        cancelAnimationFrame(rafId);
        rafId = 0;
      }
      observer.disconnect();
      client.close();
      term.dispose();
      terminalRef.current = null;
      fitAddonRef.current = null;
      ptyRef.current = null;
    };
    // 仅在 sessionId 或 epoch（手动重连）变化时重建
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.sessionId, epoch]);

  useEffect(() => {
    if (!props.active) {
      return;
    }
    // 切回 tab / 切换布局后重新 fit，避免隐藏期间尺寸错位
    requestAnimationFrame(() => {
      try {
        fitAddonRef.current?.fit();
        if (terminalRef.current && ptyRef.current) {
          ptyRef.current.sendResize(terminalRef.current.cols, terminalRef.current.rows);
        }
      } catch {
        // ignore
      }
    });
  }, [props.active]);

  const handleClose = () => {
    ptyRef.current?.requestClose();
    props.onClose?.();
  };

  const handleReconnect = () => {
    // 真正的重建：bumpup epoch，让 useEffect 走一遍清理 + 重新 createPtyClient
    setEpoch((value) => value + 1);
  };

  return (
    <div className={styles.wrapper}>
      <div className={styles.statusBar}>
        <div className={styles.statusLeft}>
          <span className={styles.statusDot} data-status={status} />
          <span>
            {props.title} · {STATUS_LABEL[status]}
            {exitInfo ? ` · code=${exitInfo.code}` : ""}
          </span>
        </div>
        <div className={styles.statusActions}>
          {status === "closed" || status === "error" || status === "reconnecting" ? (
            <button className={styles.statusButton} onClick={handleReconnect} type="button">
              重连
            </button>
          ) : null}
          <button className={styles.statusButton} onClick={handleClose} type="button">
            关闭会话
          </button>
        </div>
      </div>
      <div className={styles.terminalHost} ref={containerRef} />
    </div>
  );
}
