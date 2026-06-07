# Slot Resize 最终 Smoke 验收文档（d21ff1/pr7）

适用范围：oriel 动态增删 slot（栈式）需求 `cmmq2a2x3p25029cbd6d21ff1` 的最终端到端验收。
后端契约见 `slot-topology-resize-contract.md`；UI 交互行为由 `web/src/pages/slots/SlotsPage.spec.tsx` RTL 测试锁定。

## 前置条件

- 本机安装 ccb（采集与执行记录基于 v7.3.2）。
- 仓库依赖就绪（`pnpm install`），server 可 typecheck。
- **隔离纪律**：全程使用 `/tmp` 下临时 ccb 项目与临时 SQLite DB，禁止指向任何真实项目根或运行中 Console 实例。

## 执行方式 A：脚本化执行（route 层直驱，可重复）

```bash
cd su-oriel/server
pnpm tsx scripts/d21ff1-pr7-smoke.ts
```

脚本自动完成：临时项目 + 3-slot managed config → 普通 `prisma db push` 建空库 → 启动隔离 ccbd →
`POST /slots/resize` 直驱全序列 → tmux pane 指纹三验证点 → `ccb kill -f` + 临时目录清理。
退出码 0 且输出 `ALL VERIFY POINTS PASSED` 即通过。

## 执行方式 B：UI 手动执行（浏览器侧）

1. 起 server 与 web（指向测试项目/测试 DB），进入 SlotsPage。
2. **grow**：点 `＋`（aria-label 扩容）→ 期望 toast「已扩容至 N 个 slot，slot-N 已就绪」，lanes 增加一行。
3. **派需求**：将一个 requirement 绑定/调度至新尾部 slot（或在测试 DB 将其 SlotBinding 置 busy）。
4. **shrink 被拒**：点 `−`（aria-label 缩容）→ 确认对话框显示「回收 slot-N」与资格三项（绑定空闲 ✗）→
   确认 → 期望失败 toast「缩容失败：尾部 slot 仍被 requirement 占用」。
   若队列中存在待执行 su-cancel 行，期望 toast 含「队列中存在待执行的 su-cancel 取消指令，缩容已被阻断」。
5. **释放**：释放该绑定（slot 回 idle）。
6. **shrink 成功**：再次缩容确认 → toast「已缩容至 N-1 个 slot」，尾部 lane 消失。
7. **再 grow**：再次扩容 → 新 slot lane 回归。
8. slotCount > 5 时，控件旁应出现资源提示「每个 slot 常驻 claude+codex 两个 agent 进程…」。

## 三验证点（必须显式确认）

| # | 验证点 | 判定方法 |
|---|--------|----------|
| 1 | pane ready | grow 后 `tmux -S <proj>/.ccb/ccbd/tmux.sock list-panes -a` 中新 slot window 的 pane 存在 |
| 2 | 扩回旧会话不恢复 | 缩容后扩回，新 pane id ≠ 缩容前旧 pane id（窗口为全新会话，无旧对话上下文）；`.ccb/agents/slotN_*` 磁盘目录保留属预期设计，不等于会话恢复 |
| 3 | 其他 slot 无中断 | 整个序列前后 slot-1..3（既有 slot）的 pane id 完全不变 |

## 执行记录（2026-06-07，方式 A，ccb v7.3.2）

```text
[smoke] setup: projectRoot=/tmp/d21ff1-pr7-smoke-pceOHL/project 3-slot managed config written
[smoke] setup: smoke.db schema pushed
[smoke] setup: isolated ccb started
[smoke] baseline: panes=[["slot-1","%3"],["slot-2","%6"],["slot-3","%9"]]
[smoke] VERIFY-1: pane ready: slot-4 pane %12 exists
[smoke] step: shrink rejected as expected: slot_not_idle
[smoke] VERIFY-2: grow-back no session restore: new pane %15 ≠ old %12; agents dir kept on disk=true(by design)
[smoke] VERIFY-3: other slots uninterrupted: slot-1..3 pane ids stable [["slot-1","%3"],["slot-2","%6"],["slot-3","%9"]]

=== SMOKE RECORD ===
grow#1 -> 200, mode=reloaded, slot-4 pane=%12
shrink#1 (slot-4 busy) -> 409, reason=slot_not_idle
shrink#2 -> 200, mode=reloaded, slot-4 pane=removed
grow#2 -> 200, slot-4 pane=%15 (was %12)
final slotCount=4
=== ALL VERIFY POINTS PASSED ===
[smoke] teardown: ccb kill -f done
[smoke] teardown: removed /tmp/d21ff1-pr7-smoke-pceOHL
```

结论：三验证点显式通过；shrink 资格拒绝（`slot_not_idle`，409 结构化原因）与成功路径均按契约工作；
真实 ccb reload 路径（`mode=reloaded`）全程生效；teardown 干净，未触及任何真实项目或运行中 Console。
