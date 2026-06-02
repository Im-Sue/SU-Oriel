import type { CcbdClientServiceLike } from "../ccbd-client/ccbd-client.types.js";
import { AnchorNotFoundError, AnchorSocketNotReadyError } from "./anchor-broker.errors.js";
import type { MultiAnchorBrokerService } from "./broker.service.js";

type QueueClient = Pick<CcbdClientServiceLike, "queue">;

export class QueueRouterService {
  constructor(
    private readonly broker: MultiAnchorBrokerService,
    private readonly client: QueueClient
  ) {}

  async queueAcrossAnchor(anchorId: string, target = "all"): Promise<Record<string, unknown>> {
    const anchor = await this.broker.resolveAnchor(anchorId);
    if (!anchor) {
      throw new AnchorNotFoundError(anchorId);
    }
    if (!anchor.socketPath) {
      throw new AnchorSocketNotReadyError(anchorId);
    }
    return await this.client.queue(target, { anchorId });
  }
}
