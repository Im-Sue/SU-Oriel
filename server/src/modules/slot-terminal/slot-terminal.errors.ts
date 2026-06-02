export class SlotTerminalNotFoundError extends Error {
  readonly statusCode = 404;

  constructor(message = "slot terminal not found") {
    super(message);
    this.name = "SlotTerminalNotFoundError";
  }
}

export class SlotTerminalTargetForbiddenError extends Error {
  readonly statusCode = 403;

  constructor(message = "slot terminal target is not allowed") {
    super(message);
    this.name = "SlotTerminalTargetForbiddenError";
  }
}

export function isSlotTerminalNotFoundError(error: unknown): error is SlotTerminalNotFoundError {
  return error instanceof SlotTerminalNotFoundError;
}

export function isSlotTerminalTargetForbiddenError(error: unknown): error is SlotTerminalTargetForbiddenError {
  return error instanceof SlotTerminalTargetForbiddenError;
}
