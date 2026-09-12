# 终端命令审批

2026-09-12 源码新增。截图中的沙箱外下载论文和下载参考图申请都是官方 `item/commandExecution/requestApproval`。按请求类型适配，不按下载地址、用途或命令名称匹配；同一格式的其他终端命令共用流程。

Windows／Android 会话卡显示官方理由、完整命令、工作目录与授权范围；长命令换行、滚动查看。待请求独立显示，不依赖历史轮次已加载。

- **拒绝**：当前请求返回 `decline`。
- **允许一次**：当前请求返回 `accept`。
- **允许类似命令**：仅官方提供有效 `proposedExecpolicyAmendment` 时显示。完整展示原前缀数组，发送 `{acceptWithExecpolicyAmendment:{execpolicy_amendment:原数组}}`，不自行生成或扩大规则。
- **在官方应用中处理**：只打开目标电脑的同一任务。

中央清单新增 `commandApproval`：`thread-follower-command-approval-decision` **v1**，请求为 `{conversationId,requestId,decision}`，原 string/number ID 类型保持。核对官方 Codex 身份、同一连接、新 owner 快照、完整请求指纹与可用选项后才派发。客户端不能提供替代命令、前缀或任意 decision 对象。

只有明确派发前失败可重新核对。跨客户端、改选项、断线、错误 owner/方法/回执、目标桥接器重启均不能重放已派发或结果未知的请求。ACK 核对 owner、方法和 `result.result.ok`，只提示提交成功；后续官方 `requests` 移除才结束卡片。历史命令不生成批准按钮，不新增本地已授权事实或规则存储。旧网站审批保护记录的操作名称/哈希保持，避免更新后丢失其防重复派发保护。

复用原审批 POST、CSRF 与设备转发。新增 `live.state.commandApprovals`，不混入原 `approvals`，避免旧控制端看不到完整命令却能盲目批准。能力使用 `status.commandApprovals` 独立判断；命令与网站接口异常不互相阻塞。

## 验证与边界

本机官方 **26.903.9818.0** 的协议表、owner handler、UI请求投影与决策转换已静态核对：`src-B6LqG3ek.js`、`app-initial-f094ef01c64d.js`、`app-primary-4c40d73a1074.js`。官方源码只存忽略目录。真实只读连接 PID30692，21项接口、24项功能条件匹配；不是实际审批往返验证。

- Node22.19.0全套286项通过，含8组新命令审批和9组原网站审批。覆盖精确响应、前缀范围、ID类型、状态/连接变化、注入拒绝、跨端与重启保护、独立兼容性、HTTP/CSRF和旧客户端隔离。
- `scripts/verify-command-approvals-ui.mjs` 8组通过并纳入Checks：1300/390/320宽度、完整命令与规则、三种按钮、ACK不清卡、历史不复活、未知请求/旧目标、派发前失败重试、网络未知不重试、切设备迟到回执、官方打开。双端宽度截图已审阅，无横向溢出。
- 原网站审批UI8组通过。没有新增Android Java或静态资源路径，复用共享模块和原审批POST。

当前适配截图所示的普通终端命令审批。官方专用网络策略（带 `networkApprovalContext`）、文件修改、额外权限及未知新版选择结构属于不同授权范围，不冒用普通命令响应；保留官方处理入口。官方没提供可识别的类似规则时只显示一次/拒绝，不能拿 `acceptForSession` 冒充普通命令的“类似”。

本轮没有批准截图中的真实请求、运行下载命令、向任务写入或执行APK。仅源码开发，版本仍**0.10.34**，未打包发布安装；后续明确打包时需同时更新目标Windows接入端与控制端。8份未完成Chat独立保留。
