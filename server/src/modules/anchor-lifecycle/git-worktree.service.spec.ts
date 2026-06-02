import assert from "node:assert/strict";
import { test } from "vitest";

import { GitWorktreeService } from "./git-worktree.service.js";

test("add creates a sibling task branch worktree from HEAD when branch is new", async () => {
  const calls: unknown[] = [];
  const service = new GitWorktreeService({
    runGit: async (repoRoot, args) => {
      calls.push({ repoRoot, args });
      return { stdout: "", stderr: "" };
    }
  });

  const result = await service.add({
    repoRoot: "/repo/main",
    anchorPath: "/repo-task-epic-1",
    epicTaskId: "epic 1"
  });

  assert.deepEqual(result, {
    anchorPath: "/repo-task-epic-1",
    branch: "task/epic-1"
  });
  assert.deepEqual(calls, [
    {
      repoRoot: "/repo/main",
      args: ["branch", "--list", "task/epic-1"]
    },
    {
      repoRoot: "/repo/main",
      args: ["worktree", "add", "-b", "task/epic-1", "/repo-task-epic-1", "HEAD"]
    }
  ]);
});

test("add attaches existing branch instead of recreating it (idempotent retry)", async () => {
  const calls: unknown[] = [];
  const service = new GitWorktreeService({
    runGit: async (repoRoot, args) => {
      calls.push({ repoRoot, args });
      if (args[0] === "branch" && args[1] === "--list") {
        return { stdout: "  task/epic-1\n", stderr: "" };
      }
      return { stdout: "", stderr: "" };
    }
  });

  const result = await service.add({
    repoRoot: "/repo/main",
    anchorPath: "/repo-task-epic-1",
    epicTaskId: "epic 1"
  });

  assert.deepEqual(result, {
    anchorPath: "/repo-task-epic-1",
    branch: "task/epic-1"
  });
  assert.deepEqual(calls, [
    {
      repoRoot: "/repo/main",
      args: ["branch", "--list", "task/epic-1"]
    },
    {
      repoRoot: "/repo/main",
      args: ["worktree", "add", "/repo-task-epic-1", "task/epic-1"]
    }
  ]);
});

test("removeBranch invokes git branch -D", async () => {
  const calls: unknown[] = [];
  const service = new GitWorktreeService({
    runGit: async (repoRoot, args) => {
      calls.push({ repoRoot, args });
      return { stdout: "", stderr: "" };
    }
  });

  await service.removeBranch("/repo/main", "task/epic-1");

  assert.deepEqual(calls, [
    { repoRoot: "/repo/main", args: ["branch", "-D", "task/epic-1"] }
  ]);
});

test("list parses git worktree porcelain output", async () => {
  const service = new GitWorktreeService({
    runGit: async () => ({
      stdout: [
        "worktree /repo/main",
        "HEAD abc",
        "branch refs/heads/main",
        "",
        "worktree /repo-task-epic-1",
        "HEAD def",
        "branch refs/heads/task/epic-1",
        ""
      ].join("\n"),
      stderr: ""
    })
  });

  assert.deepEqual(await service.list("/repo/main"), [
    { path: "/repo/main", branch: "main" },
    { path: "/repo-task-epic-1", branch: "task/epic-1" }
  ]);
});

test("remove and clean call git worktree cleanup commands", async () => {
  const calls: unknown[] = [];
  const service = new GitWorktreeService({
    runGit: async (repoRoot, args) => {
      calls.push({ repoRoot, args });
      return { stdout: "", stderr: "" };
    }
  });

  await service.remove({ repoRoot: "/repo/main", anchorPath: "/repo-task-epic-1", force: true });
  await service.clean("/repo/main");

  assert.deepEqual(calls, [
    { repoRoot: "/repo/main", args: ["worktree", "remove", "--force", "/repo-task-epic-1"] },
    { repoRoot: "/repo/main", args: ["worktree", "prune"] }
  ]);
});

