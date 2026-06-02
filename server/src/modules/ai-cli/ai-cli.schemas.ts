import { z } from "zod";

import { AI_CLI_TOOLS } from "./ai-cli.types.js";

export const aiCliToolIdSchema = z.enum(AI_CLI_TOOLS);
export const aiCliLaunchModeSchema = z.enum(["external", "embedded"]);

export const launchSchema = z.object({
  toolId: aiCliToolIdSchema,
  projectId: z.string().trim().min(1).optional().nullable()
});

export const settingUpsertSchema = z.object({
  scope: z.enum(["global", "project"]),
  projectId: z.string().trim().min(1).optional().nullable(),
  toolId: aiCliToolIdSchema,
  command: z.string().trim().max(500).optional().nullable(),
  extraArgs: z.array(z.string().min(1).max(200)).max(32).default([]),
  defaultMode: aiCliLaunchModeSchema.optional().nullable()
});

export const settingDeleteSchema = z.object({
  scope: z.enum(["global", "project"]),
  projectId: z.string().trim().min(1).optional().nullable(),
  toolId: aiCliToolIdSchema
});

export const createSessionSchema = z.object({
  toolId: aiCliToolIdSchema,
  projectId: z.string().trim().min(1).optional().nullable(),
  cols: z.number().int().min(20).max(500).optional(),
  rows: z.number().int().min(5).max(200).optional(),
  shellWrap: z.boolean().optional(),
  record: z.boolean().optional()
});
