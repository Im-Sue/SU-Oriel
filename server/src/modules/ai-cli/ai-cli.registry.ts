import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { delimiter, isAbsolute } from "node:path";

import type { AiCliToolDefinition, AiCliToolId } from "./ai-cli.types.js";
import { AI_CLI_TOOLS } from "./ai-cli.types.js";

export const AI_CLI_TOOL_DEFINITIONS: Record<AiCliToolId, AiCliToolDefinition> = {
  claude: {
    id: "claude",
    name: "Claude Code",
    defaultCommand: "claude",
    defaultArgs: [],
    installHint: "https://docs.claude.com/en/docs/claude-code"
  },
  codex: {
    id: "codex",
    name: "Codex CLI",
    defaultCommand: "codex",
    defaultArgs: [],
    installHint: "https://github.com/openai/codex"
  },
  gemini: {
    id: "gemini",
    name: "Gemini CLI",
    defaultCommand: "gemini",
    defaultArgs: [],
    installHint: "https://github.com/google-gemini/gemini-cli"
  }
};

export function isAiCliToolId(value: unknown): value is AiCliToolId {
  return typeof value === "string" && (AI_CLI_TOOLS as readonly string[]).includes(value);
}

const PATHEXT = (process.env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD").split(";").filter(Boolean);

/**
 * 在 PATH 里查找命令的绝对路径。Windows 上额外尝试 PATHEXT 后缀。
 * 返回 null 表示未找到（按钮置灰、提示安装）。
 */
export function resolveExecutable(command: string): string | null {
  if (!command || command.includes("\u0000")) {
    return null;
  }

  if (isAbsolute(command) || command.startsWith("./") || command.startsWith("../") || command.startsWith(".\\") || command.startsWith("..\\")) {
    return existsSync(command) ? command : tryWithExtensions(command);
  }

  const pathEntries = (process.env.PATH ?? "").split(delimiter).filter(Boolean);
  for (const entry of pathEntries) {
    const candidate = entry.endsWith("/") || entry.endsWith("\\") ? `${entry}${command}` : `${entry}${process.platform === "win32" ? "\\" : "/"}${command}`;
    if (existsSync(candidate)) {
      return candidate;
    }
    const withExt = tryWithExtensions(candidate);
    if (withExt) {
      return withExt;
    }
  }

  return tryWhich(command);
}

function tryWithExtensions(basePath: string): string | null {
  if (process.platform !== "win32") {
    return null;
  }

  for (const ext of PATHEXT) {
    const candidate = basePath + ext.toLowerCase();
    if (existsSync(candidate)) {
      return candidate;
    }
    const upper = basePath + ext.toUpperCase();
    if (existsSync(upper)) {
      return upper;
    }
  }
  return null;
}

function tryWhich(command: string): string | null {
  try {
    const probe = process.platform === "win32"
      ? spawnSync("where", [command], { encoding: "utf8" })
      : spawnSync("which", [command], { encoding: "utf8" });
    if (probe.status === 0) {
      const first = probe.stdout.split(/\r?\n/).map((line) => line.trim()).find(Boolean);
      return first ?? null;
    }
  } catch {
    return null;
  }
  return null;
}
