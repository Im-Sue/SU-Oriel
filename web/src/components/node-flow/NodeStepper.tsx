import styles from "./NodeStepper.module.css";

type ComponentSize = "sm" | "md" | "lg";
type ComponentTone = "default" | "success" | "warn" | "danger";

export interface NodeStepperNode {
  id: string;
  label: string;
}

export interface NodeStepperTransition {
  source: string;
  target: string;
  verdict: "pass" | "wait" | "fail" | "blocked";
}

export interface NodeStepperProps {
  nodes: NodeStepperNode[];
  currentNodeId: string;
  substate?: string;
  transitions?: NodeStepperTransition[];
  size?: ComponentSize;
  tone?: ComponentTone;
}

const width = 760;
const height = 140;
const startX = 52;
const endX = 708;
const markerY = 54;

export function NodeStepper({
  nodes,
  currentNodeId,
  substate,
  transitions = [],
  size = "md",
  tone = "default"
}: NodeStepperProps) {
  const currentIndex = nodes.findIndex((node) => node.id === currentNodeId);
  const stepGap = nodes.length > 1 ? (endX - startX) / (nodes.length - 1) : 0;

  return (
    <section className={`${styles.root} ${styles[size]} ${styles[tone]}`} aria-label="Node flow projection">
      <svg className={styles.stepper} viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Read-only node flow">
        <title>Read-only node flow</title>
        {nodes.slice(0, -1).map((node, index) => {
          const nextNode = nodes[index + 1];
          const transition = transitions.find((item) => item.source === node.id && item.target === nextNode.id);
          const verdict = transition?.verdict ?? "wait";
          const x1 = startX + stepGap * index + 17;
          const x2 = startX + stepGap * (index + 1) - 17;

          return (
            <line
              key={`${node.id}-${nextNode.id}`}
              className={`${styles.connector} ${connectorClass(verdict)}`}
              data-testid={`node-stepper-transition-${node.id}-${nextNode.id}`}
              data-verdict={verdict}
              x1={x1}
              x2={x2}
              y1={markerY}
              y2={markerY}
            />
          );
        })}
        {nodes.map((node, index) => {
          const x = startX + stepGap * index;
          const state = getNodeState(index, currentIndex);

          return (
            <g
              key={node.id}
              className={`${styles.node} ${nodeClass(state)}`}
              data-testid={`node-stepper-node-${node.id}`}
              data-state={state}
              tabIndex={0}
              aria-label={`${node.label}: ${state}`}
            >
              <circle className={styles.marker} cx={x} cy={markerY} r="14" />
              <text className={styles.indexLabel} x={x} y={markerY + 4} textAnchor="middle">
                {index + 1}
              </text>
              <text className={styles.nodeLabel} x={x} y={markerY + 42} textAnchor="middle">
                {node.label}
              </text>
            </g>
          );
        })}
      </svg>
      <div className={styles.meta}>
        <span>Current: {currentNodeId}</span>
        {substate ? <span>Substate: {substate}</span> : null}
      </div>
    </section>
  );
}

function getNodeState(index: number, currentIndex: number) {
  if (index === currentIndex) {
    return "current";
  }

  if (currentIndex >= 0 && index < currentIndex) {
    return "complete";
  }

  return "pending";
}

function nodeClass(state: string) {
  if (state === "current") {
    return styles.currentNode;
  }

  if (state === "complete") {
    return styles.completeNode;
  }

  return styles.pendingNode;
}

function connectorClass(verdict: NodeStepperTransition["verdict"]) {
  if (verdict === "pass") {
    return styles.connectorActive;
  }

  if (verdict === "fail" || verdict === "blocked") {
    return styles.connectorBlocked;
  }

  return styles.connectorPending;
}
