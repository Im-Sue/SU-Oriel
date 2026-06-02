import styles from "./CapabilityMatrix.module.css";

type ComponentSize = "sm" | "md" | "lg";
type ComponentTone = "default" | "success" | "warn" | "danger";
type CapabilityStatus = "resolved" | "fallback" | "missing" | "skip";

export interface CapabilityMatrixCapability {
  id: string;
  label: string;
  criticality?: string;
}

export interface CapabilityMatrixCell {
  nodeId: string;
  capabilityId: string;
  status: CapabilityStatus;
  tooltip?: string;
}

export interface CapabilityMatrixProps {
  nodes: string[];
  capabilities: CapabilityMatrixCapability[];
  cells: CapabilityMatrixCell[];
  size?: ComponentSize;
  tone?: ComponentTone;
}

export function CapabilityMatrix({
  nodes,
  capabilities,
  cells,
  size = "md",
  tone = "default"
}: CapabilityMatrixProps) {
  return (
    <div className={`${styles.root} ${styles[size]} ${styles[tone]}`} role="table" aria-label="Capability matrix">
      <div className={styles.grid} style={{ gridTemplateColumns: `minmax(160px, 1.2fr) repeat(${nodes.length}, 1fr)` }}>
        <div className={styles.corner} role="columnheader">
          Capability
        </div>
        {nodes.map((nodeId) => (
          <div key={nodeId} className={styles.nodeHeader} role="columnheader">
            {shortNodeLabel(nodeId)}
          </div>
        ))}
        {capabilities.map((capability) => (
          <MatrixRow key={capability.id} capability={capability} nodes={nodes} cells={cells} />
        ))}
      </div>
    </div>
  );
}

interface MatrixRowProps {
  capability: CapabilityMatrixCapability;
  nodes: string[];
  cells: CapabilityMatrixCell[];
}

function MatrixRow({ capability, nodes, cells }: MatrixRowProps) {
  return (
    <>
      <div className={styles.capabilityHeader} role="rowheader">
        <span>{capability.label}</span>
        {capability.criticality ? <small>{capability.criticality}</small> : null}
      </div>
      {nodes.map((nodeId) => {
        const cell = cells.find((item) => item.nodeId === nodeId && item.capabilityId === capability.id);
        const status = cell?.status ?? "skip";
        const tooltip = cell?.tooltip ?? statusLabel(status);

        return (
          <span
            key={`${nodeId}-${capability.id}`}
            className={`${styles.cell} ${styles[status]}`}
            data-testid={`capability-cell-${nodeId}-${capability.id}`}
            data-status={status}
            role="cell"
            tabIndex={0}
            aria-label={`${capability.label} at ${nodeId}: ${tooltip}`}
            title={tooltip}
          >
            {statusGlyph(status)}
          </span>
        );
      })}
    </>
  );
}

function shortNodeLabel(nodeId: string) {
  return nodeId
    .split("_")
    .map((part) => part.slice(0, 3))
    .join("");
}

function statusLabel(status: CapabilityStatus) {
  if (status === "resolved") {
    return "resolved";
  }

  if (status === "fallback") {
    return "fallback";
  }

  if (status === "missing") {
    return "missing";
  }

  return "not required";
}

function statusGlyph(status: CapabilityStatus) {
  if (status === "resolved") {
    return "●";
  }

  if (status === "fallback") {
    return "◐";
  }

  if (status === "missing") {
    return "✕";
  }

  return "-";
}
