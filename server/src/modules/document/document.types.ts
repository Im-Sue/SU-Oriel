import type { DocGovernance } from "../../indexer/document-governance.js";

export interface DocumentRecord {
  id: string;
  projectId: string;
  taskKey: string | null;
  path: string;
  kind: string;
  title: string;
  status: string | null;
  summary: string | null;
  parseStatus: string;
  mtime: string;
  updatedAt: string;
}

/** List response carries governance (additive, list-only). Detail intentionally does NOT. */
export interface DocumentListRecord extends DocumentRecord {
  governance: DocGovernance;
}

export interface DocumentDetailRecord extends DocumentRecord {
  frontmatter: Record<string, string>;
  content: string;
}
