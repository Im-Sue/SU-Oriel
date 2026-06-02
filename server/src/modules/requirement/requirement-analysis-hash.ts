import { createHash } from "node:crypto";

export function hashRequirementAnalysisInput(title: string, description: string): string {
  return createHash("sha256").update(`${title}${description}`, "utf8").digest("hex");
}
