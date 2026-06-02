import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export async function isWorktreeDirty(projectRoot: string = process.cwd()): Promise<boolean> {
  const { stdout } = await execFileAsync("git", ["-C", projectRoot, "status", "--short"]);
  return stdout.trim().length > 0;
}
