import { z } from "zod";

export const deriveTaskSchema = z
  .object({
    type: z.enum(["subtask", "requirement", "decision"]),
    title: z.string().trim().min(1, "标题不能为空").max(200, "标题过长"),
    description: z.string().trim().max(4000, "描述过长").optional()
  })
  .strict();

export type DeriveTaskInput = z.infer<typeof deriveTaskSchema>;
