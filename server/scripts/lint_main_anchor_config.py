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
MIN_SLOT_COUNT = 1
MAX_SLOT_COUNT = 16
EXPECTED_MAIN_WINDOW = "main_claude:claude; main_codex:codex"
EXPECTED_MAIN_AGENTS = {
    "main_claude": "claude",
    "main_codex": "codex",
}


def _expected_windows(slot_count: int) -> dict[str, str]:
    return {
        "main": EXPECTED_MAIN_WINDOW,
        **{
            f"slot-{index}": f"slot{index}_claude:claude; slot{index}_codex:codex"
            for index in range(1, slot_count + 1)
        },
    }


def _expected_agents(slot_count: int) -> dict[str, str]:
    agents = dict(EXPECTED_MAIN_AGENTS)
    for index in range(1, slot_count + 1):
        agents[f"slot{index}_claude"] = "claude"
        agents[f"slot{index}_codex"] = "codex"
    return agents


def _infer_slot_count(windows: object) -> tuple[int | None, str | None]:
    if not isinstance(windows, dict):
        return None, "[windows] table is required"
    if windows.get("main") != EXPECTED_MAIN_WINDOW:
        return None, f"[windows].main must be {EXPECTED_MAIN_WINDOW!r}"

    slot_indexes: list[int] = []
    for name in windows:
        if name == "main":
            continue
        if not name.startswith("slot-"):
            return None, f"[windows] contains unmanaged window {name!r}"
        suffix = name.removeprefix("slot-")
        if not suffix.isdigit():
            return None, f"[windows] contains invalid slot window {name!r}"
        slot_indexes.append(int(suffix))

    if not slot_indexes:
        return None, "[windows] must contain at least one business slot"
    slot_count = max(slot_indexes)
    if slot_count < MIN_SLOT_COUNT or slot_count > MAX_SLOT_COUNT:
        return None, f"slot count must be between {MIN_SLOT_COUNT} and {MAX_SLOT_COUNT}"
    expected_indexes = list(range(1, slot_count + 1))
    if sorted(slot_indexes) != expected_indexes:
        return None, f"[windows] slot windows must be contiguous slot-1..slot-{slot_count}"

    expected = _expected_windows(slot_count)
    if windows != expected:
        return None, f"[windows] must be main plus contiguous slot-1..slot-{slot_count}: {expected}"
    return slot_count, None


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
    slot_count, windows_error = _infer_slot_count(config.get("windows"))
    if windows_error:
        return fail(windows_error)
    assert slot_count is not None
    expected_agents = _expected_agents(slot_count)

    agents = config.get("agents")
    if not isinstance(agents, dict):
        return fail("[agents] table is required")
    agent_names = set(agents)
    if agent_names != set(expected_agents):
        return fail(f"managed agents must be exactly {sorted(expected_agents)}")

    for agent_name, provider in expected_agents.items():
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
