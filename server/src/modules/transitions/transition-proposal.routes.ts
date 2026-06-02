import type { FastifyInstance } from "fastify";

import { transitionProposalParamsSchema, transitionProposalQuerySchema } from "./transition-proposal.schemas.js";
import { resolveTransitionProposal } from "./transition-proposal.service.js";

export async function registerTransitionProposalRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/event-journal/events/:eventId/transition-proposal", async (request, reply) => {
    const parsedParams = transitionProposalParamsSchema.safeParse(request.params ?? {});
    const parsedQuery = transitionProposalQuerySchema.safeParse(request.query ?? {});

    if (!parsedParams.success || !parsedQuery.success) {
      reply.status(400);
      return {
        message: "transition proposal 参数不合法",
        issues: [
          ...(parsedParams.success ? [] : parsedParams.error.issues),
          ...(parsedQuery.success ? [] : parsedQuery.error.issues)
        ]
      };
    }

    return await resolveTransitionProposal({
      eventId: parsedParams.data.eventId,
      taskId: parsedQuery.data.task_id
    });
  });
}
