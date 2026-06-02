import { expect, test } from "vitest";

import { projectDocumentBrowser } from "./document-browser-projection.js";
import type { DocumentGovernanceView, DocumentView } from "../types/document.js";

function doc(
  over: Pick<DocumentView, "path" | "kind"> &
    Partial<Omit<DocumentView, "governance">> & { governance?: Partial<DocumentGovernanceView> }
): DocumentView {
  return {
    id: over.id ?? over.path,
    projectId: "p",
    taskKey: over.taskKey ?? null,
    path: over.path,
    kind: over.kind,
    title: over.title ?? over.path,
    status: over.status ?? null,
    summary: over.summary ?? null,
    parseStatus: over.parseStatus ?? "success",
    mtime: "2026-05-01T00:00:00.000Z",
    updatedAt: "2026-05-01T00:00:00.000Z",
    governance: {
      tier: "生效中",
      requirementId: null,
      entityStatus: null,
      taskId: null,
      healthFlags: { parseError: false },
      ...over.governance
    }
  };
}

test("browser projection · 按 full parent directory 分组并排序", () => {
  const { groups } = projectDocumentBrowser([
    doc({ path: "docs/03_开发计划/b-技术设计.md", kind: "technical_design" }),
    doc({ path: "docs/99_归档/old-需求.md", kind: "requirement", governance: { tier: "归档" } }),
    doc({ path: "docs/02_需求设计/a-需求.md", kind: "requirement" }),
    doc({ path: "docs/03_开发计划/a-技术设计.md", kind: "technical_design" })
  ]);

  expect(groups.map((group) => group.directory)).toEqual([
    "docs/02_需求设计",
    "docs/03_开发计划",
    "docs/99_归档"
  ]);
  expect(groups[1].documents.map((document) => document.path)).toEqual([
    "docs/03_开发计划/a-技术设计.md",
    "docs/03_开发计划/b-技术设计.md"
  ]);
});

test("browser projection · 同目录不同 tier 合并到同一目录组", () => {
  const { groups } = projectDocumentBrowser([
    doc({ path: "docs/03_开发计划/active.md", kind: "dev_task", governance: { tier: "生效中" } }),
    doc({ path: "docs/03_开发计划/history.md", kind: "dev_task", governance: { tier: "历史" } })
  ]);

  expect(groups).toHaveLength(1);
  expect(groups[0].directory).toBe("docs/03_开发计划");
  expect(groups[0].documents.map((document) => document.governance.tier)).toEqual(["生效中", "历史"]);
});

test("browser projection · 组内 tier 优先于路径：生效中在前，历史、归档依次靠后", () => {
  const { groups } = projectDocumentBrowser([
    doc({ path: "docs/03_开发计划/a-history.md", kind: "dev_task", governance: { tier: "历史" } }),
    doc({ path: "docs/03_开发计划/m-archive.md", kind: "dev_task", governance: { tier: "归档" } }),
    doc({ path: "docs/03_开发计划/z-active.md", kind: "dev_task", governance: { tier: "生效中" } })
  ]);

  expect(groups[0].documents.map((document) => document.path)).toEqual([
    "docs/03_开发计划/z-active.md",
    "docs/03_开发计划/a-history.md",
    "docs/03_开发计划/m-archive.md"
  ]);
});

test("browser projection · 多级目录按完整父目录兜底不丢文档", () => {
  const { groups } = projectDocumentBrowser([
    doc({ path: "docs/.ccb/state/runtime.md", kind: "state" }),
    doc({ path: "docs/.ccb/state/anchor.md", kind: "state" }),
    doc({ path: "docs/release-notes/v1.md", kind: "other" })
  ]);

  expect(groups.map((group) => group.directory)).toEqual(["docs/.ccb/state", "docs/release-notes"]);
  expect(groups[0].documents.map((document) => document.path)).toEqual([
    "docs/.ccb/state/anchor.md",
    "docs/.ccb/state/runtime.md"
  ]);
});

test("browser projection · 空输入安全", () => {
  expect(projectDocumentBrowser([])).toEqual({ groups: [] });
});
