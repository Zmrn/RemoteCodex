# 新轮次遗漏修复 · 0.9.12

验证日期：2026-09-09，Windows 本机及已保存的笔记本。

## 原因

两个项目中的同名会话具有不同的稳定 ID，未发生会话串读。问题会话的官方 `read_thread` 接口仅返回 3 轮历史，而已经验证身份的同一会话所有者通过官方 IPC 提供了 10 轮。原代码只向已读轮次补充实时消息，未插入所有者中额外的 7 轮。因此整体运行状态更新了，正文仍停留在旧轮次。

源头差异通过真实接口复现，未依靠磁盘历史或界面推测。排查期间发生过 Tailscale 接入超时，后来恢复；连接超时与上述合并缺陷分开记录。

## 修复

- 首屏合并已验证所有者的新轮次，按真实开始时间排序，并同步对应轮次状态；毫秒时间戳转为界面使用的秒。
- 合并后才执行原有的 40 项 / 约 128 KiB 分页。更早的官方游标只读取旧历史，不重复插入新轮次。
- 同一轮的消息以稳定 ID 去重，保留已经读到的内容。不同会话的状态不会混入，官方原始数据和执行状态均不改写。

## 验证记录

| 项目 | 结果 | 证据 |
| --- | --- | --- |
| 真实差异复现 | 已通过 | 笔记本 0.9.11：历史接口 3 轮、官方所有者 10 轮；缺失最新 7 轮 |
| 真实数据应用修复 | 已通过 | 合并恢复 10 轮；最新回复与所有者原文字节一致；截图中的后续追问可恢复 |
| 分页完整性 | 已通过 | 真实数据经过 20 页合并，首屏 40 项；轮次无重复；原始历史游标保留 |
| 自动测试 | 已通过 | `npm test` 56/56；覆盖历史接口落后 7 轮、同轮更新、旧游标、跨会话隔离 |
| 前端回归 | 已通过 | 分页、断线后补读、新轮次实时刷新、图片预览、队列和附件回归通过 |
| 单 EXE | 已通过 | 构建及隔离自检通过，包含真实官方项目/会话只读访问 |
| 安装版实际界面 | 已通过 | 本机 → Tailscale → 笔记本 0.9.12，正确显示最新回复；加载两段找到截图中的追问；切换另一条会话再切回正常，消息无重复 |

所有实测均为查看连接、订阅和读取；对官方任务发送消息、中断和设置写入次数为 0。私人消息和附件未写入报告或上传到代码仓库，详细核验只在被 Git 忽略的 `evidence/` 中保留 ID、数量与摘要哈希。

## 复测

```powershell
npm test
$env:REMOTE_BRIDGE_PLAYWRIGHT = ([System.Uri](Resolve-Path '../../work/formatter/node_modules/playwright-core/index.mjs').Path).AbsoluteUri
node scripts/verify-pagination-ui.mjs
node scripts/verify-desktop-ux-ui.mjs
# 打开目标会话建立读取订阅后，使用实际已保存设备 ID 和会话 ID：
node scripts/verify-owner-history-live.mjs SAVED_AGENT_ID THREAD_ID installed
# 在隔离浏览器验证目标回复、旧消息及另一条会话：
node scripts/verify-owner-history-ui.mjs SAVED_AGENT_ID THREAD_ID EXPECTED_REPLY_ID CONTROL_THREAD_ID
```

Windows 原生窗口的鼠标操作与本轮无头 Edge 的真实前端读取实测应分别验收。

## 构建与发布

`RemoteCodex.exe`，0.9.12，43,992,576 字节。SHA-256：`56201c763172ae7f6d939172d9ece7d1064b9ea311091302b5f77b71019dcf3f`。

签名更新源已覆盖发布，服务器保留一个 EXE 副本。被控电脑需要更新到 0.9.12 才能修复其会话合并。

本机和笔记本已完成安装并回读确认 0.9.12，桌面启动器哈希与发布包一致。官方 ChatGPT 的 PID 分别保持 131084 和 10728，未重启官方应用。安装及实际界面证据：`evidence/owner-history-release.json`、`evidence/owner-history-ui.json`。
