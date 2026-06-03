#!/usr/bin/env python3
from __future__ import annotations

import sys
import tomllib
from pathlib import Path


def _resolve_project_root() -> Path:
    """动态解析被观测项目根：CCB_PROJECT_ROOT 优先，否则从脚本位置向上发现含 .ccb 的目录。
    不依赖固定目录深度，避免 multi-repo 拆分后 parents[N] overshoot。"""
    import os

    env_root = os.environ.get("CCB_PROJECT_ROOT")
    if env_root:
        return Path(env_root).resolve()
    current = Path(__file__).resolve().parent
    while True:
        if (current / ".ccb").exists():
            return current
        if current.parent == current:
            return Path(__file__).resolve().parents[3]
        current = current.parent


REPO_ROOT = _resolve_project_root()
CONFIG_PATH = REPO_ROOT / ".ccb" / "ccb.config"
EXPECTED_DEFAULT_AGENTS = ["ccb_claude", "ccb_codex"]
EXPECTED_LAYOUT = "cmd, (ccb_claude:claude; ccb_codex:codex)"
EXPECTED_WINDOWS = {
    "main": "main_claude:claude; main_codex:codex",
    "slot-1": "slot1_claude:claude; slot1_codex:codex",
    "slot-2": "slot2_claude:claude; slot2_codex:codex",
    "slot-3": "slot3_claude:claude; slot3_codex:codex",
}
EXPECTED_AGENTS = {
    "main_claude": "claude",
    "main_codex": "codex",
    "slot1_claude": "claude",
    "slot1_codex": "codex",
    "slot2_claude": "claude",
    "slot2_codex": "codex",
    "slot3_claude": "claude",
    "slot3_codex": "codex",
}


def fail(message: str) -> int:
    print(f"main anchor config lint failed: {message}", file=sys.stderr)
    return 1


def main() -> int:
    if not CONFIG_PATH.exists():
        return fail(f"missing {CONFIG_PATH}")

    raw = CONFIG_PATH.read_text(encoding="utf-8")
    if "task_auto_" in raw:
        return fail("task_auto_* agents are forbidden in the main anchor")

    try:
        config = tomllib.loads(raw)
    except tomllib.TOMLDecodeError as exc:
        return fail(f"invalid TOML: {exc}")

    if "cmd_enabled" in config or "default_agents" in config or "layout" in config:
        return fail("legacy cmd_enabled/default_agents/layout fields are forbidden with v7 [windows]")
    if config.get("version") != 2:
        return fail("version must be 2")
    if config.get("entry_window") != "main":
        return fail("entry_window must be main")
    windows = config.get("windows")
    if windows != EXPECTED_WINDOWS:
        return fail(f"[windows] must be main plus slot-1..slot-3: {EXPECTED_WINDOWS}")

    agents = config.get("agents")
    if not isinstance(agents, dict):
        return fail("[agents] table is required")
    agent_names = set(agents)
    if agent_names != set(EXPECTED_AGENTS):
        return fail(f"managed agents must be exactly {sorted(EXPECTED_AGENTS)}")

    for agent_name, provider in EXPECTED_AGENTS.items():
        agent = agents.get(agent_name)
        if not isinstance(agent, dict):
            return fail(f"agent {agent_name} must be a table")
        if agent.get("provider") != provider:
            return fail(f"{agent_name}.provider must be {provider}")
        if agent.get("target") != ".":
            return fail(f"{agent_name}.target must be '.'")
        if agent.get("workspace_mode") != "inplace":
            return fail(f"{agent_name}.workspace_mode must be inplace")
        if agent.get("runtime_mode") != "pane-backed":
            return fail(f"{agent_name}.runtime_mode must be pane-backed")
        if agent.get("queue_policy") != "serial-per-agent":
            return fail(f"{agent_name}.queue_policy must be serial-per-agent")

    print("main anchor config lint passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
