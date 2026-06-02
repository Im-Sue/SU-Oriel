import { z } from "zod";

export const scanStrategySchema = z
  .object({
    enabled: z.boolean(),
    paths: z.array(z.string().min(1)),
    exclude_patterns: z.array(z.string().min(1))
  })
  .strict();

export const parsingRulesSchema = z
  .object({
    strict_frontmatter: z.boolean(),
    allowed_categories: z.array(z.string().min(1))
  })
  .strict();

export const pathConfigSchema = z
  .object({
    docs_root: z.string().min(1),
    kernel_ref: z.string().min(1)
  })
  .strict();

export const projectSettingsPayloadSchema = z
  .object({
    scan_strategy: scanStrategySchema,
    parsing_rules: parsingRulesSchema,
    path_config: pathConfigSchema
  })
  .strict();

export type ProjectSettingsPayload = z.infer<typeof projectSettingsPayloadSchema>;

export const defaultProjectSettings: ProjectSettingsPayload = {
  scan_strategy: {
    enabled: true,
    paths: ["docs"],
    exclude_patterns: ["node_modules", ".git"]
  },
  parsing_rules: {
    strict_frontmatter: true,
    allowed_categories: ["01", "02", "03", "04", "05"]
  },
  path_config: {
    docs_root: "docs",
    // Vestigial display setting: Console does not read kernel files from this path.
    kernel_ref: "references/kernel"
  }
};
