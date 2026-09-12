# 官方桌面接口清单

由 src/official-desktop.json 生成；修改源清单后运行 node scripts/compatibility-report.mjs --write。
此清单描述桥接器实际使用的桌面内部接口，不代表 OpenAI 对第三方的稳定性承诺。字段为已使用字段摘要，不是完整官方 schema。

已验证官方版本：26.901.6511.0、26.903.8094.0（windows-x64）。
Chat：列表/历史读取；文字续写待专用真实会话验证；新建/模型/图片未支持。Work：没有独立验证；列表可能与 Chat 混合。

## 连接和数据来源

- 共享转发管道：codex-ipc；官方工具管道前缀：codex-browser-use-。
- 官方 app-tools 必须属于 WindowsApps 中的 ChatGPT.exe，并提供真实 tools/list。转发管道可由官方进程或签名有效、发布者/公司/产品均匹配中央清单的 Microsoft VS Code 持有；两者不要求同一 PID。握手后再次验证 PID/映像，身份变化时关闭并重新发现。
- 管道 PID 不等于任务 owner；按真实 conversationId 发现 handledByClientId，再定向转发，核对相同 owner 回执及事件。协议没有 owner UUID 到 Windows PID 的查询字段，能力标志不是官方进程证明。共存验证见 VSCODE-COEXISTENCE.md。
- 传输：4 字节小端长度 + JSON；app-tools 使用 JSON-RPC 2.0，桌面 IPC 使用 requestId/sourceClientId/version/targetClientId 信封，两者不能混用。
- 实时流只接受当前订阅任务的已发现所有者，patch 基线不匹配时标记未知并重读。
- 磁盘队列：.codex-global-state.json / queued-follow-ups；仅只读，不能证明实时状态。
- 大历史降级：当前官方 home 的 sessions / archived_sessions；核对本机任务和 session_meta 身份，只读 item_completed 并按消息分页、图片按需读取。历史结束记录不控制实时状态、写入或已读。
- 全部未知写入回执不得自动重发；安全限制、原始上下文和当前任务 ID 必须保留。

## 桌面 app-tools

| 方法 | 用途 | 请求字段 | 返回字段 | 调用/适配位置 | 回归 |
| --- | --- | --- | --- | --- | --- |
| list_projects | 项目列表 |  | projects[] | src/bridge.mjs:projects | test/projects.test.mjs |
| list_threads | 会话列表与操作前实时元数据 | limit | threads[], pinnedThreads[] | src/bridge.mjs:threads, src/task-reports.mjs:collect, src/thread-metadata.mjs:readCodexThreadMetadata | test/thread-metadata.test.mjs |
| read_thread | 历史读取 | threadId, turnLimit, includeOutputs, maxOutputCharsPerItem, cursor, hostId | thread, turns, nextCursor | src/bridge.mjs:read, src/task-reports.mjs:collect, src/thread-metadata.mjs:readCodexThreadMetadata (列表不可用或缺任务时) | test/conversation-pages.test.mjs |
| create_thread | 新建真实任务 | prompt, target, model, thinking, title | threadId required; clientThreadId-only response treated as outcome-unknown | src/bridge.mjs:create | test/projects.test.mjs |
| send_message_to_thread | 继续已有任务；Chat 分支未完成实测 | threadId, prompt, model, thinking | official tool result | src/bridge.mjs:send, nativeSend, chatSend | test/send-lifecycle.test.mjs |
| set_thread_title | 用户主动修改 Codex 会话名；专用测试权限上下文命名 | threadId, title | threadId, title (submission acknowledgement; display uses subsequent official list) | src/thread-titles.mjs:renameThread, src/bridge.mjs:permissionContext | test/thread-titles.test.mjs |
| navigate_to_codex_page | 打开官方窗口同一任务 | threadId | official tool result | src/bridge.mjs:open | test/core.test.mjs |
| wait_threads | 等待任务状态 | targets, timeoutMs | official tool result | src/bridge.mjs:wait | test/context.test.mjs |
| get_usage_limits | 目标账号额度 |  | rateLimitsByLimitId, rateLimits | src/bridge.mjs:usage | test/usage.test.mjs |

