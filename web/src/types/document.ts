export type DocumentTier = "生效中" | "历史" | "归档";

/** List-only governance projection (server derives via deriveDocumentGovernance). */
export interface DocumentGovernanceView {
  tier: DocumentTier;
  requirementId: string | null;
  entityStatus: string | null;
  taskId: string | null;
  healthFlags: { parseError: boolean };
}

/** Fields shared by list and detail. Neither carries governance by itself. */
export interface DocumentBaseView {
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

/** List response = base + governance. */
export interface DocumentView extends DocumentBaseView {
  governance: DocumentGovernanceView;
}

/**
 * Detail response = base + content. Intentionally does NOT extend DocumentView,
 * so governance does not leak into the detail/reader path.
 */
export interface DocumentDetailView extends DocumentBaseView {
  frontmatter: Record<string, string>;
  content: string;
}
