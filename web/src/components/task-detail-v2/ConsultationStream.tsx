import { FormEvent, useEffect, useRef, useState } from "react";

import { usePendingConsult } from "./hooks/usePendingConsult.js";
import { useProjectionChannel } from "./hooks/useProjectionChannel.js";
import { type ConsultRound, useTaskConsultation } from "./hooks/useTaskConsultation.js";
import styles from "./ConsultationStream.module.css";

interface ConsultationStreamProps {
  taskId: string;
  nodeId: string;
  targetAgent?: string;
}

const CONSULT_NODE_IDS = new Set(["requirement_analysis", "technical_design", "task_breakdown"]);
const MAX_MESSAGE_LENGTH = 4096;

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function codexReplyText(reply: unknown): string {
  if (typeof reply === "string") return reply;
  if (reply && typeof reply === "object" && !Array.isArray(reply)) {
    const object = reply as Record<string, unknown>;
    return text(object.recommendation) ?? text(object.summary) ?? JSON.stringify(object, null, 2);
  }
  return "No Codex reply";
}

function Bubble({ by, children }: { by: "claude" | "codex" | "user" | "pending"; children: string }) {
  return (
    <article className={`${styles.bubble} ${styles[by]}`}>
      <span className={styles.sender}>{by === "user" ? "You" : by === "pending" ? "Codex" : by}</span>
      <p>{children}</p>
    </article>
  );
}

function RoundBubbles({ round }: { round: ConsultRound }) {
  return (
    <div className={styles.round}>
      <span className={styles.roundLabel}>{round.round}</span>
      <Bubble by="claude">{round.inputSummary || "No input summary"}</Bubble>
      <Bubble by="codex">{codexReplyText(round.codexReply)}</Bubble>
    </div>
  );
}

export function ConsultationStream({ taskId, nodeId, targetAgent = "ccb_codex" }: ConsultationStreamProps) {
  const applicable = CONSULT_NODE_IDS.has(nodeId);
  const projection = useProjectionChannel(applicable ? taskId : null);
  const consultation = useTaskConsultation(applicable ? taskId : null, { projectionSignal: projection.latest ?? null });
  const pendingConsult = usePendingConsult(applicable ? taskId : null, applicable ? nodeId : null, { projectionSignal: projection.latest ?? null });
  const [draft, setDraft] = useState("");
  const endRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [consultation.rounds.length, pendingConsult.pending?.id]);

  if (!applicable) {
    return <div className={styles.empty}>该节点不接受 consult 请求</div>;
  }

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const request = await pendingConsult.submit(draft, targetAgent);
    if (request) setDraft("");
  };

  const error = pendingConsult.submitError ?? consultation.error;

  return (
    <section className={styles.workbenchScope} data-theme="workbench" aria-label="Consultation stream">
      {error ? <div className={styles.error} role="alert">{error}</div> : null}
      <div className={styles.messages}>
        {consultation.loading && consultation.rounds.length === 0 ? <p className={styles.muted}>加载 consult records...</p> : null}
        {!consultation.loading && consultation.rounds.length === 0 && !pendingConsult.pending ? <p className={styles.muted}>No consult rounds yet</p> : null}
        {consultation.rounds.map((round) => <RoundBubbles key={`${round.round}-${round.timestamp}`} round={round} />)}
        {pendingConsult.pending ? (
          <div className={styles.round}>
            <Bubble by="user">{pendingConsult.pending.message}</Bubble>
            <Bubble by="pending">等待 Codex 响应...</Bubble>
          </div>
        ) : null}
        <div ref={endRef} />
      </div>
      {pendingConsult.pending ? (
        <button aria-label="Cancel pending consult" className={styles.cancel} onClick={() => void pendingConsult.cancel(pendingConsult.pending?.id ?? "")} type="button">取消</button>
      ) : null}
      <form className={styles.composer} onSubmit={(event) => void submit(event)}>
        <textarea
          aria-label="Consult message"
          maxLength={MAX_MESSAGE_LENGTH}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="输入 consult 请求"
          value={draft}
        />
        <button aria-label="Send consult" disabled={!draft.trim() || Boolean(pendingConsult.pending) || pendingConsult.submitting} type="submit">Send</button>
      </form>
    </section>
  );
}