## 所有者 IPC

| 方法 | 协议版本 | 用途 | 请求字段 | 返回字段 | 调用位置 | 回归 |
| --- | --- | --- | --- | --- | --- | --- |
| initialize | 1 | 连接桥接客户端 | clientType | result.clientId | src/transport.mjs:connect | test/core.test.mjs |
| thread-owner-discovery | 1 | 发现任务所有者 | hostId, conversationId | handledByClientId | src/desktop.mjs:owner | test/queue.test.mjs |
| thread-stream-following-changed | 1 | 订阅/取消订阅；broadcast | hostId, conversationId, following |  | src/desktop.mjs, src/bridge.mjs | test/subscriptions.test.mjs |
| thread-follower-update-thread-settings | 1 | 设置下一轮模型/权限/速度 | conversationId, threadSettings | handledByClientId | src/bridge.mjs:updateSettings | test/settings.test.mjs |
| thread-follower-submit-user-input | 1 | 回答官方待处理问题 | conversationId, requestId, response.answers | handledByClientId | src/bridge.mjs:answerQuestions | test/messages.test.mjs |
| thread-follower-steer-turn | 1 | 向同一个运行中任务调整方向 | conversationId, input, restoreMessage, clientUserMessageId, attachments | handledByClientId, result.result.turnId | src/bridge.mjs:answerQuestions/nativeSteer, src/queue.mjs:mutate | test/steer.test.mjs |
| thread-follower-set-queued-follow-ups-state | 1 | 替换该任务完整队列 | conversationId, state | handledByClientId, result.ok | src/queue.mjs:write | test/queue.test.mjs |
| thread-follower-interrupt-turn | 4 | 用户停止当前 Codex 轮次；核对实时轮次和同一官方所有者；自动测试仍仅专用任务 | conversationId, mode=user-stop, expectedTurnId | handledByClientId, result.ok, result.interruptedTurnId | src/bridge.mjs:interrupt | test/interrupt.test.mjs |
| thread-follower-start-turn | 2 | 空闲任务中启动下一轮 | conversationId, turnStart.request.threadId, turnStart.request.input, turnStart.request.clientUserMessageId | handledByClientId, result.result.turn.id | src/bridge.mjs:nativeSend | test/multi-images.test.mjs |
| thread-read-state-changed | 3 | 用户读到当前回报后通知官方清除未读标记；broadcast，无逐轮条件回执 | hostId, conversationId, hasUnreadTurn, context.identity, context.executionHostKey |  | src/official-report-read.mjs | test/official-report-read.test.mjs |
| thread-follower-submit-mcp-server-elicitation-response | 1 | 用户处理浏览器网站访问授权；不扩大为任意 MCP 表单或所有网站授权 | conversationId, requestId, response | handledByClientId, result.result.ok | src/approvals.mjs:answerApproval | test/approvals.test.mjs |
| thread-follower-command-approval-decision | 1 | 响应官方终端命令审批：拒绝、一次及请求提供的命令前缀规则 | conversationId, requestId, decision | handledByClientId, result.method, result.result.ok | src/approvals.mjs:answerApproval | test/command-approvals.test.mjs |

## 功能与所需接口

当前连接按这些依赖逐功能判断；历史已验证版本不作为运行白名单。异常/未知只影响依赖它的功能。任务身份、内容结构和回执仍在操作时核验。

| 功能 | 所需接口 ID |
| --- | --- |
| 会话列表 | listThreads |
| 项目列表 | listProjects |
| 会话内容 | readThread |
| 使用额度 | usage |
| 在官方应用打开 | navigate |
| 等待任务 | waitThreads |
| 新建文字会话 | createThread |
| 在项目中新建 | createThread, listProjects |
| 继续未加载会话 | readThread, sendMessage |
| Chat文字续写 | readThread, sendMessage |
| 发送消息和图片 | initialize, readThread, owner, following, start |
| 带图新建 | initialize, createThread, readThread, owner, following, start |
| 修改会话设置 | initialize, readThread, owner, following, settings |
| 新建时指定权限 | initialize, createThread, readThread, owner, following, start, settings, setTitle, navigate |
| 重命名会话 | readThread, setTitle |
| 消息入队、取回和删除 | initialize, readThread, owner, following, queueWrite |
| 直接调整方向 | initialize, readThread, owner, following, steer |
| 用排队消息调整方向 | initialize, readThread, owner, following, queueWrite, steer |
| 停止回复 | initialize, readThread, owner, following, interrupt |
| 回答阻塞问题 | initialize, readThread, owner, following, userInput |
| 网站访问授权 | initialize, readThread, owner, following, mcpElicitation |
| 实时状态、未读统计和通知 | initialize, owner, following |
| 同步官方已读 | initialize, readThread, owner, following, readStateChanged |
| 终端命令审批 | initialize, readThread, owner, following, commandApproval |

