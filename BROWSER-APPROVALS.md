# 浏览器网站访问授权

2026-09-10 源码功能。Windows 和 Android 共用会话内授权卡，目标电脑也需要更新到包含本功能的 Remote Codex。本轮未构建、发布、安装或执行 APK。

## 使用范围

官方 Browser 请求访问一个网站时，显示网站 origin、官方原文及可用选项：

- 拒绝。
- 允许一次。
- 本会话允许：仅官方请求声明支持 session 时出现。
- 始终允许此网站：仅官方请求声明支持 always 时出现。

“允许所有网站”还需要官方 configRequirements/read 确认 browserUse.allowGlobalPersistentApproval 策略。现有桌面桥接入口无法取得这一确认，因此不提供全网站授权按钮；可点“在官方应用中处理”，打开目标电脑的同一任务。不能仅凭 persist=always 推导全网站授权可用。

当前仅适配 Windows x64 官方 26.903.8094.0 的 Codex 浏览器 origin 申请。原 26.901.6511.0 核心支持范围保持，但不开放本轮新授权；26.903.9818.0 没有加入写入支持名单。Chat/Work、MCP 登录或任意表单、原始 CDP 权限、命令/文件等其他审批不因本功能获得通用批准入口。

## 官方数据与提交

官方 `requests` 中的 `mcpServer/elicitation/request` 是待授权的唯一来源。历史 `mcpServerElicitation` 只展示官方 completed/action，不能从旧的未完成历史创建按钮。当前请求与历史卡重复时，只保留当前请求卡；当前轮历史尚未加载时仍能显示独立授权卡。

服务端重新取得同一任务、同一 owner 的实时状态，核对 request ID、完整请求指纹和授权选项。通过中央清单的 `thread-follower-submit-mcp-server-elicitation-response` v1 发送，原始 string/number request ID 类型不变：

| 用户选项 | 官方 response |
| --- | --- |
| 拒绝 | action=decline，content=null，_meta=null |
| 允许一次 | action=accept，content={}，_meta=null |
| 本会话允许 | action=accept，content={}，_meta={persist:session} |
| 始终允许此网站 | action=accept，content={}，_meta={persist:always} |

由服务端生成固定 response，不接受客户端传入 action/content/_meta 或扩大权限范围。其他 MCP 表单只能进入官方处理入口。

官方 IPC 外层 result 包含 handler 的 `{method,result:{ok:true}}`；确认同一 owner 与 `result.result.ok` 后只提示提交成功，不能清掉官方请求或记成已允许。官方 handler 在请求已结束时也可能返回 ok；是否结束仍由后续官方状态确认。协议没有请求指纹 CAS，临派发复核不能消除官方同时处理的全部竞态；不会在未确认时再次提交。

本地仅保存防重复派发记录，不保存新的“已授权”事实。稳定键绑定任务、官方请求 ID 和指纹，跨控制端重复点击、换选项和目标桥接器重启均不能重放已派发或结果未知的请求。明确派发前失败可重新核对；网络异常/错误 owner/异常回执只能刷新或转官方处理。原文、网站与表单内容不写入该持久记录。设备/任务切换在本地持久化后、网络派发前再次核对，迟到回执不能操作新目标。

## 验证和边界

- `npm test`：236 项通过，含 9 组授权专项：精确响应与权限范围、未知 MCP、官方数据投影、owner/请求变化、参数拒绝、跨客户端去重、重启保护、错误回执、生产 HTTP 资源/CSRF/路由。
- `node scripts/verify-approvals-ui.mjs`：生产共享界面和真实静态资源服务器，8 组隔离检查通过，覆盖无历史轮次、四种按钮、回执不清卡、旧历史、旧目标/未知表单、失败重试限制、切设备迟到结果、官方打开入口及 1300/390/320 宽度。
- `node scripts/verify-compatibility-ui.mjs`：7 组通过；接口名单自动增加本轮实际使用的 1 项，现在共 20 项，测试不再硬编码数量。
- `node scripts/verify-features-ui.mjs`：原问答/设置交互回归通过。
- Android 的 23 个生产 Java 源文件以 API 35 编译通过，主机 JVM 验证仅 POST 授权路由可转发；未执行 Android APK，不能替代手机行为验收。
- 官方 26.903.8094.0 已有申请只读取样与包内请求/UI/响应逻辑核对：真实 Browser origin 形状能识别出拒绝、一次、此网站；该请求已在官方结束。本轮任务消息与授权写入均为 0，尚未做真实授权往返验证。官方源码和真实任务证据不提交 Git。

复测脚本使用隔离数据目录和合成请求。GitHub Checks 同样只做回归；只有用户明确要求打包时才派发正式 APK/EXE 云构建。
