import { z } from "zod";

export const createTaskWorkspaceSchema = z.object({
  baseRef: z.string().trim().min(1, "baseRef 不能为空").max(120, "baseRef 过长").default("HEAD"),
  branchName: z.string().trim().min(1, "branchName 不能为空").max(180, "branchName 过长").optional(),
  lockMode: z.enum(["exclusive", "shared"]).default("exclusive"),
  cleanupPolicy: z.enum(["manual", "on_archive", "on_task_done", "ttl"]).default("manual")
});
