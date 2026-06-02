# CCB Console

`ccb-console` 是 SU/CCB 管理台的承接目录。

## 当前实现范围

| 阶段 | 状态 | 说明 |
|---|---|---|
| Phase 0 | 已实现 | 完成 pnpm workspace、前后端基础工程、测试与构建脚本 |
| Phase 1 | 已实现 | 完成项目管理最小闭环：项目创建、项目列表、项目详情、初始化状态展示 |
| Phase 2 | 已实现 | 完成文档扫描、文档索引、文档中心列表与正文阅读 |
| Phase 3 | 已实现 | 完成任务归并、任务看板、任务详情与快速状态更新 |
| Phase 4 | 已实现 | 完成需求录入、文档骨架生成、需求转任务主链路 |
| Phase 5 | 已实现 | 完成运行记录、异常提示卡、扫描/解析/归并失败留痕 |

## 目录说明

| 目录 | 作用 |
|---|---|
| `web/` | 前端界面与页面层代码 |
| `server/` | 本地后端、扫描索引、API 与任务归并逻辑 |
| `scripts/` | 开发与启动辅助脚本 |

## 当前可用能力

| 能力 | 说明 |
|---|---|
| 项目创建 | 支持创建本地项目记录 |
| 项目列表 | 支持展示项目列表 |
| 项目详情 | 支持展示路径、简介、初始化状态、同步状态与概览统计 |
| 文档中心 | 支持扫描 `docs/.ccb` 下的 `spec / plan / task` 文档并在线阅读 |
| 任务看板 | 支持从文档自动归并任务、查看详情、快速标记阻塞/完成 |
| 需求入口 | 支持录入需求并生成 `Spec + Plan + Task` 骨架文档 |
| 运行记录 | 支持查看 `scan / parse / reconcile / generate` 运行记录与失败摘要 |
| 后端 API | 提供项目、扫描、文档、任务、需求相关接口 |
| Prisma 数据层 | 已落地 `Project / Document / Task / Requirement / SyncJob` 五张核心表 |

## 启动方式

> Windows 用户走 PowerShell；WSL / Linux / macOS 用 bash。

### 启动后端

**Windows (PowerShell):**
```powershell
.\apps\ccb-console\scripts\dev-server.ps1
```

**WSL / Linux / macOS (bash):**
```bash
./apps/ccb-console/scripts/dev-server.sh
```

### 启动前端

**Windows (PowerShell):**
```powershell
.\apps\ccb-console\scripts\dev-web.ps1
```

**WSL / Linux / macOS (bash):**
```bash
./apps/ccb-console/scripts/dev-web.sh
```

## 验证命令

### 运行全部测试

```powershell
pnpm test
```

### 运行全部构建

```powershell
pnpm build
```

## 环境兜底 / Troubleshooting

| 症状 | 修法 |
|---|---|
| `python: command not found` | 当前脚本使用 `python3`；如仍失败，先确认 `which python3` 可用。 |
| `node_modules` 旧路径 | Windows 原生切到 WSL 后重装依赖：`rm -rf apps/ccb-console/{server,web}/node_modules && pnpm install --frozen-lockfile`。 |
| `prisma shim` 无执行位 | 运行 `chmod +x apps/ccb-console/server/node_modules/.bin/prisma`，或按上一条重装依赖。 |
| `node-pty Could not locate the bindings file` | 重建 Linux 原生模块：`pnpm --filter ccb-console-server rebuild node-pty`，或按重装依赖流程处理。 |
| `pnpm: not found` | 见下方 corepack 环境配置。安装后重新打开 shell，并用 `pnpm --version` 验证。 |

### pnpm 通过 corepack 管理时的环境配置

如果外层命令用 `corepack pnpm ...` 可以运行，但 `pnpm test` / `pnpm build`
内部触发嵌套 npm-script 时出现下面错误，通常是 shell 中缺少独立 `pnpm`
shim：

```text
sh: 1: pnpm: not found
```

常见触发点是 server 测试脚本中的嵌套命令，例如：

```bash
pnpm run db:prepare && pnpm run prisma:generate && vitest run
```

根因是本机 pnpm 由 Node.js 16+ 内置的 `corepack` 管理，但 corepack 默认
不一定把 `pnpm` shim 安装到当前 PATH。外层 `corepack pnpm ...` 能跑，不代表
子进程也能找到 `pnpm`。

推荐修复（有 sudo 权限）：

```bash
sudo corepack enable
corepack prepare pnpm@10.25.0 --activate
```

无 sudo 权限时，把 corepack shim 安装到用户目录：

```bash
mkdir -p ~/.local/bin
corepack enable --install-directory ~/.local/bin
# 添加到 ~/.bashrc 或 ~/.zshrc:
export PATH=~/.local/bin:$PATH
```

验证：

```bash
pnpm --version
```

能输出版本号（当前工作区期望 `10.25.0`）后，重新打开 shell，再运行
`pnpm test` 或 `pnpm build`。
