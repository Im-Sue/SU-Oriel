import type { FastifyInstance } from "fastify";

import { ConsultRecordsTaskNotFoundError, listConsultRecords } from "./consult-records.service.js";

export async function registerConsultRecordsRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/tasks/:taskId/consult-records", async (request, reply) => {
    const { taskId } = request.params as { taskId: string };
    try {
      const records = await listConsultRecords(taskId);
      return { task_id: taskId, consult_records: records, count: records.length };
    } catch (error) {
      if (error instanceof ConsultRecordsTaskNotFoundError) {
        reply.status(404);
        return { message: error.message };
      }
      throw error;
    }
  });
}
