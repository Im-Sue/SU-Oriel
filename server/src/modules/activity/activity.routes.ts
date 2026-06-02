import type { FastifyInstance } from "fastify";

import { activityRecentQuerySchema, getRecentActivity } from "./activity.service.js";

export async function registerActivityRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/activity/recent", async (request, reply) => {
    const parsedQuery = activityRecentQuerySchema.safeParse(request.query ?? {});

    if (!parsedQuery.success) {
      reply.status(400);
      return {
        message: "activity 参数不合法",
        issues: parsedQuery.error.issues
      };
    }

    return await getRecentActivity(parsedQuery.data);
  });
}
