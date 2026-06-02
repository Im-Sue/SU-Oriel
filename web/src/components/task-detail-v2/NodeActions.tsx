import styles from "./NodeActions.module.css";
import type { TaskNodeFlowAction } from "../../lib/use-task-node-flow.js";

interface NodeActionsProps {
  actions: TaskNodeFlowAction[];
  error: string | null;
}

export function NodeActions({ actions, error }: NodeActionsProps) {
  const visibleActions = actions.filter((action) => action.applicability === "user_actionable");

  if (visibleActions.length === 0) {
    return null;
  }

  return (
    <div className={styles.container}>
      {error ? <p className={styles.error}>加载 node-flow 失败：{error}</p> : null}
      <div className={styles.list}>
        {visibleActions.map((action) => {
          const guarded = action.guardStatus === "blocked";
          return (
            <button
              aria-label={action.label}
              className={guarded ? styles.guardedButton : styles.actionButton}
              disabled={guarded}
              key={action.transitionId}
              title={guarded ? action.guardReason ?? "guard 未满足" : action.label}
              type="button"
            >
              <span className={styles.actionLabel}>{action.label}</span>
              {guarded ? (
                <span className={styles.guardTag}>guard</span>
              ) : (
                <span className={styles.arrow} aria-hidden="true">→</span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
