# Remote Codex · ChatGPT 桌面会话桥接器

Windows / Android 原型，当前版本以 package.json 和发布说明为准。连接已经运行的官方 ChatGPT 桌面端，通过它管理的同一个 Codex 任务收发消息、查看实时状态和操作队列。Windows 可自由调整窗口大小；Android 竖屏使用侧栏抽屉，横屏使用桌面布局。

新开发会话先读 [AGENTS.md](AGENTS.md)。2026-09-09 交接版本为 0.10.14；已支持一次提交文字和多张图片新建同一官方 Codex 任务，失败保留完整草稿，实际链路和准备轮限制见 [CREATE-IMAGES.md](CREATE-IMAGES.md)。下文带旧版本号的条目是功能演进记录，当前支持范围以中央清单与最新验证文档为准。

官方接口、协议版本和已验证应用版本集中在 src/official-desktop.json；可读清单见 [COMPATIBILITY-INTERFACES.md](COMPATIBILITY-INTERFACES.md)，升级适配和发布检查见 [COMPATIBILITY.md](COMPATIBILITY.md)。每次双端发布自动生成明确列出支持官方版本的 RELEASE-NOTES.md；支持信息和说明哈希写入签名更新清单。

0.10.6 完整处理七项交互 review 问题：发送确认后的草稿清理、发送前拒绝后的安全重试、问答输入焦点与草稿持久化、内容读取失败重试、Android 大图原文件保存，以及观看订阅和快照回收。结果与边界见 [REVIEW-FIXES.md](REVIEW-FIXES.md)。

会话正文支持基本 Markdown：表格、标题、嵌套列表、引用、勾选列表、粗体/斜体/删除线、代码和链接。普通两列表格在手机上换行显示，多列表格在内部横向滑动；图片放大和网页引用继续保留。格式范围、限制与复测见 [MARKDOWN.md](MARKDOWN.md)。

Windows 会记住上次的窗口大小、位置与最大化状态，退出、更新后仍有效。首次打开根据屏幕可用区域设置大小；换到低分辨率屏幕或拔掉副屏后，窗口会调整到当前可见范围。见 [WINDOW-PLACEMENT.md](WINDOW-PLACEMENT.md)。

左上角现在可切换 **Codex / Chat**，分别显示会话并保留草稿。Chat 历史读取已通过本机验证，已有 Chat 的文字续写作为试验性功能转交官方桌面；普通 Chat 新建、模型切换和图片暂需在官方桌面操作。官方 ChatGPT 列表可能包含 Work，界面明确提示。详细验证与限制见 [CHAT-MODE.md](CHAT-MODE.md)。

Android APK 的安装、自动下载更新、系统确认安装和复测方法见 [ANDROID.md](ANDROID.md)。每次正式迭代必须同时构建并发布 `RemoteCodex.apk` 和 `RemoteCodex.exe`；发布地址配置在被忽略的 `release.local.json`，模板是 `release.example.json`，开发发布约定见 [AGENTS.md](AGENTS.md)。

现已支持**单 EXE 分发及在线更新**：`RemoteCodex.exe` 内置运行依赖，文件名固定，当前软件版本显示在界面左下角设备名旁。左下角问号直接打开检查更新、安装更新和自动更新设置；下载期间问号变成下载进度。编辑本机设备可读取 Tailscale IP、设置端口和访问密钥、开关远程访问。更新只替换桥接程序，官方任务继续运行。详见 [PORTABLE.md](PORTABLE.md)。以下启动命令适用于源码调试版；仓库根目录的 `RemoteBridge.exe` 现在转到已构建的单 EXE 桌面。

运行中也可从输入框下方调整权限、模型、推理强度和速度，交给官方同一任务的所有者，下一轮生效。验证与复测方法见 [RUNNING-SETTINGS-VALIDATION.md](RUNNING-SETTINGS-VALIDATION.md)。

调用链为：本机网页 / Windows UI → 桥接服务 → 官方 `ChatGPT.exe` 命名管道 → 官方任务所有者。程序不会启动独立 Codex app-server。

**当前 Codex 核心写入支持 Windows x64 官方包版本 26.901.6511.0、26.903.8094.0。** 接口是内部 IPC，并非 OpenAI 承诺兼容的公共 API；其他版本保留写入限制，需要重新验证协议。各功能的已验证范围见 [COMPATIBILITY.md](COMPATIBILITY.md)，不能从 Codex 验证推定 Chat/Work 写入成功。

0.9.8 支持按需加载：首屏最多 40 个消息项，向上滚动继续读取更早片段，同一轮过长时也会分页。刷新保留已加载历史和阅读位置；图片在滚动到附近时独立读取原文件，内容未变化时只回传小型确认响应。完整优化需要控制端和被控电脑都更新到 0.9.8。

