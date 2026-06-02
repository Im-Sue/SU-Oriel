export const AI_CLI_ERROR_CODES = {
  TOOL_NOT_FOUND: "TOOL_NOT_FOUND",
  CWD_INVALID: "CWD_INVALID",
  EXTERNAL_TERMINAL_MISSING: "EXTERNAL_TERMINAL_MISSING",
  EXTERNAL_LAUNCH_FAILED: "EXTERNAL_LAUNCH_FAILED",
  PLATFORM_UNSUPPORTED: "PLATFORM_UNSUPPORTED",
  PTY_SPAWN_FAILED: "PTY_SPAWN_FAILED",
  SESSION_NOT_FOUND: "SESSION_NOT_FOUND",
  SESSION_LIMIT: "SESSION_LIMIT",
  RATE_LIMITED: "RATE_LIMITED",
  WS_UNAUTHORIZED: "WS_UNAUTHORIZED",
  RECORDING_NOT_FOUND: "RECORDING_NOT_FOUND",
  RECORDING_INVALID: "RECORDING_INVALID"
} as const;

export type AiCliErrorCode = (typeof AI_CLI_ERROR_CODES)[keyof typeof AI_CLI_ERROR_CODES];

export class AiCliError extends Error {
  public readonly code: AiCliErrorCode;
  public readonly statusCode: number;
  public constructor(code: AiCliErrorCode, message: string, statusCode = 400) {
    super(message);
    this.code = code;
    this.statusCode = statusCode;
  }
}
