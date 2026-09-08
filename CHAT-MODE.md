# Chat 模式 0.10.1

左上角点击 Codex / Chat 下拉切换。Windows 与 Android 使用同一界面；手机竖屏先展开侧栏。两种模式分开显示会话、保存草稿和导航位置，设备切换不会混入另一设备的读取结果。

Chat 可读取官方 ChatGPT 历史；已有会话空闲时可试用文字续写，模型沿用官方会话。新建按钮在当前页面说明创建方式：先在官方桌面新建普通 Chat，再回本程序刷新。模型选择、图片、权限、队列与中断尚未开放，不能使用 Codex/Work 创建代替普通 Chat。

## 当前验证

| 功能 | 状态 | 证据与限制 |
|---|---|---|
| 模式切换、独立列表和草稿 | 已通过 | 真实前端 + 隔离 API 的 Edge 无头测试；包含导航、更新恢复、切设备、迟到响应、手机下拉菜单。 |
| 官方 Chat 列表及历史读取 | 已通过 | 2026-09-09 本机 Windows，官方 OpenAI.Codex 26.901.6511.0，ChatGPT.exe PID 131084；读取 35 条 chatgpt 记录和选定 ID 的两轮、四项消息。记录没有导出私人正文。 |
| 普通 Chat 与 Work 的区分 | 部分通过 | 与 Codex 完全分开；官方工具将两者均标记为 chatgpt，没有进一步分类字段。界面明确提示包含未分类 Work。 |
| 已有 Chat 文字续写 | 部分通过 | 实现并核对当前安装源码的官方发送路径，HTTP 分派、同 ID、去重和不转交 Codex 的测试通过。尚未完成专用真实 Chat 的两次发送与官方窗口对照，故标为试验性。 |
| Chat 状态与增量显示 | 部分通过 | 当前可见会话每 4 秒读取，列表每 15 秒查询；不重叠读取。隔离测试新增消息能自动出现。官方数据可能缓存；未验证真实 Chat 逐字输出/错误切换，不声称实时订阅。 |
| 历史状态纠正 | 已通过 | 将官方适配器合成的 turn.completed 显示为“历史记录”；运行状态只取独立 renderer 查询，错误映射、断线/读取失败显示未知。 |
| 普通 Chat 新建 | 未测试 | 当前 create_thread 仅有 Codex / Work Cloud 创建，无已验证的普通 Chat 入口。Chat 新建请求会被服务端拒绝，避免创建成 Codex。 |
| Chat 模型目录、切换、图片、队列、中断 | 未测试 | 没有经过验证的桌面接口。Chat 不显示 Codex 模型与权限菜单；模型位置说明需在官方桌面更改。 |
| 官方窗口双向操作 | 未测试 | 本轮 Windows 窗口截图黑屏、无法可靠激活，未对现有私人会话发送任何测试消息，也未中断开发任务。 |
| 实际 EXE 界面读取 | 已通过 | 0.10.1 已安装的本机 EXE 服务 + 真实界面，在独立 Edge 无头窗口显示真实 Chat 四项消息；Codex follow 调用 0、任务写入 0、前端异常 0。`work/chat-live-ui-result.json`。 |
| APK 真实只读联通与布局 | 已通过 | `emulator-5580`，正式 0.10.1 APK；`stage=chat` instrumentation PASS，经本机 0.10.1 接入显示真实 Chat 历史，验证模型禁用、图片/权限隐藏、历史标记、横屏下拉、返回 Codex 列表和竖屏收起。未触碰物理手机。 |
| 构建与同步发布 | 已通过 | Node 63/63；EXE 内置 Node/Python、DPAPI、官方命名管道/项目/会话只读自检 passed。双平台清单验签、大小和哈希校验通过，资源服务各保留一份正式 APK/EXE。本机桌面启动器和已保存的笔记本均在线更新到 0.10.1，更新状态 current。 |

只读调用链：控制端 → Windows 桥接器 → 经 Win32 核验属于官方 ChatGPT.exe 的 app-tools 命名管道 → list_threads/read_thread → 官方 renderer 自己的 Chat 客户端及缓存。

文字续写调用链：`mode=chat` → 校验目标 kind=chatgpt、ID 与 idle 状态 → 官方 app-tools `send_message_to_thread` → 当前安装的 `SJi → f_i → o_i → Ggi` Chat 分支 → 同一个 Chat ID。没有 hostId、Codex 模型/权限参数、Codex owner 协议或独立后端。超时、断线或返回 ID 不符均记为结果未知，原请求不会自动重发。

## 复测

```powershell
npm test
node scripts/verify-chat-read.mjs
# 界面隔离测试，需要 playwright-core；可用 REMOTE_BRIDGE_PLAYWRIGHT 指定模块完整 URL。
node scripts/verify-chat-ui.mjs
# 本机 EXE 更新后，检查真实界面读取；不保存私人正文/截图，不发送任务消息。
node scripts/verify-chat-live-ui.mjs
python scripts/build-release.py --publish
```

`verify-chat-read.mjs` 仅查询，证据保存在忽略的 `work/chat-read-*/result.json`，只有 ID、数量、时间、状态和来源。`verify-chat-ui.mjs` 使用独立假数据，不向官方发送消息。真实 Chat 写入复测必须先创建清晰命名的 RemoteBridge-Probe-* 普通 Chat，核对 ID 后才发送低成本测试消息，并在官方窗口对照；不得用已有私人会话或开发任务代替。

APK 同步版本与 EXE；Android instrumentation 的 `stage=chat` 只读验证实际 Windows Chat 列表、消息、模型控件与横竖屏切换，不能据此宣称 Android 真实消息写入已通过。

正式发布文件：

- `RemoteCodex.exe`：43,998,208 字节；SHA-256 `e8b467864a83aa199f5549dccee7d85c9ce6899fdae6a921a0f49b39cf9328b5`。
- `RemoteCodex.apk`：165,878 字节；SHA-256 `c2f78ac021f67b3b9af2b9fb47e51327b9a1c0a9fff17374482c6ed2c4597e49`；versionCode 10001，包名和签名身份沿用。

测试过程中的两个前置条件失败已查明：最初 APK 连接的是 0.10.0 接入端，缺少新 Chat 数据来源标记；接入端自动更新后完整测试通过。Windows 真实界面验证首次跟随用户保存的笔记本设备（当时仍为旧版），随后明确选择本机，验证通过。这些尝试均未发送真实 Chat 消息。
