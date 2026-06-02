#!/usr/bin/env node

const { existsSync, readFileSync } = require("node:fs");
const { basename, dirname, join, resolve } = require("node:path");

const REQUIRED_FRONTMATTER_FIELDS = ["template_id", "variables", "supported_tools", "version"];
const REQUIRED_VARIABLE_FIELDS = ["required", "type", "default", "description"];

// projectRoot 数据：prompt 模板属于被观测项目。CCB_PROJECT_ROOT 优先，否则从脚本位置向上发现含 .ccb 的目录，
// 不依赖固定目录深度（避免 multi-repo 拆分后 ../../../../ overshoot）。
function findProjectRoot() {
  if (process.env.CCB_PROJECT_ROOT) return resolve(process.env.CCB_PROJECT_ROOT);
  let current = __dirname;
  while (true) {
    if (existsSync(join(current, ".ccb"))) return current;
    const parent = dirname(current);
    if (parent === current) return resolve(__dirname, "../../../");
    current = parent;
  }
}
const PROMPT_ROOT = resolve(findProjectRoot(), "docs/.ccb/templates/prompts");

function resolveTemplatePath(input) {
  const candidates = [
    resolve(process.cwd(), input),
    resolve(PROMPT_ROOT, input),
    resolve(PROMPT_ROOT, "__fixtures__", input)
  ];
  const found = candidates.find((candidate) => existsSync(candidate));
  if (!found) {
    throw new Error(`template file not found: ${input}`);
  }
  return found;
}

function extractFrontmatter(content) {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!match) {
    throw new Error("missing YAML frontmatter");
  }
  return match[1];
}

function hasTopLevelField(frontmatter, field) {
  return new RegExp(`^${field}:`, "m").test(frontmatter);
}

function parseScalar(frontmatter, field) {
  const match = frontmatter.match(new RegExp(`^${field}:\\s*(.+?)\\s*$`, "m"));
  return match ? match[1].replace(/^["']|["']$/g, "") : "";
}

function parseList(frontmatter, field) {
  const lines = frontmatter.split(/\r?\n/);
  const start = lines.findIndex((line) => line === `${field}:`);
  if (start === -1) {
    return [];
  }
  const values = [];
  for (const line of lines.slice(start + 1)) {
    if (/^[A-Za-z0-9_-]+:/.test(line)) {
      break;
    }
    const match = line.match(/^  -\s+(.+?)\s*$/);
    if (match) {
      values.push(match[1].replace(/^["']|["']$/g, ""));
    }
  }
  return values;
}

function parseVariableBlocks(frontmatter) {
  const lines = frontmatter.split(/\r?\n/);
  const start = lines.findIndex((line) => line === "variables:");
  if (start === -1) {
    return new Map();
  }
  const blocks = new Map();
  let currentName = null;
  let currentLines = [];

  for (const line of lines.slice(start + 1)) {
    if (/^[A-Za-z0-9_-]+:/.test(line)) {
      break;
    }
    const variableMatch = line.match(/^  ([A-Za-z0-9_-]+):\s*$/);
    if (variableMatch) {
      if (currentName) {
        blocks.set(currentName, currentLines);
      }
      currentName = variableMatch[1];
      currentLines = [];
      continue;
    }
    if (currentName) {
      currentLines.push(line);
    }
  }
  if (currentName) {
    blocks.set(currentName, currentLines);
  }
  return blocks;
}

function validateTemplate(templatePath) {
  const content = readFileSync(templatePath, "utf8");
  const frontmatter = extractFrontmatter(content);
  const missingFields = REQUIRED_FRONTMATTER_FIELDS.filter((field) => !hasTopLevelField(frontmatter, field));
  if (missingFields.length > 0) {
    throw new Error(`missing required frontmatter fields: ${missingFields.join(", ")}`);
  }

  const templateId = parseScalar(frontmatter, "template_id");
  if (!/^[a-z0-9][a-z0-9-]*$/.test(templateId)) {
    throw new Error("template_id must be a lowercase kebab-case string");
  }
  if (parseScalar(frontmatter, "version") !== "prompt-template-v0.1") {
    throw new Error("version must be prompt-template-v0.1");
  }
  if (parseList(frontmatter, "supported_tools").length === 0) {
    throw new Error("supported_tools must contain at least one tool");
  }

  const variableBlocks = parseVariableBlocks(frontmatter);
  if (variableBlocks.size === 0) {
    throw new Error("variables must contain at least one variable schema");
  }
  for (const [name, lines] of variableBlocks) {
    const missingVariableFields = REQUIRED_VARIABLE_FIELDS.filter((field) => {
      return !lines.some((line) => new RegExp(`^    ${field}:`).test(line));
    });
    if (missingVariableFields.length > 0) {
      throw new Error(`variable ${name} missing fields: ${missingVariableFields.join(", ")}`);
    }
  }

  return { templateId, templatePath };
}

function main() {
  const input = process.argv[2];
  if (!input) {
    throw new Error(`usage: node ${basename(process.argv[1])} <template.md>`);
  }
  const result = validateTemplate(resolveTemplatePath(input));
  process.stdout.write(`VALID ${result.templateId} ${result.templatePath}\n`);
}

try {
  main();
} catch (error) {
  process.stderr.write(`INVALID prompt template: ${error.message}\n`);
  process.exit(1);
}
