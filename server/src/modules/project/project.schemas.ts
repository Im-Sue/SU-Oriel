import { z } from "zod";

export const createProjectSchema = z.object({
  name: z.string().trim().min(1, "项目名称不能为空"),
  localPath: z.string().trim().min(1, "项目路径不能为空"),
  summary: z.string().trim().max(500, "项目简介不能超过 500 个字符").optional()
});

export type CreateProjectRequest = z.infer<typeof createProjectSchema>;
