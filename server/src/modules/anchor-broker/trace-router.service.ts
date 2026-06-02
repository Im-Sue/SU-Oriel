import type { CcbdClientServiceLike } from "../ccbd-client/ccbd-client.types.js";
import { AnchorNotFoundError, AnchorSocketNotReadyError } from "./anchor-broker.errors.js";
import type { MultiAnchorBrokerService } from "./broker.service.js";

type TraceClient = Pick<CcbdClientServiceLike, "trace">;

export class TraceRouterService {
  constructor(
    private readonly broker: MultiAnchorBrokerService,
    private readonly client: TraceClient
  ) {}

  async traceAcrossAnchor(anchorId: string, target: string): Promise<Record<string, unknown>> {
    const anchor = await this.broker.resolveAnchor(anchorId);
    if (!anchor) {
      throw new AnchorNotFoundError(anchorId);
    }
    if (!anchor.socketPath) {
      throw new AnchorSocketNotReadyError(anchorId);
    }
    return await this.client.trace(target, { anchorId });
  }
}
