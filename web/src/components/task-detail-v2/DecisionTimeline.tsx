import { useEffect, useState } from "react";

import styles from "./DecisionTimeline.module.css";
import { Button } from "../ui/Button.js";
import {
  fetchTaskTimeline,
  type TaskTimelineEvent,
  type TaskTimelineResult
} from "../../lib/timeline-api.js";

interface DecisionTimelineProps {
  taskId: string;
}

const POLL_INTERVAL_MS = 8000;

function severityLabel(severity: TaskTimelineEvent["severity"]): string {
  switch (severity) {
    case "attention":
      return "⚠";
    case "warning":
      return "✦";
    default:
      return "•";
  }
}

function formatAt(iso: string): string {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

function PayloadView(props: { payload: Record<string, unknown> }) {
  const entries = Object.entries(props.payload).filter(
    ([, value]) => value !== null && value !== undefined && value !== ""
  );
  if (entries.length === 0) return null;
  return (
    <pre className={styles.payload}>
      {entries
        .map(([k, v]) => `${k}: ${typeof v === "string" ? v : JSON.stringify(v)}`)
        .join("\n")}
    </pre>
  );
}

export function DecisionTimeline(props: DecisionTimelineProps) {
  const [data, setData] = useState<TaskTimelineResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const events = data?.events ?? [];

  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        const result = await fetchTaskTimeline(props.taskId);
        if (!cancelled) {
          setData(result);
          setError(null);
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "时间线加载失败");
        }
      }
    };
    void tick();
    const handle = setInterval(() => void tick(), POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(handle);
    };
  }, [props.taskId]);

  return (
    <div className={styles.timeline}>
      <div className={styles.header}>
        <div className={styles.title}>决策时间线</div>
        <div className={styles.subtitle}>
          聚合关键 EventJournal / ReviewIntent / Transition / Slot 事件，
          按时间倒序展示。
        </div>
      </div>

      {error ? <div className={styles.error}>{error}</div> : null}

      {data === null ? (
        <div className={styles.empty}>加载时间线中…</div>
      ) : events.length === 0 ? (
        <div className={styles.empty}>
          暂无关键事件。任务启动 AI session 后会在此聚合显示协作过程。
        </div>
      ) : (
        <ol className={styles.list}>
          {[...events].reverse().map((event) => (
            <li
              className={styles.item}
              data-severity={event.severity}
              key={event.id}
            >
              <div className={styles.marker} aria-hidden>
                {severityLabel(event.severity)}
              </div>
              <div className={styles.body}>
                <div className={styles.itemHead}>
                  <span className={styles.itemTitle}>{event.title}</span>
                  <span className={styles.itemTime}>{formatAt(event.at)}</span>
                </div>
                <div className={styles.itemMeta}>
                  <span className={styles.itemKind}>{event.kind}</span>
                  <span className={styles.itemSource}>{event.source}</span>
                  {event.anchorId ? (
                    <span className={styles.anchorTag} title={`Anchor ${event.anchorId}`}>
                      ⌘ {event.anchorId}
                    </span>
                  ) : null}
                  <Button
                    onClick={() =>
                      setExpanded((prev) => ({ ...prev, [event.id]: !prev[event.id] }))
                    }
                    size="sm"
                    variant="ghost"
                  >
                    {expanded[event.id] ? "收起" : "查看 payload"}
                  </Button>
                </div>
                {expanded[event.id] ? <PayloadView payload={event.payload} /> : null}
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
