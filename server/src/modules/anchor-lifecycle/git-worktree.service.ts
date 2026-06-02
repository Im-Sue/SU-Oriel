import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type GitCommandResult = {
  stdout: string;
  stderr: string;
};

export type RunGit = (repoRoot: string, args: string[]) => Promise<GitCommandResult>;

export type AddWorktreeInput = {
  repoRoot: string;
  anchorPath: string;
  epicTaskId?: string;
  subjectId?: string;
  fromRef?: string;
  branch?: string;
};

export type RemoveWorktreeInput = {
  repoRoot: string;
  anchorPath: string;
  force?: boolean;
};

export type AnchorWorktree = {
  anchorPath: string;
  branch: string;
};

export type WorktreeListItem = {
  path: string;
  branch: string | null;
};

export class GitWorktreeService {
  private readonly runGitCommand: RunGit;

  constructor(options: { runGit?: RunGit } = {}) {
    this.runGitCommand =
      options.runGit ??
      (async (repoRoot, args) => await execFileAsync("git", ["-C", repoRoot, ...args]));
  }

  async add(input: AddWorktreeInput): Promise<AnchorWorktree> {
    const branch = input.branch ?? buildAnchorBranch(input.subjectId ?? input.epicTaskId ?? "anchor");
    const branchExists = await this.branchExists(input.repoRoot, branch);
    if (branchExists) {
      await this.runGitCommand(input.repoRoot, [
        "worktree",
        "add",
        input.anchorPath,
        branch
      ]);
    } else {
      await this.runGitCommand(input.repoRoot, [
        "worktree",
        "add",
        "-b",
        branch,
        input.anchorPath,
        input.fromRef ?? "HEAD"
      ]);
    }
    return {
      anchorPath: input.anchorPath,
      branch
    };
  }

  async remove(input: RemoveWorktreeInput): Promise<void> {
    const args = ["worktree", "remove"];
    if (input.force) {
      args.push("--force");
    }
    args.push(input.anchorPath);
    await this.runGitCommand(input.repoRoot, args);
  }

  async removeBranch(repoRoot: string, branch: string): Promise<void> {
    await this.runGitCommand(repoRoot, ["branch", "-D", branch]);
  }

  private async branchExists(repoRoot: string, branch: string): Promise<boolean> {
    try {
      const { stdout } = await this.runGitCommand(repoRoot, ["branch", "--list", branch]);
      return stdout.trim().length > 0;
    } catch {
      return false;
    }
  }

  async clean(repoRoot: string): Promise<void> {
    await this.runGitCommand(repoRoot, ["worktree", "prune"]);
  }

  async list(repoRoot: string): Promise<WorktreeListItem[]> {
    const { stdout } = await this.runGitCommand(repoRoot, ["worktree", "list", "--porcelain"]);
    return parseWorktreePorcelain(stdout);
  }

  /**
   * 检查 worktree 是否有 uncommitted 改动（含 staged + unstaged + untracked）。
   * 用于 anchor 销毁前的 dirty guard：dirty=true 时 UI 应展示警示，避免丢失工作。
   */
  async isDirty(anchorPath: string): Promise<boolean> {
    try {
      const { stdout } = await this.runGitCommand(anchorPath, ["status", "--porcelain"]);
      return stdout.trim().length > 0;
    } catch {
      // worktree 不存在或 git 命令失败 → 视为"未知"，让上游决定
      return false;
    }
  }
}

export function buildAnchorBranch(epicTaskId: string): string {
  return `task/${slugify(epicTaskId)}`;
}

function slugify(value: string): string {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "anchor";
}

export function parseWorktreePorcelain(value: string): WorktreeListItem[] {
  const items: WorktreeListItem[] = [];
  let current: WorktreeListItem | null = null;

  for (const line of value.split(/\r?\n/)) {
    if (!line.trim()) {
      if (current) {
        items.push(current);
        current = null;
      }
      continue;
    }
    if (line.startsWith("worktree ")) {
      if (current) {
        items.push(current);
      }
      current = {
        path: line.slice("worktree ".length),
        branch: null
      };
      continue;
    }
    if (current && line.startsWith("branch ")) {
      current.branch = normalizeBranchRef(line.slice("branch ".length));
    }
  }

  if (current) {
    items.push(current);
  }
  return items;
}

function normalizeBranchRef(value: string): string {
  return value.replace(/^refs\/heads\//, "");
}