## 事件和依赖结构

| 事件 | 字段 | 消费位置 |
| --- | --- | --- |
| thread-stream-state-changed | conversationId, hostId, change.type, change.revision, change.baseRevision, change.conversationState, change.patches | src/bridge.mjs:frame |
| thread-queued-followups-changed | conversationId, messages | src/queue.mjs:frame |
| item/tool/requestUserInput | id, params.questions | src/bridge.mjs:answerQuestions, public/app.js |
| mcpServer/elicitation/request | id, params.threadId, params.turnId, params.serverName, params.mode, params.message, params.requestedSchema, params._meta | src/approvals.mjs:pendingApprovals |
| item/commandExecution/requestApproval | id, params.threadId, params.turnId, params.itemId, params.command, params.cwd, params.reason, params.proposedExecpolicyAmendment | src/approvals.mjs:approvalView |

| 结构 | 字段 | 适配位置 | 约束 |
| --- | --- | --- | --- |
| history | thread.id, thread.kind, thread.status, turns[].id, turns[].items, nextCursor | src/conversation-pages.mjs, src/state.mjs, src/message-media.mjs | read_thread snapshots can lag the verified owner; history completion is not proof of current completion |
| ownerState | id, turnHistory.history.entitiesByKey, threadRuntimeStatus, latestThreadSettings, requests | src/state.mjs, src/bridge.mjs | accept only watched conversation from discovered owner; patch baseRevision must match |
| queueMessage | id, text, context.prompt, context.imageAttachments, cwd, createdAt, pausedReason | src/queue.mjs | official disk is read-only; preserve full raw context and revision when forwarding owner writes |
| modelCatalog | tools[].namespace, tools[].name, tools[].inputSchema.properties.model.description | src/settings.mjs, src/service-tiers.mjs | parse actual tools/list schema; never invent models |
| usage | rateLimitsByLimitId, rateLimits, planType, primary, secondary, usedPercent, windowDurationMins, resetsAt | src/usage.mjs | ordinary codex 300-minute quota first, 10080-minute next; separate Spark |
| officialReadState | version, unreadByIdentity, legacyMigration | src/official-read-state.mjs | Only used to validate the official identity partition and confirm user-triggered notifications. Task statistics use fresh owner hasUnreadTurn and runtime flags; no Remote receipts, history inference or cross-account union. Unavailable state remains unknown. See OFFICIAL-READ-STATE.md. |
| officialTaskState | id, hasUnreadTurn, threadRuntimeStatus | src/official-task-state.mjs, src/task-reports.mjs | 0.10.23: fresh dedicated read-only owner subscription, exact task/host/owner checked; supports official Windows x64 26.903.8094.0 local Codex. No receipt files or history cache are read/written; unsupported/unloaded/timeout yields unknown. |
| notifications | id, threadRuntimeStatus.type, threadRuntimeStatus.activeFlags, requests[].id, requests[].method, requests[].params.questions, turnHistory.history.entitiesByKey[].turnId, turnHistory.history.entitiesByKey[].turnStartedAtMs, turnHistory.history.entitiesByKey[].status, turnHistory.history.entitiesByKey[].error.message, turnHistory.history.entitiesByKey[].items | src/notification-source.mjs, src/official-task-state.mjs | Windows other-device notifications use fresh verified owner snapshots only; current runtime gates result/question events; stable IDs deduplicate delivery, never unread or answers; Chat and Work excluded. Supported owner versions follow storage.readState.verifiedVersions. |
