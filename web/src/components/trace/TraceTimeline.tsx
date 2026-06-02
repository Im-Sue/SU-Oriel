import { useState } from "react";

import { Card } from "../ui/Card.js";
import styles from "./TraceTimeline.module.css";

type ComponentSize = "sm" | "md" | "lg";
type ComponentTone = "default" | "success" | "warn" | "danger";

export interface TraceTimelineEvent {
  id: string;
  sender: string;
  receiver: string;
  intent: string;
  score?: number;
  tokensIn?: number;
  tokensOut?: number;
  at: string;
  payloadPreview?: string;
}

export interface TraceTimelineProps {
  events: TraceTimelineEvent[];
  size?: ComponentSize;
  tone?: ComponentTone;
}

export function TraceTimeline({ events, size = "md", tone = "default" }: TraceTimelineProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  return (
    <ol className={`${styles.root} ${styles[size]} ${styles[tone]}`} aria-label="Consultation trace">
      {events.map((event) => {
        const expanded = expandedId === event.id;

        return (
          <li key={event.id} className={styles.item} data-sender={senderTone(event.sender)}>
            <span className={styles.railMarker} aria-hidden="true" />
            <Card className={styles.card} data-testid="trace-timeline-card">
              <div className={styles.header}>
                <div>
                  <p className={styles.route}>
                    {event.sender} to {event.receiver}
                  </p>
                  <h3 className={styles.intent}>{event.intent}</h3>
                </div>
                <button
                  className={styles.toggle}
                  type="button"
                  aria-expanded={expanded}
                  aria-label={`${expanded ? "收起" : "展开"} ${event.intent}`}
                  onClick={() => setExpandedId(expanded ? null : event.id)}
                >
                  <span aria-hidden="true">{expanded ? "▴" : "▾"}</span>
                </button>
              </div>
              <div className={styles.meta}>
                <span>{formatDate(event.at)}</span>
                {typeof event.score === "number" ? <span>score {event.score}</span> : null}
                {typeof event.tokensIn === "number" && typeof event.tokensOut === "number" ? (
                  <span>
                    tokens {event.tokensIn} → {event.tokensOut}
                  </span>
                ) : null}
              </div>
              {expanded && event.payloadPreview ? <p className={styles.payload}>{event.payloadPreview}</p> : null}
            </Card>
          </li>
        );
      })}
    </ol>
  );
}

function senderTone(sender: string) {
  const normalized = sender.toLowerCase();

  if (normalized.includes("claude")) {
    return "claude";
  }

  if (normalized.includes("codex")) {
    return "codex";
  }

  if (normalized.includes("error")) {
    return "error";
  }

  if (normalized.includes("warn")) {
    return "warn";
  }

  return "system";
}

function formatDate(value: string) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toISOString();
}
