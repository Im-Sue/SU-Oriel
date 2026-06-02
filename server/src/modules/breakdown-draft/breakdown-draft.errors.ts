export class BreakdownDraftError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class BreakdownDraftNotFoundError extends BreakdownDraftError {
  constructor(taskId: string) {
    super(`breakdown draft not found for task ${taskId}`);
  }
}

export class BreakdownDraftValidationError extends BreakdownDraftError {
  constructor(message: string) {
    super(message);
  }
}

export class BreakdownDraftCarrierError extends BreakdownDraftError {
  constructor(message: string) {
    super(message);
  }
}

export class BreakdownDraftConflictError extends BreakdownDraftError {
  constructor(message: string) {
    super(message);
  }
}

export class BreakdownDraftHashMismatchError extends BreakdownDraftConflictError {
  constructor() {
    super("breakdown draft hash does not match ifMatchHash");
  }
}

export class BreakdownDraftIoError extends BreakdownDraftError {
  constructor(message: string) {
    super(message);
  }
}
