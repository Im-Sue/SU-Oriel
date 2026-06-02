export enum AnchorBrokerErrorCode {
  ANCHOR_NOT_FOUND = "ANCHOR_NOT_FOUND",
  ANCHOR_SOCKET_NOT_READY = "ANCHOR_SOCKET_NOT_READY",
  CROSS_ANCHOR_AGENT_DIRECT_DENIED = "CROSS_ANCHOR_AGENT_DIRECT_DENIED"
}

export class AnchorBrokerError extends Error {
  constructor(
    readonly code: AnchorBrokerErrorCode,
    message: string
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class AnchorNotFoundError extends AnchorBrokerError {
  constructor(anchorId: string) {
    super(AnchorBrokerErrorCode.ANCHOR_NOT_FOUND, `anchor not found: ${anchorId}`);
  }
}

export class AnchorSocketNotReadyError extends AnchorBrokerError {
  constructor(anchorId: string) {
    super(AnchorBrokerErrorCode.ANCHOR_SOCKET_NOT_READY, `anchor socket is not ready: ${anchorId}`);
  }
}

export class CrossAnchorAgentDirectDeniedError extends AnchorBrokerError {
  constructor(fromAnchorId: string, targetAnchorId: string) {
    super(
      AnchorBrokerErrorCode.CROSS_ANCHOR_AGENT_DIRECT_DENIED,
      `direct agent-to-agent ask across anchors is denied: ${fromAnchorId} -> ${targetAnchorId}`
    );
  }
}
