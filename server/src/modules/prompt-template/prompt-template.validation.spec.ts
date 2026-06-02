import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { resolve } from "node:path";
import { promisify } from "node:util";

import { test } from "vitest";
import { resolveCcbProjectRoot } from "../../lib/project-root.js";

const execFileAsync = promisify(execFile);
const scriptPath = resolve(process.cwd(), "scripts/validate-prompt-template.cjs");

async function runValidator(templatePath: string) {
  return await execFileAsync("node", [scriptPath, templatePath], {
    cwd: resolveCcbProjectRoot()
  });
}

test("prompt template validator accepts executor-default template", async () => {
  const { stdout } = await runValidator("executor-default.md");

  assert.match(stdout, /VALID/);
  assert.match(stdout, /executor-default/);
});

test("prompt template validator accepts reviewer-default template", async () => {
  const { stdout } = await runValidator("reviewer-default.md");

  assert.match(stdout, /VALID/);
  assert.match(stdout, /reviewer-default/);
});

test("prompt template validator rejects fixture without frontmatter", async () => {
  await assert.rejects(
    runValidator("invalid-missing-frontmatter.md"),
    (error: unknown) => {
      const failure = error as { code?: number; stderr?: string };
      assert.notEqual(failure.code, 0);
      assert.match(String(failure.stderr), /frontmatter/i);
      return true;
    }
  );
});
