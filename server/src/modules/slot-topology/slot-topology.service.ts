export const MIN_PROJECT_SLOT_COUNT = 1;
export const MAX_PROJECT_SLOT_COUNT = 16;

export type SlotId = `slot-${number}`;
export type AgentProvider = "claude" | "codex";

export type SlotAgentNames = readonly [claudeAgentName: string, codexAgentName: string];

export type AgentCore = {
  provider: AgentProvider;
  windowName: string;
};

const MAIN_AGENT_CORE: Record<string, AgentCore> = {
  main_claude: { provider: "claude", windowName: "main" },
  main_codex: { provider: "codex", windowName: "main" }
};

export function slotIds(slotCount: number): SlotId[] {
  assertValidSlotCount(slotCount);
  return Array.from({ length: slotCount }, (_, index) => `slot-${index + 1}` as SlotId);
}

export function agentNamesForSlot(slotId: string): SlotAgentNames {
  const slotNumber = parseSlotId(slotId);
  return [`slot${slotNumber}_claude`, `slot${slotNumber}_codex`];
}

export function managedWindowNames(slotCount: number): string[] {
  return ["main", ...slotIds(slotCount)];
}

export function managedAgentNames(slotCount: number): string[] {
  return [
    "main_claude",
    "main_codex",
    ...slotIds(slotCount).flatMap((slotId) => [...agentNamesForSlot(slotId)])
  ];
}

export function agentCore(slotCount: number): Record<string, AgentCore> {
  const core: Record<string, AgentCore> = { ...MAIN_AGENT_CORE };
  for (const slotId of slotIds(slotCount)) {
    const [claudeAgentName, codexAgentName] = agentNamesForSlot(slotId);
    core[claudeAgentName] = { provider: "claude", windowName: slotId };
    core[codexAgentName] = { provider: "codex", windowName: slotId };
  }
  return core;
}

export function assertValidSlotCount(slotCount: number): void {
  if (
    !Number.isInteger(slotCount) ||
    slotCount < MIN_PROJECT_SLOT_COUNT ||
    slotCount > MAX_PROJECT_SLOT_COUNT
  ) {
    throw new RangeError(
      `slotCount must be an integer between ${MIN_PROJECT_SLOT_COUNT} and ${MAX_PROJECT_SLOT_COUNT}`
    );
  }
}

function parseSlotId(slotId: string): number {
  const match = slotId.match(/^slot-(\d+)$/);
  const slotNumber = match?.[1] ? Number(match[1]) : NaN;
  if (
    !Number.isInteger(slotNumber) ||
    slotNumber < MIN_PROJECT_SLOT_COUNT ||
    slotNumber > MAX_PROJECT_SLOT_COUNT
  ) {
    throw new RangeError(`slotId must be in slot-1..slot-${MAX_PROJECT_SLOT_COUNT}`);
  }
  return slotNumber;
}
