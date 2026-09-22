# 完全访问与自定义权限

2026-09-22：修复 Remote Codex 选择内置权限时只更新访问配置、保留旧审批策略的问题。版本仍为 0.10.44，本轮未打包；需后续明确构建并更新目标 Windows 接入端后生效。

## 原因与改动

只读核对官方 Windows x64 26.915.4065.0 的内置权限目录：完全访问由 `:danger-full-access`、`approvalPolicy: never`、`approvalsReviewer: user` 组成。工作区和只读分别使用 `:workspace` / `:read-only`，配套 `on-request` / `user`。官方选内置模式时同时传这三个字段；仅选命名配置时才只传 `permissions`。

Remote 原来只传 `permissions`。官方设置接口按字段合并，因此从工作区切到完全访问仍可能留下 `on-request`，成为与官方内置完全访问不同的自定义组合。新建时复用的专用权限准备任务也只核对配置 ID，导致错误组合继续被继承。

- `permissionOverrides` 按官方内置模式同时提交配置 ID、审批策略和审批者；新建准备、已有任务设置及发送共用。沿用官方权限和仅改模型不额外修改权限。
- 准备任务必须三项都与所选模式一致；旧准备任务存在策略残留时先通过原官方设置/发送路径纠正，只有官方当前有效状态确认后才创建用户任务。
- 核对准备期间连接、当前任务 ID 和 owner；准备回执未知时不派发用户首条消息。原请求去重与未知不重放规则保持。
- 不改官方文件、全局默认、用户已有任务、设备设置或草稿；不把本地选择或应用回执伪装成官方当前权限。

## 验证

- Node 22.19.0：354 项通过，含 8 项新增权限预设回归。覆盖同 ID 残留旧策略/审批者、复用匹配准备任务、真实生产设置与发送链路的合成测试、去重、未知回执与连接/owner 变化。
- 共享 Windows/手机权限 UI 6 组、接口清单检查通过。
- 真实隔离 HTTP/UI/DPAPI 的旧源码到新源码设备保存、强制重启保留与显式删除通过；现有设备/接入配置字节保持。
- `node scripts/verify-permission-presets-live.mjs --create-probe --version=26.915.4065.0` 在本机官方 PID14272 上通过：3 个新登记 Probe（含准备任务），旧版仅配置 ID 更新确实得到完全访问范围 + on-request；新实现纠正后，新建首轮、Remote 断开重连及无权限覆盖的下一轮均为完整完全访问；再切只读后恢复 on-request/user。

真实验证只向新登记 Probe 发送无工具 READY 指令，不操作既有用户任务。证据保存在隔离工作树 `work/permission-presets-live-sYdofz/result.json`。没有重启官方应用、执行 APK/模拟器、构建或安装新版，不等于官方重启后的权限恢复已验证。

## 老任务再次变回工作区的边界

只读核对用户当前任务的官方原始运行记录，确认曾多次出现前一轮完全访问、后续新一轮工作区限制。2026-09-22 用户重新选择后，本轮有效权限和下一轮设置均为完整完全访问。不能将这条已有任务的回退直接归因于上面的新建准备缺陷。

另一个线索是旧轮次的原始记录没有 `active_permission_profile`。当前官方恢复代码在缺少可继承的命名配置/明确设置时存在采用默认权限的路径；其重建历史参数也可能是推断值，不能替代原始运行记录证明某一旧轮次的真实权限。本机全局默认仍为 workspace-write。今天的直接触发已由官方日志确认：北京时间15:49:16重新加载本任务，hasCurrentPermissions/hasExplicitPermissions/hasLatestThreadSettings/hasLatestTurnParams均为false，sandboxPolicySource=default、shouldSendPermissions=false；恢复回包为workspaceWrite，随后15:49:32以该范围启动。用户16:03重新选择后，发送使用了 :danger-full-access/never/user。原始权限记录与恢复日志能证明这次回退发生于官方恢复旧任务；未通过受控官方重启验证新的命名配置是否能彻底避免以后回退，不能承诺本次修复解决全部官方恢复问题，也不采用 Remote 私存旧权限自动覆盖官方当前设置。
