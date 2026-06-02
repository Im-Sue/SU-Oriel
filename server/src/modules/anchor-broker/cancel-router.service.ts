import type { CcbdClientServiceLike } from "../ccbd-client/ccbd-client.types.js";
import { AnchorNotFoundError, AnchorSocketNotReadyError } from "./anchor-broker.errors.js";
import type { MultiAnchorBrokerService } from "./broker.service.js";

type CancelClient = Pick<CcbdClientServiceLike, "cancel">;

export class CancelRouterService {
  constructor(
    private readonly broker: MultiAnchorBrokerService,
    private readonly client: CancelClient
  ) {}

  async cancelAcrossAnchor(anchorId: string, jobId: string): Promise<Record<string, unknown>> {
    const anchor = await this.broker.resolveAnchor(anchorId);
    if (!anchor) {
      throw new AnchorNotFoundError(anchorId);
    }
    if (!anchor.socketPath) {
      throw new AnchorSocketNotReadyError(anchorId);
    }
    return await this.client.cancel(jobId, { anchorId });
  }
}