0.9.9 增加自动重连：网络或官方 IPC 中断后按 1/2/4/8/15/30 秒间隔持续尝试，事件通道 45 秒无数据时主动恢复，唤醒或网络恢复时立即检查。恢复当前会话、实时订阅和漏掉的消息，保留未发送的文字、图片及已显示历史；不会重发任务指令。关闭程序或切换设备取消旧连接的重试。详见 [RECONNECT-VALIDATION.md](RECONNECT-VALIDATION.md)。

0.9.10 支持向已加载会话粘贴剪贴板图片，以及下载消息里已读取的本地文件附件和文件链接。队列编辑按钮显示铅笔图标。Windows 关闭按钮改为隐藏到托盘；点击托盘可恢复，右键“退出 Remote Codex”才结束程序，隐藏时远程接入和自动重连继续工作。详见 [DESKTOP-UX-VALIDATION.md](DESKTOP-UX-VALIDATION.md)。

0.9.11 支持点击会话、待发送及队列图片放大查看；预览可切换适应窗口/原始尺寸并下载原图，点击背景、关闭按钮或按 Esc 返回。

0.9.12 修复官方历史接口落后时，桥接器漏掉会话所有者中新轮次的问题。首屏先合并所有者已确认的新轮次，再分页返回；历史游标保持只向前翻阅，不重复插入最新轮次。详见 [OWNER-HISTORY-VALIDATION.md](OWNER-HISTORY-VALIDATION.md)。

## 启动与停止

需要 Windows、Node.js 22+、Python 3.10+、Microsoft Edge，以及已运行、已登录且至少有一个 Codex 任务的官方 ChatGPT 桌面端。`node` 和 `python` 需要在 PATH 中。服务运行只用标准库，无需 `npm install` 或 API Key。

```powershell
git clone https://gitee.com/Anso/remote-codex.git
cd remote-codex
.\Open-UI.cmd
```

源码需从 `release.example.json` 创建并填写本机 `release.local.json`，构建 `python scripts/build-release.py`，随后可双击单 EXE 或目录中的 `RemoteBridge.exe`。Windows UI 使用内嵌 WebView2，由主程序持有窗口和运行组件。关闭窗口隐藏到托盘，右键托盘退出整个桥接程序；异常退出时 Windows Job Object 清理其子进程。

只启动网页服务：

```powershell
.\Start.ps1 -Background
# 浏览器打开 http://127.0.0.1:43127/

# 停止本机正在运行的桥接服务
.\Stop.ps1
```

这些独立 Node/PowerShell 命令仅用于源码调试，不是桌面软件启动方式。正式桌面关闭窗口隐藏到托盘并继续接入；托盘右键退出才停止本程序。停止桥接程序只断开查看连接，官方任务继续执行。桌面使用独立的随机回环端口，源码调试默认 43127。

## 使用

- **任务**：侧栏显示当前设备的官方项目及最近任务，支持搜索、项目筛选和读取更早消息。点击“新对话”直接在主输入框输入，首次发送才创建官方任务，没有创建弹窗。当前原型的新任务仍使用 `RemoteBridge-Probe` 名称和专用目录。
- **继续旧任务**：已加载的 Codex 任务由所有者接收原生输入；尚未加载的历史任务先通过官方工具在原 ID 上恢复，未加载历史任务的恢复消息暂只支持文字。新任务已支持文字、多图或只发图片；带图新建会在同一官方任务多一轮自动准备消息，然后发送完整用户输入。
- **输入与队列**：Enter 发送，Shift+Enter 换行。运行中默认进入官方队列，可“调整方向”立即送入当前轮次，或取回文字/图片重新编辑。用户可以正常操作开发本工具的任务；自动测试排除规则不影响用户输入。
- **模型与权限**：输入框底部使用非模态下拉菜单选择模型、推理强度和权限。新建可预选支持的设置，运行中的设置由官方所有者接收、面向下一轮生效；未加载任务的模型随恢复消息提交。受官方支持范围和审批限制约束，首轮加速参数未接入。
- **状态与额度**：运行显示圆环，确认完成显示蓝点。等待、出错、未知、连接中断有独立状态。左下角优先显示普通 Codex 的 5h 剩余额度，没有该窗口时显示周额度；Spark 在详情中。按目标账号实际窗口识别，额度是账号共享的，并非每台电脑独立分配。
- **设备**：左下角可添加、重命名、保存 Tailscale 地址、端口和桥接连接密钥，再切换当前操作设备。保存配置本身不会部署远端服务。
- **图片与附件**：新建和已加载任务可添加 PNG/JPEG/WebP，每条最多 20 张、每张 5 MiB、合计 10 MiB。消息中的附件按钮和文件面板可下载已读取的原文件；更早的附件随向上翻阅加载。若官方生图原文件仍在应用专用目录，可让同一任务复制原文件到自己的 `outputs`。普通文件链路与官方原生生图能力分别验证。
- **回到官方桌面**：“在官方桌面打开”会将该设备的官方窗口切换到同一个任务，不复制任务。其他读取、发送和订阅无需窗口获取焦点。

