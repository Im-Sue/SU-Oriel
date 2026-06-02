const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const FAILURE_MARKER = "node-pty linux-x64 native build failed";

function fail(message, result) {
  console.error(`${FAILURE_MARKER}: ${message}`);
  if (result?.error) {
    console.error(result.error.message);
  }
  process.exit(result?.status || 1);
}

function commandExists(command) {
  const result = spawnSync("/bin/sh", ["-lc", `command -v ${command}`], {
    encoding: "utf8"
  });
  return result.status === 0;
}

function resolveNodePtyDir() {
  try {
    return path.dirname(require.resolve("node-pty/package.json", { paths: [process.cwd()] }));
  } catch {
    fail("node-pty package not found under server workspace");
  }
}

function hasNativeBinding(nodePtyDir) {
  const releaseBinding = path.join(nodePtyDir, "build", "Release", "pty.node");
  const prebuildBinding = path.join(nodePtyDir, "prebuilds", `${process.platform}-${process.arch}`, "pty.node");
  return fs.existsSync(releaseBinding) || fs.existsSync(prebuildBinding);
}

if (process.platform !== "linux") {
  console.log("node-pty native rebuild skipped: non-linux platform");
  process.exit(0);
}

const nodePtyDir = resolveNodePtyDir();

if (hasNativeBinding(nodePtyDir)) {
  console.log("node-pty native binding already present");
  process.exit(0);
}

const missingTools = ["gcc", "g++", "make", "python3"].filter((tool) => !commandExists(tool));
if (missingTools.length > 0) {
  fail(`missing build tools: ${missingTools.join(", ")}. Install build-essential and python3, then rerun pnpm install.`);
}

console.log(`node-pty native binding missing; rebuilding in ${nodePtyDir}`);
const rebuild = spawnSync("npm", ["exec", "--yes", "node-gyp", "--", "rebuild"], {
  cwd: nodePtyDir,
  stdio: "inherit"
});

if (rebuild.error || rebuild.status !== 0) {
  fail("node-gyp rebuild exited non-zero. Install build-essential and python3, then rerun pnpm install.", rebuild);
}

if (!hasNativeBinding(nodePtyDir)) {
  fail("node-gyp rebuild completed but build/Release/pty.node is still missing");
}

console.log("node-pty native binding rebuilt");
