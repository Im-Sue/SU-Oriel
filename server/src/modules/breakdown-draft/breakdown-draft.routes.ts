import type { PrismaClient } from "@prisma/client";
import type { FastifyInstance } from "fastify";

import { prisma } from "../../db/prisma.js";
import {
  BreakdownDraftConflictError,
  BreakdownDraftError,
  BreakdownDraftHashMismatchError,
  BreakdownDraftIoError,
  BreakdownDraftNotFoundError,
  BreakdownDraftValidationError
} from "./breakdown-draft.errors.js";
import { BreakdownDraftService } from "./breakdown-draft.service.js";

export interface BreakdownDraftRouteDependencies {
  prismaClient?: PrismaClient;
  service?: BreakdownDraftService;
}

function statusForError(error: unknown): number {
  if (error instanceof BreakdownDraftNotFoundError) {
    return 404;
  }
  if (error instanceof BreakdownDraftHashMismatchError || error instanceof BreakdownDraftConflictError) {
    return 409;
  }
  if (error instanceof BreakdownDraftValidationError) {
    return 400;
  }
  if (error instanceof BreakdownDraftIoError) {
    return 500;
  }
  return 500;
}

function messageForError(error: unknown): string {
  if (error instanceof BreakdownDraftError) {
    return error.message;
  }
  return error instanceof Error ? error.message : "breakdown draft request failed";
}

export async function registerBreakdownDraftRoutes(
  app: FastifyInstance,
  dependencies: BreakdownDraftRouteDependencies = {}
): Promise<void> {
  const db = dependencies.prismaClient ?? prisma;
  const service = dependencies.service ?? new BreakdownDraftService(db);

  app.get("/api/requirements/:requirementId/breakdown-draft", async (request, reply) => {
    const { requirementId } = request.params as { requirementId: string };
    try {
      return await service.getDraft(requirementId);
    } catch (error) {
      reply.status(statusForError(error));
      return { message: messageForError(error) };
    }
  });
}
