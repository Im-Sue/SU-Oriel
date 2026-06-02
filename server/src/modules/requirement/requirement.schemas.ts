import { z } from "zod";

const optionalFidelityField = z.string().max(12000, "保真字段内容过长").optional();

export const createRequirementSchema = z.object({
  title: z.string().trim().min(1, "需求标题不能为空").max(120, "需求标题过长"),
  description: z.string().trim().min(1, "需求描述不能为空").max(4000, "需求描述过长"),
  outputMode: z.literal("requirement_only").default("requirement_only"),
  splitMode: z.literal("direct_pr").default("direct_pr"),
  source_task_id: z.string().trim().min(1, "来源任务 id 不能为空").max(160, "来源任务 id 过长").nullable().optional(),
  asset_tmp_uuid: z.string().trim().regex(/^[A-Za-z0-9-]{1,64}$/, "asset_tmp_uuid 不合法").optional(),
  verbatim_source: z.string().max(12000, "用户原话过长").optional(),
  claude_interpretation: optionalFidelityField,
  ambiguities: optionalFidelityField,
  fidelity_diff: optionalFidelityField
});

export const editRequirementSchema = z
  .object({
    title: z.string().trim().min(1, "需求标题不能为空").max(120, "需求标题过长").optional(),
    description: z.string().trim().min(1, "需求描述不能为空").max(4000, "需求描述过长").optional(),
    changeReason: z.string().trim().min(1, "变更原因不能为空").max(1000, "变更原因过长").optional(),
    expectedMdHash: z.string().trim().regex(/^[a-f0-9]{64}$/i, "expectedMdHash 必须是 sha256 hex")
  })
  .strict()
  .refine((input) => input.title !== undefined || input.description !== undefined, {
    message: "title 或 description 至少提供一个"
  });
