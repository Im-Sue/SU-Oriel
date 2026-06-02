import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { appendFile, mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export class GitWorktreeError extends Error {
  constructor(
    message: string,
    public readonly stderr = ""
  ) {
    super(message);
  }
}

export function assertGitRepository(projectRoot: string): void {
  if (!existsSync(join(projectRoot, ".git"))) {
    throw new GitWorktreeError("项目不是 Git repository，无法创建 worktree");
  }
}

export async function prepareWorktreeRoot(projectRoot: string): Promise<string> {
  const workspaceRoot = join(projectRoot, ".workspaces");
  await mkdir(workspaceRoot, { recursive: true });
  await ensureGitignoreEntry(projectRoot);
  return workspaceRoot;
}

export async function addWorktree(input: {
  cwd: string;
  workspacePath: string;
  branchName: string;
  baseRef: string;
}): Promise<void> {
  await runGit(input.cwd, ["worktree", "add", "-b", input.branchName, input.workspacePath, input.baseRef]);
}

export async function removeWorktree(input: { cwd: string; workspacePath: string }): Promise<void> {
  if (!existsSync(input.workspacePath)) {
    return;
  }

  await runGit(input.cwd, ["worktree", "remove", "--force", input.workspacePath]);
}

async function runGit(cwd: string, args: string[]): Promise<string> {
  try {
    const { stdout } = await execFileAsync("git", args, {
      cwd,
      windowsHide: true
    });
    return String(stdout);
  } catch (error) {
    const stderr = readProcessText(error, "stderr");
    const stdout = readProcessText(error, "stdout");
    throw new GitWorktreeError((stderr || stdout || "Git worktree 命令执行失败").trim(), stderr);
  }
}

async function ensureGitignoreEntry(projectRoot: string): Promise<void> {
  const gitignorePath = join(projectRoot, ".gitignore");
  const entry = ".workspaces/";

  try {
    const content = await readFile(gitignorePath, "utf8");
    if (content.split(/\r?\n/).some((line) => line.trim() === entry)) {
      return;
    }
    await appendFile(gitignorePath, `${content.endsWith("\n") ? "" : "\n"}${entry}\n`, "utf8");
  } catch {
    await appendFile(gitignorePath, `${entry}\n`, "utf8");
  }
}

function readProcessText(error: unknown, key: "stdout" | "stderr"): string {
  if (typeof error === "object" && error !== null && key in error) {
    const value = (error as Record<string, unknown>)[key];
    return typeof value === "string" ? value : "";
  }
  return "";
}
