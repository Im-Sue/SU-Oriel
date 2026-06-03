#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

echo "[SU-Oriel] 正在启动前端开发服务..."
cd "$PROJECT_ROOT"
exec pnpm --filter su-oriel-web dev
