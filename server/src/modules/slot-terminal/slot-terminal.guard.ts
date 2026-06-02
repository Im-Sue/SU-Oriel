import { SlotTerminalService, type SlotTerminalPaneTarget } from "./slot-terminal.service.js";

export type AssertTargetBelongsToOptions = {
  service?: Pick<SlotTerminalService, "assertTargetBelongsTo">;
};

export async function assertTargetBelongsTo(
  requirementId: string,
  slotId: string,
  role: string,
  target: string,
  options: AssertTargetBelongsToOptions = {}
): Promise<SlotTerminalPaneTarget> {
  const service = options.service ?? new SlotTerminalService();
  return await service.assertTargetBelongsTo({
    requirementId,
    slotId,
    role,
    target
  });
}
