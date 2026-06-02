// Split markdown by H2 headings into sections.
// Each section starts at a `## ` line and ends at the next `## ` (or EOF).
// The pre-amble before the first H2 is returned as `preamble`.

export interface MarkdownSection {
  title: string;
  body: string;
  emoji?: string;
}

const EMOJI_BY_TITLE: Array<[RegExp, string]> = [
  [/^(背景|context|background)/i, "📖"],
  [/^(决策|decision)/i, "📋"],
  [/^(设计原则|principle|原则)/i, "🎯"],
  [/^(字段|权限|field|ownership)/i, "🔐"],
  [/^(切分|拆分|概览|overview|breakdown)/i, "📊"],
  [/^(验收|acceptance)/i, "✅"],
  [/^(范围外|out\s*of\s*scope|不做|nongoals?)/i, "⚠️"],
  [/^(目标|goal|objective)/i, "🎯"],
  [/^(范围|scope)/i, "📐"],
  [/^(数据模型|schema|model)/i, "💾"],
  [/^(api|接口)/i, "🔌"],
  [/^(primitive|逻辑|流程|flow)/i, "⚙️"],
  [/^(矩阵|matrix)/i, "📑"],
  [/^(边界|boundary|限制)/i, "🚧"],
  [/^(依赖|dependenc)/i, "🔗"],
  [/^(风险|risk)/i, "⚠️"],
  [/^(测试|test)/i, "🧪"],
  [/^(部署|deploy|rollout)/i, "🚀"],
  [/^(参考|reference|ref)/i, "🔖"]
];

function emojiFor(title: string): string | undefined {
  const trimmed = title.trim();
  for (const [pattern, emoji] of EMOJI_BY_TITLE) {
    if (pattern.test(trimmed)) return emoji;
  }
  return undefined;
}

function stripLeadingHashes(line: string): string {
  return line.replace(/^#{1,6}\s*/, "").replace(/^\d+\.?\s*/, "").trim();
}

export function splitByH2(markdown: string): { preamble: string; sections: MarkdownSection[] } {
  if (!markdown || !markdown.trim()) {
    return { preamble: "", sections: [] };
  }

  const lines = markdown.split("\n");
  const sections: MarkdownSection[] = [];
  let currentTitle: string | null = null;
  let currentBuffer: string[] = [];
  let preambleBuffer: string[] = [];
  let inCodeFence = false;

  const flush = () => {
    if (currentTitle === null) return;
    sections.push({
      title: currentTitle,
      body: currentBuffer.join("\n").trim(),
      emoji: emojiFor(currentTitle)
    });
    currentBuffer = [];
  };

  for (const line of lines) {
    if (/^```/.test(line)) {
      inCodeFence = !inCodeFence;
    }
    if (!inCodeFence && /^##\s+/.test(line)) {
      flush();
      currentTitle = stripLeadingHashes(line);
      continue;
    }
    if (currentTitle === null) {
      preambleBuffer.push(line);
    } else {
      currentBuffer.push(line);
    }
  }
  flush();

  return {
    preamble: preambleBuffer.join("\n").trim(),
    sections
  };
}

// Best-effort detection of a markdown table block at the start of `body`.
// Returns rows (header + body) or null if no table found.
export function extractFirstTable(body: string): { rows: string[][]; rest: string } | null {
  const lines = body.split("\n");
  let startIdx = -1;
  for (let i = 0; i < lines.length; i += 1) {
    if (/^\s*\|.*\|\s*$/.test(lines[i]) && i + 1 < lines.length && /^\s*\|[\s:\-|]+\|\s*$/.test(lines[i + 1])) {
      startIdx = i;
      break;
    }
  }
  if (startIdx === -1) return null;

  const tableLines: string[] = [];
  let endIdx = startIdx;
  for (let i = startIdx; i < lines.length; i += 1) {
    if (/^\s*\|.*\|\s*$/.test(lines[i])) {
      tableLines.push(lines[i]);
      endIdx = i;
    } else if (i > startIdx + 1) {
      break;
    }
  }

  // Remove separator row (the |---|---| line)
  const rows = tableLines
    .filter((_, idx) => idx !== 1)
    .map((row) =>
      row
        .trim()
        .replace(/^\||\|$/g, "")
        .split("|")
        .map((cell) => cell.trim())
    );

  const restLines = [...lines.slice(0, startIdx), ...lines.slice(endIdx + 1)];
  return { rows, rest: restLines.join("\n").trim() };
}
