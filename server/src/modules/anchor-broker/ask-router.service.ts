import type { CcbdClientServiceLike, CcbdSubmitResponse } from "../ccbd-client/ccbd-client.types.js";
import { AnchorNotFoundError, AnchorSocketNotReadyError, CrossAnchorAgentDirectDeniedError } from "./anchor-broker.errors.js";
import type { MultiAnchorBrokerService } from "./broker.service.js";

export type AskAcrossAnchorInput = {
  targetAnchorId: string;
  toAgent: string;
  taskId: string;
  body: string;
  fromAnchorId?: string;
};

export type DirectAgentAcrossAnchorInput = AskAcrossAnchorInput & {
  fromAnchorId: string;
  fromAgent: string;
};

type SubmitClient = Pick<CcbdClientServiceLike, "submit">;

export class AskRouterService {
  constructor(
    private readonly broker: MultiAnchorBrokerService,
    private readonly client: SubmitClient
  ) {}

  async askAcrossAnchor(input: AskAcrossAnchorInput): Promise<CcbdSubmitResponse> {
    const anchor = await this.broker.resolveAnchor(input.targetAnchorId);
    if (!anchor) {
      throw new AnchorNotFoundError(input.targetAnchorId);
    }
    if (!anchor.socketPath) {
      throw new AnchorSocketNotReadyError(input.targetAnchorId);
    }

    return await this.client.submit({
      anchorId: input.targetAnchorId,
      toAgent: input.toAgent,
      taskId: input.taskId,
      body: input.body,
      fromActor: "system",
      messageType: "ask"
    });
  }

  async askDirectAgentAcrossAnchor(input: DirectAgentAcrossAnchorInput): Promise<CcbdSubmitResponse> {
    if (input.fromAnchorId !== input.targetAnchorId) {
      throw new CrossAnchorAgentDirectDeniedError(input.fromAnchorId, input.targetAnchorId);
    }
    return await this.client.submit({
      anchorId: input.targetAnchorId,
      toAgent: input.toAgent,
      taskId: input.taskId,
      body: input.body,
      fromActor: input.fromAgent,
      messageType: "ask"
    });
  }
}
