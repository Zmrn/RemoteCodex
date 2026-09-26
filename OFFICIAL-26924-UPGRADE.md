# 官方 Codex 26.924.2738.0 接口适配

2026-09-27 在本机 Windows x64 官方包 `OpenAI.Codex_26.924.2738.0` 复现了用户截图中的 `-32602 Invalid app tool request`。旧版 Remote Codex 的 `tools/list` 可以列出全部 9 项在用工具，所有者 IPC 连接与 11 项方法版本也匹配；但第一次实际 `list_projects` 调用即被官方拒绝，故原兼容页的“无异常”不足以证明内容可读。包内 app-tools 请求 schema 相比此前已留存的官方版本新增必填 `callerSource: codex | chatgpt`，而 Remote 的调用封套未包含它。

适配后所有 app-tools 调用附带 `callerSource=codex`。正常连接和独立兼容报告都会做一次只读 `list_projects` 调用，不输出项目内容；如果封套被拒绝，工具依赖功能显示不匹配，其他调用失败显示待验证。owner IPC 仍按自身证据独立判断，避免一个工具错误阻断无关功能。兼容报告继续只对照在用接口；未使用的官方接口变化不计为异常。发现或重连官方管道时重新验证，不沿用旧连接的结果。

修复前同一运行官方版 `list_projects` 返回 `Invalid app tool request`；修复后只读获取项目、50 项任务列表、额度、Codex 和 Chat 历史及一个已加载任务 owner。用户截图中“迭代 remote codex 项目”的长会话经隔离 Bridge 完成首段分页读取：40 个条目、存在更早页、未读取或输出正文，也未发送消息。当前版 `tools/call` 封套与接口声明匹配不等于真实写入、已读、排队、审批等行为已验证，因此 `verifiedVersions` 不新增 26.924.2738.0。

用户随后明确要求修好即打包，因而本适配进入 0.10.51 的 GitHub 四包发布流程。已发布 0.10.50 不包含此修复；目标 Windows 接入端和 Windows/Android 控制端需同版更新。验证不更新正在运行的客户端，不重启官方应用，也不写入真实任务。主工作区未完成的八份 Chat 修改保持独立。
