export class CcbdClientError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class CcbdUnavailableError extends CcbdClientError {
  constructor(message = "ccbd is unavailable") {
    super(message);
  }
}

export class AgentNotFoundError extends CcbdClientError {
  constructor(agentName: string) {
    super(`ccbd agent not found or invalid: ${agentName}`);
  }
}

export class QueueRejectedError extends CcbdClientError {
  constructor(message: string) {
    super(message);
  }
}

export class AnchorSocketNotReadyError extends CcbdClientError {
  readonly code = "ANCHOR_SOCKET_NOT_READY";

  constructor(anchorId: string) {
    super(`anchor socket is not ready: ${anchorId}`);
  }
}

export class ProtocolError extends CcbdClientError {
  constructor(message: string) {
    super(message);
  }
}
