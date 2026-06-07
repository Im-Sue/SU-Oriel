import {
  defaultManagedConfigMutationLock,
  type ManagedConfigMutationLock
} from "../project-ccbd/managed-config-mutation-lock.js";

export const DEFAULT_SLOT_RESIZE_LOCK_WAIT_TIMEOUT_MS = 2000;
export const SLOT_RESIZE_LOCK_TIMEOUT_CODE = "SLOT_RESIZE_LOCK_TIMEOUT";

export class SlotResizeLockTimeoutError extends Error {
  readonly code = SLOT_RESIZE_LOCK_TIMEOUT_CODE;
  readonly statusCode = 409;

  constructor(
    readonly projectId: string,
    readonly timeoutMs: number
  ) {
    super(`slot resize lock wait timed out after ${timeoutMs}ms`);
    this.name = "SlotResizeLockTimeoutError";
  }
}

export type SlotResizeLockOptions = {
  lock?: ManagedConfigMutationLock;
  timeoutMs?: number;
};

export async function runWithSlotResizeLock<T>(
  projectId: string,
  work: () => Promise<T>,
  options: SlotResizeLockOptions = {}
): Promise<T> {
  const lock = options.lock ?? defaultManagedConfigMutationLock;
  const timeoutMs = options.timeoutMs ?? DEFAULT_SLOT_RESIZE_LOCK_WAIT_TIMEOUT_MS;
  let acquired = false;
  let timedOut = false;
  let timeout: NodeJS.Timeout | null = null;

  const lockPromise = lock.runExclusive(projectId, async () => {
    if (timedOut) {
      throw new SlotResizeLockTimeoutError(projectId, timeoutMs);
    }
    acquired = true;
    if (timeout) {
      clearTimeout(timeout);
      timeout = null;
    }
    return await work();
  });

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => {
      if (!acquired) {
        timedOut = true;
        reject(new SlotResizeLockTimeoutError(projectId, timeoutMs));
      }
    }, timeoutMs);
  });

  try {
    return await Promise.race([lockPromise, timeoutPromise]);
  } catch (error) {
    lockPromise.catch(() => undefined);
    throw error;
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
}

export async function waitForSlotResizeLock(
  projectId: string,
  options: SlotResizeLockOptions = {}
): Promise<void> {
  await runWithSlotResizeLock(projectId, async () => undefined, options);
}

export function isSlotResizeLockTimeoutError(error: unknown): error is SlotResizeLockTimeoutError {
  return error instanceof SlotResizeLockTimeoutError;
}

export function slotResizeLockTimeoutBody(error: SlotResizeLockTimeoutError): Record<string, unknown> {
  return {
    code: error.code,
    message: error.message,
    projectId: error.projectId,
    timeoutMs: error.timeoutMs
  };
}
