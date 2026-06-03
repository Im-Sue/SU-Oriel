import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createHash, randomUUID } from "node:crypto";

export const MANAGED_WINDOW_NAMES = ["main", "slot-1", "slot-2", "slot-3"] as const;
export const MANAGED_AGENT_NAMES = [
  "main_claude",
  "main_codex",
  "slot1_claude",
  "slot1_codex",
  "slot2_claude",
  "slot2_codex",
  "slot3_claude",
  "slot3_codex",
] as const;

export const MANAGED_CCB_CONFIG_RELATIVE_PATH = join(".ccb", "ccb.config");

export type ManagedCcbConfigRenderInput = {
  projectId: string;
  projectRoot: string;
  existingConfigText?: string | null;
  sidebarViewTips?: readonly string[] | null;
};

export type ManagedCcbConfigRenderOptions = {
  sidebarViewTips?: readonly string[] | null;
};

export type ManagedCcbConfigDrift = {
  kind: "missing" | "core_drift" | "invalid_windows_topology";
  diff: string;
  requiresUserConfirmation: boolean;
};

export type ManagedCcbConfigRenderResult = {
  configText: string;
  coreSignature: string;
  drift: ManagedCcbConfigDrift | null;
};

type ManagedAgentName = (typeof MANAGED_AGENT_NAMES)[number];

type AgentCore = {
  provider: "claude" | "codex";
  windowName: string;
};

const AGENT_CORE: Record<ManagedAgentName, AgentCore> = {
  main_claude: { provider: "claude", windowName: "main" },
  main_codex: { provider: "codex", windowName: "main" },
  slot1_claude: { provider: "claude", windowName: "slot-1" },
  slot1_codex: { provider: "codex", windowName: "slot-1" },
  slot2_claude: { provider: "claude", windowName: "slot-2" },
  slot2_codex: { provider: "codex", windowName: "slot-2" },
  slot3_claude: { provider: "claude", windowName: "slot-3" },
  slot3_codex: { provider: "codex", windowName: "slot-3" }
};

const CLAUDE_AGENT_DEFAULTS = {
  model: '"opus[1m]"',
  startup_args: '["--effort", "max"]'
};

const NON_CORE_AGENT_KEYS = new Set([
  "model",
  "startup_args",
  "display_label",
  "profile",
  "auth_profile",
  "theme",
  "log_level"
]);

export function buildManagedCcbConfig(
  preservedAgentFields: Record<string, Record<string, string>> = {},
  options: ManagedCcbConfigRenderOptions = {}
): string {
  const lines = [
    "version = 2",
    'entry_window = "main"',
    "",
    "[windows]",
    'main = "main_claude:claude; main_codex:codex"',
    'slot-1 = "slot1_claude:claude; slot1_codex:codex"',
    'slot-2 = "slot2_claude:claude; slot2_codex:codex"',
    'slot-3 = "slot3_claude:claude; slot3_codex:codex"',
    "",
    "[ui.sidebar]",
    'mode = "every_window"',
    'width = "15%"',
    "bottom_height = 20",
    ""
  ];

  if (options.sidebarViewTips) {
    lines.push("[ui.sidebar.view]", "tips_enabled = true", ...renderTomlStringArray("tips", options.sidebarViewTips), "");
  }

  for (const agentName of MANAGED_AGENT_NAMES) {
    const core = AGENT_CORE[agentName];
    lines.push(
      `[agents.${agentName}]`,
      `provider = "${core.provider}"`,
      'target = "."',
      'workspace_mode = "inplace"',
      'runtime_mode = "pane-backed"',
      'restore = "auto"',
      'permission = "manual"',
      'queue_policy = "serial-per-agent"'
    );
    const preserved = preservedAgentFields[agentName] ?? {};
    const agentDefaults = core.provider === "claude" ? CLAUDE_AGENT_DEFAULTS : {};
    const nonCoreFields = { ...agentDefaults, ...preserved };
    for (const [key, value] of Object.entries(nonCoreFields)) {
      lines.push(`${key} = ${value}`);
    }
    lines.push("");
  }

  return `${lines.join("\n").trimEnd()}\n`;
}

export function renderManagedCcbConfig(input: ManagedCcbConfigRenderInput): ManagedCcbConfigRenderResult {
  const preserved = collectPreservedAgentFields(input.existingConfigText ?? "");
  const configText = buildManagedCcbConfig(preserved, { sidebarViewTips: input.sidebarViewTips });
  const coreSignature = computeManagedCoreSignature(configText);
  const existingText = input.existingConfigText?.trim() ? input.existingConfigText : null;

  if (!existingText) {
    return {
      configText,
      coreSignature,
      drift: {
        kind: "missing",
        diff: "missing .ccb/ccb.config",
        requiresUserConfirmation: false
      }
    };
  }

  const existingSignature = computeManagedCoreSignature(existingText);
  if (existingSignature === coreSignature) {
    return {
      configText,
      coreSignature,
      drift: null
    };
  }

  const kind = hasWindowsTable(existingText) ? "core_drift" : "invalid_windows_topology";
  return {
    configText,
    coreSignature,
    drift: {
      kind,
      diff: buildCoreDiff(existingText, configText),
      requiresUserConfirmation: true
    }
  };
}

