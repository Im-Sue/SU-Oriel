#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

echo "[SU-Oriel] 正在构建后端服务..."
cd "$PROJECT_ROOT"

DEV_DB_PATH="$PROJECT_ROOT/server/prisma/dev.db"

# 默认保留 dev.db；以下两种情况才执行 db:prepare（清空 + 重建 schema）：
#   1) dev.db 不存在（首次启动）
#   2) 用户显式 CCB_RESET_DB=1（schema 变更后强制 reset）
if [[ "${CCB_RESET_DB:-0}" == "1" ]] || [[ ! -f "$DEV_DB_PATH" ]]; then
  if [[ "${CCB_RESET_DB:-0}" == "1" ]]; then
    echo "[SU-Oriel] CCB_RESET_DB=1 → 清空数据库 + 重建 schema"
  else
    echo "[SU-Oriel] dev.db 不存在 → 初始化数据库"
  fi
  if ! pnpm --filter su-oriel-server db:prepare; then
    echo "后端数据库准备失败" >&2
    exit 1
  fi
else
  echo "[SU-Oriel] dev.db 已存在 → 跳过 db reset（设 CCB_RESET_DB=1 可强制重置）"
  # 仍需确保 Prisma client 与当前 schema 同步
  if ! pnpm --filter su-oriel-server prisma:generate; then
    echo "Prisma client 生成失败" >&2
    exit 1
  fi
fi

if ! pnpm --filter su-oriel-server build; then
  echo "后端构建失败" >&2
  exit 1
fi

echo "[SU-Oriel] 正在启动后端服务：http://127.0.0.1:3030"
exec node ./server/dist/index.js
