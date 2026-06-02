export class UserIntentValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UserIntentValidationError";
  }
}

export class NoActiveSlotError extends Error {
  constructor(taskId: string) {
    super(`任务 ${taskId} 没有绑定中的 slot，无法停止`);
    this.name = "NoActiveSlotError";
  }
}

export class NoPendingIntentError extends Error {
  constructor(taskId: string) {
    super(`任务 ${taskId} 没有待消费的 user_intent，不能恢复`);
    this.name = "NoPendingIntentError";
  }
}