用户可停止已支持版本的运行中 Codex 任务，须核对当前轮次和相同官方 owner，见 [INTERRUPT.md](INTERRUPT.md)。仅自动写入测试和特定结果目录控制限制为登记的 Probe；不能据此禁用用户手动停止普通任务。没有交付通用审批决定按钮。

## 可选的其他电脑连接

默认只监听 `127.0.0.1:43127`，不会更改 Tailscale、代理、DNS、防火墙或端口映射。本机 UI 可保存其他设备，但目标电脑需要单独运行桥接器，并显式启用 agent 入口：

```powershell
# 在目标电脑上，将占位符替换为该电脑已经拥有的 Tailscale IP
.\Start.ps1 -Background -AgentAddress <TAILSCALE_IP> -AgentPort 43128
```

该可选入口只接受 Tailscale 地址，并要求桥接连接密钥。配对方法见 UI 内“远程连接”说明；不要提交或分享密钥。设备配置中的密钥由 Windows DPAPI 保存。

已实测通过保存的 Tailscale 设备读取第二台 Windows 电脑的运行中会话，并切回本机。0.9.6 修复慢响应被持续刷新丢弃、切换设备遗留请求和事件连接恢复后状态未更新的问题；双方使用新版时压缩内容响应，减少重复传输的历史。详见 [DEVICE-SWITCH-VALIDATION.md](DEVICE-SWITCH-VALIDATION.md)。任意官方应用版本兼容和锁屏可靠性未完成验证。Android APK 已交付并与 Windows EXE 同步发布；Windows UI 同样支持桌面与窄屏预览。

## 复测与源码构建

不调用模型的协议、安全边界、队列及设置测试：

```powershell
npm test
```

只读 CLI（将 `TASK_ID` 替换为任务列表返回的真实 ID）：

```powershell
node src/cli.mjs probe
node src/cli.mjs projects
node src/cli.mjs threads
node src/cli.mjs usage
node src/cli.mjs read TASK_ID
node src/cli.mjs owner TASK_ID
```

正在运行的服务只读复测，以及显式创建新 Probe 的两轮读写复测：

```powershell
node scripts/retest.mjs
# 以下命令会创建一个专用官方任务并消耗模型额度
node scripts/retest.mjs --write
```

自动写入脚本只应操作桥接器登记的测试任务。桥接服务和测试脚本继承 `CODEX_THREAD_ID` 时自动排除该开发任务；从普通终端运行时，可以在启动服务及测试前设置 `REMOTE_BRIDGE_DEVELOPMENT_THREAD_ID` 为要排除的开发任务 ID。这是测试排除配置，不会禁用用户手动收发。源码不包含开发者机器的任务 ID。

浏览器交互测试额外需要 Playwright Core 1.56.1 和默认位置的 Edge。`verify-*-ui.mjs` 使用隔离响应检查界面；它们不能代替真实所有者协议的验收。测试结果写入本地 `evidence/`。

```powershell
npm install --no-save --package-lock=false playwright-core@1.56.1
node scripts/verify-queue-ui.mjs --development-excluded
node scripts/verify-settings-ui.mjs
node scripts/verify-status-ui.mjs

# 重建启动器：系统 .NET Framework C# 编译器
powershell -NoProfile -File scripts/Build-Launcher.ps1
# 生成便携分发包（排除本机数据）
python scripts/package_agent.py
```

本机开发阶段已验证真实官方任务新建、连续读写、旧任务恢复、所有者事件、图片输入、官方原生生图及原图下载、断线恢复、指定 turn 中断、队列和模型设置。私人证据与原始环境报告不随源码发布。原生图片编辑、实际待审批场景与审批决定、Work 互通未测试；普通 Chat 只做过只读探测。

## 数据与限制

实时状态来自官方 IPC / app-tools；队列初始磁盘快照等数据保留来源标记，不能当作已确认的实时状态。断线后显示未知/连接中断，重连读取状态和遗漏消息，不自动重发写请求。

写请求先保存请求哈希及 `outcome-unknown`，获得确认后才标记 `accepted`。重复请求 ID 不再次发送，内容不同则拒绝；超时后应先核对官方任务，不能换 ID 自动重试。`accepted` 表示提交已确认，完成状态另由官方状态/事件确认。

`data/` 包含本机配置、配对密钥、浏览器 profile、请求日志、Probe 登记和图片；`evidence/` 可能包含私人任务信息，`downloads/` 包含原附件。它们均由 `.gitignore` 排除，不能作为迁移资料上传。迁移只复制源码、启动器和必要依赖。

本仓库保留第三方所需声明：[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)、[FARFIELD-LICENSE.txt](FARFIELD-LICENSE.txt)。这些第三方声明不自动授予整个项目相同许可证。ChatGPT/OpenAI 标志及商标属于 OpenAI，本项目不是官方产品。
