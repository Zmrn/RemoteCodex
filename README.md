# Remote Codex · ChatGPT 桌面会话桥接器

Windows 原型 **0.9.7**。连接已经运行的官方 ChatGPT 桌面端，通过它管理的同一个 Codex 任务收发消息、查看实时状态和操作队列。提供可自由调整窗口大小的 Windows UI，窄屏竖向布局自动使用侧栏抽屉。

现已支持**单 EXE 分发及在线更新**：`RemoteCodex.exe` 内置运行依赖，文件名固定，当前软件版本显示在界面左下角设备名旁。编辑本机设备可读取 Tailscale IP、设置端口和访问密钥、开关远程访问；同一窗口可检查更新并开关自动更新。更新只替换桥接程序，官方任务继续运行。详见 [PORTABLE.md](PORTABLE.md)。以下启动命令适用于源码调试版；仓库根目录的 `RemoteBridge.exe` 现在转到已构建的单 EXE 桌面。

运行中也可从输入框下方调整权限、模型、推理强度和速度，交给官方同一任务的所有者，下一轮生效。验证与复测方法见 [RUNNING-SETTINGS-VALIDATION.md](RUNNING-SETTINGS-VALIDATION.md)。

调用链为：本机网页 / Windows UI → 桥接服务 → 官方 `ChatGPT.exe` 命名管道 → 官方任务所有者。程序不会启动独立 Codex app-server。

**目前写入仅适配已验证的 Windows 包 `OpenAI.Codex_26.901.6511.0_x64__2p2nqsd0c76g0`。** 接口是当前版本的内部 IPC，并非 OpenAI 承诺兼容的公共 API；其他版本保留写入限制，需要重新验证协议。

## 启动与停止

需要 Windows、Node.js 22+、Python 3.10+、Microsoft Edge，以及已运行、已登录且至少有一个 Codex 任务的官方 ChatGPT 桌面端。`node` 和 `python` 需要在 PATH 中。服务运行只用标准库，无需 `npm install` 或 API Key。

```powershell
git clone https://gitee.com/Anso/remote-codex.git
cd remote-codex
.\Open-UI.cmd
```

源码需先构建 `python scripts/build_portable.py`，随后可双击单 EXE 或目录中的 `RemoteBridge.exe`。Windows UI 使用内嵌 WebView2，由主程序持有窗口和运行组件。关闭窗口退出整个桥接程序；异常退出时 Windows Job Object 清理其子进程。

只启动网页服务：

```powershell
.\Start.ps1 -Background
# 浏览器打开 http://127.0.0.1:43127/

# 停止本机正在运行的桥接服务
.\Stop.ps1
```

这些独立 Node/PowerShell 命令仅用于源码调试，不是桌面软件启动方式。正式桌面关闭窗口即停止接入；最小化窗口则继续运行。停止桥接程序只断开查看连接，官方任务继续执行。桌面使用独立的随机回环端口，源码调试默认 43127。

## 使用

- **任务**：侧栏显示当前设备的官方项目及最近任务，支持搜索、项目筛选和读取更早消息。点击“新对话”直接在主输入框输入，首次发送才创建官方任务，没有创建弹窗。当前原型的新任务仍使用 `RemoteBridge-Probe` 名称和专用目录。
- **继续旧任务**：已加载的 Codex 任务由所有者接收原生输入；尚未加载的历史任务先通过官方工具在原 ID 上恢复。新任务及未加载历史任务的第一条消息暂只支持文字。
- **输入与队列**：Enter 发送，Shift+Enter 换行。运行中默认进入官方队列，可“调整方向”立即送入当前轮次，或取回文字/图片重新编辑。用户可以正常操作开发本工具的任务；自动测试排除规则不影响用户输入。
- **模型与权限**：输入框底部使用非模态下拉菜单选择模型、推理强度和权限。未加载任务的模型设置随下一条消息提交；权限设置要求任务已加载且空闲，仍受官方支持范围和审批限制约束。
- **状态与额度**：运行显示圆环，确认完成显示蓝点。等待、出错、未知、连接中断有独立状态。左下角设备菜单显示该设备登录账号的周额度剩余和重置时间；额度是账号共享的，并非每台电脑独立分配。
- **设备**：左下角可添加、重命名、保存 Tailscale 地址、端口和桥接连接密钥，再切换当前操作设备。保存配置本身不会部署远端服务。
- **图片与附件**：已加载任务可输入 PNG/JPEG/WebP（最大 5 MB）。文件面板可下载桥接器创建任务的 `outputs` 原文件。若官方生图原文件仍在应用专用目录，可让同一任务复制原文件到自己的 `outputs`。普通文件链路与官方原生生图能力分别验证。
- **回到官方桌面**：“在官方桌面打开”会将该设备的官方窗口切换到同一个任务，不复制任务。其他读取、发送和订阅无需窗口获取焦点。

中断及结果文件控制目前仅开放给桥接器登记的 Probe；中断携带当前 turn ID。没有交付审批决定按钮。

## 可选的其他电脑连接

默认只监听 `127.0.0.1:43127`，不会更改 Tailscale、代理、DNS、防火墙或端口映射。本机 UI 可保存其他设备，但目标电脑需要单独运行桥接器，并显式启用 agent 入口：

```powershell
# 在目标电脑上，将占位符替换为该电脑已经拥有的 Tailscale IP
.\Start.ps1 -Background -AgentAddress <TAILSCALE_IP> -AgentPort 43128
```

该可选入口只接受 Tailscale 地址，并要求桥接连接密钥。配对方法见 UI 内“远程连接”说明；不要提交或分享密钥。设备配置中的密钥由 Windows DPAPI 保存。

已实测通过保存的 Tailscale 设备读取第二台 Windows 电脑的运行中会话，并切回本机。0.9.6 修复慢响应被持续刷新丢弃、切换设备遗留请求和事件连接恢复后状态未更新的问题；双方使用新版时压缩内容响应，减少重复传输的历史。详见 [DEVICE-SWITCH-VALIDATION.md](DEVICE-SWITCH-VALIDATION.md)。任意官方应用版本兼容和锁屏可靠性未完成验证。未制作 APK；Windows UI 可用于桌面、横屏及窄屏预览。

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