export async function ensureManagedCcbConfig(input: ManagedCcbConfigRenderInput): Promise<ManagedCcbConfigRenderResult> {
  const configPath = join(input.projectRoot, MANAGED_CCB_CONFIG_RELATIVE_PATH);
  const existingConfigText = input.existingConfigText ?? await readFile(configPath, "utf8").catch(() => null);
  const result = renderManagedCcbConfig({
    ...input,
    existingConfigText
  });

  const configDir = join(input.projectRoot, ".ccb");
  const tempPath = join(configDir, `.ccb.config.${process.pid}.${randomUUID()}.tmp`);
  await mkdir(configDir, { recursive: true });
  try {
    await writeFile(tempPath, result.configText, "utf8");
    await rename(tempPath, configPath);
  } catch (error) {
    await rm(tempPath, { force: true }).catch(() => undefined);
    throw error;
  }
  return result;
}

function renderTomlStringArray(key: string, values: readonly string[]): string[] {
  if (values.length === 0) {
    return [`${key} = []`];
  }
  return [
    `${key} = [`,
    ...values.map((value) => `  ${JSON.stringify(value)},`),
    "]"
  ];
}

function computeManagedCoreSignature(configText: string): string {
  const coreLines = collectCoreLines(configText);
  return createHash("sha256").update(coreLines.join("\n"), "utf8").digest("hex");
}

function collectCoreLines(configText: string): string[] {
  const lines = configText.split(/\r?\n/);
  const coreLines: string[] = [];
  let section = "";
  let currentAgent = "";

  for (const rawLine of lines) {
    const line = stripInlineComment(rawLine).trim();
    if (!line) continue;

    const sectionMatch = line.match(/^\[([^\]]+)]$/);
    if (sectionMatch?.[1]) {
      section = sectionMatch[1];
      currentAgent = "";
      const agentMatch = section.match(/^agents\.([A-Za-z0-9_-]+)$/);
      if (agentMatch?.[1]) {
        currentAgent = agentMatch[1];
      }
      if (section === "windows" || section === "ui.sidebar" || MANAGED_AGENT_NAMES.includes(currentAgent as ManagedAgentName)) {
        coreLines.push(`[${section}]`);
      }
      continue;
    }

    const keyMatch = line.match(/^([A-Za-z0-9_-]+)\s*=/);
    const key = keyMatch?.[1] ?? "";
    if (section === "" && ["version", "entry_window"].includes(key)) {
      coreLines.push(normalizeAssignment(line));
      continue;
    }
    if (section === "windows" && MANAGED_WINDOW_NAMES.includes(key as typeof MANAGED_WINDOW_NAMES[number])) {
      coreLines.push(normalizeAssignment(line));
      continue;
    }
    if (section === "ui.sidebar" && ["mode", "width", "bottom_height"].includes(key)) {
      coreLines.push(normalizeAssignment(line));
      continue;
    }
    if (
      currentAgent &&
      MANAGED_AGENT_NAMES.includes(currentAgent as ManagedAgentName) &&
      ["provider", "target", "workspace_mode", "runtime_mode", "restore", "permission", "queue_policy"].includes(key)
    ) {
      coreLines.push(normalizeAssignment(line));
    }
  }

  return coreLines;
}

function collectPreservedAgentFields(configText: string): Record<string, Record<string, string>> {
  const preserved: Record<string, Record<string, string>> = {};
  let currentAgent = "";
  for (const rawLine of configText.split(/\r?\n/)) {
    const line = stripInlineComment(rawLine).trim();
    const sectionMatch = line.match(/^\[agents\.([A-Za-z0-9_-]+)]$/);
    if (sectionMatch?.[1]) {
      currentAgent = sectionMatch[1];
      continue;
    }
    if (!currentAgent || !MANAGED_AGENT_NAMES.includes(currentAgent as ManagedAgentName)) {
      continue;
    }
    const assignment = line.match(/^([A-Za-z0-9_-]+)\s*=\s*(.+)$/);
    const key = assignment?.[1];
    const value = assignment?.[2];
    if (key && value && NON_CORE_AGENT_KEYS.has(key)) {
      preserved[currentAgent] ??= {};
      preserved[currentAgent][key] = value.trim();
    }
  }
  return preserved;
}

function buildCoreDiff(existingText: string, managedText: string): string {
  const existing = new Set(collectCoreLines(existingText));
  const managed = new Set(collectCoreLines(managedText));
  const missing = [...managed].filter((line) => !existing.has(line)).map((line) => `+ ${line}`);
  const extra = [...existing].filter((line) => !managed.has(line)).map((line) => `- ${line}`);
  return [...missing, ...extra].join("\n");
}

function hasWindowsTable(configText: string): boolean {
  return /^\s*\[windows]\s*$/m.test(configText);
}

function normalizeAssignment(line: string): string {
  return line.replace(/\s*=\s*/, " = ").trim();
}

function stripInlineComment(line: string): string {
  let quoted = false;
  let quote = "";
  for (let index = 0; index < line.length; index++) {
    const char = line[index];
    if ((char === "\"" || char === "'") && (index === 0 || line[index - 1] !== "\\")) {
      if (!quoted) {
        quoted = true;
        quote = char;
      } else if (quote === char) {
        quoted = false;
        quote = "";
      }
      continue;
    }
    if (char === "#" && !quoted) {
      return line.slice(0, index);
    }
  }
  return line;
}
