export const NODE_PHASE_MAP = {
  requirement_analysis: "需求",
  technical_design: "设计",
  task_breakdown: "拆分",
  dispatch: "派工",
  implementation: "实施",
  review: "审查",
  archive: "归档"
} as const;

export function mapNodeToPhase(currentNode: string | null | undefined): string {
  const normalized = currentNode?.trim().toLowerCase();
  if (!normalized) {
    return "设计";
  }

  return NODE_PHASE_MAP[normalized as keyof typeof NODE_PHASE_MAP] ?? "设计";
}
