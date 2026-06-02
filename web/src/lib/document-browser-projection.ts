import type { DocumentTier, DocumentView } from "../types/document.js";

export interface DocumentBrowserGroup {
  directory: string;
  documents: DocumentView[];
}

export interface DocumentBrowserProjection {
  groups: DocumentBrowserGroup[];
}

const TIER_ORDER: Record<DocumentTier, number> = { 生效中: 0, 历史: 1, 归档: 2 };

function directoryOf(path: string): string {
  const index = path.lastIndexOf("/");
  return index >= 0 ? path.slice(0, index) : "";
}

export function projectDocumentBrowser(documents: DocumentView[]): DocumentBrowserProjection {
  const groupByDirectory = new Map<string, DocumentBrowserGroup>();
  for (const document of documents) {
    const directory = directoryOf(document.path);
    let group = groupByDirectory.get(directory);
    if (!group) {
      group = { directory, documents: [] };
      groupByDirectory.set(directory, group);
    }
    group.documents.push(document);
  }

  const groups = [...groupByDirectory.values()].sort((a, b) => a.directory.localeCompare(b.directory));
  for (const group of groups) {
    // 组内排序：tier 优先（生效中 → 历史 → 归档），同档位再按路径名，
    // 让历史、归档文档稳定排在生效中文档之后。
    group.documents.sort((a, b) => {
      const tierDelta = TIER_ORDER[a.governance.tier] - TIER_ORDER[b.governance.tier];
      if (tierDelta !== 0) return tierDelta;
      return a.path.localeCompare(b.path);
    });
  }

  return { groups };
}
