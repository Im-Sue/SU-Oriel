import assert from "node:assert/strict";
import { describe, test } from "vitest";

import { evaluateTemplateConformance } from "./template-conformance.js";

describe("template conformance", () => {
  test("accepts adaptive technical_design docs with core sections only", () => {
    const warning = evaluateTemplateConformance({
      path: "docs/03_开发计划/example-技术设计.md",
      docType: "technical_design",
      content: [
        "---",
        "doc_type: technical_design",
        "---",
        "",
        "## 一、设计概述",
        "",
        "概述。",
        "",
        "## 二、方案与架构",
        "",
        "方案。",
        "",
        "## 四、核心流程 / 逻辑",
        "",
        "流程。",
        "",
        "## 五、测试策略",
        "",
        "测试。"
      ].join("\n")
    });

    assert.equal(warning, null);
  });

  test("reports missing core sections without requiring optional sections", () => {
    const warning = evaluateTemplateConformance({
      path: "docs/03_开发计划/example-技术设计.md",
      docType: "technical_design",
      content: [
        "## 一、设计概述",
        "",
        "概述。",
        "",
        "## 五、测试策略",
        "",
        "测试。"
      ].join("\n")
    });

    assert.deepEqual(warning, {
      path: "docs/03_开发计划/example-技术设计.md",
      docType: "technical_design",
      missingSections: ["二、方案与架构", "四、核心流程 / 逻辑"]
    });
  });

  test("accepts dev_task core headings and ignores deleted optional sections", () => {
    const warning = evaluateTemplateConformance({
      path: "docs/03_开发计划/example-开发任务.md",
      docType: "dev_task",
      content: [
        "## 一、任务概述",
        "",
        "概述。",
        "",
        "## 二、任务分解",
        "",
        "- [ ] 实现。",
        "",
        "## 五、验收标准",
        "",
        "- [ ] 验收。"
      ].join("\n")
    });

    assert.equal(warning, null);
  });

  test("accepts requirement projection anchor variants", () => {
    const warning = evaluateTemplateConformance({
      path: "docs/02_需求设计/example-需求.md",
      docType: "requirement",
      content: [
        "## 需求描述",
        "",
        "描述。",
        "",
        "## 原话",
        "",
        "原话。",
        "",
        "## Claude 解读（可选）",
        "",
        "解读。",
        "",
        "## 歧义点（可选）",
        "",
        "无。",
        "",
        "## 保真差异（可选）",
        "",
        "一致。"
      ].join("\n")
    });

    assert.equal(warning, null);
  });
});
