# 官方桌面兼容性维护

本项目操作已经运行的官方桌面和它的真实任务。使用桌面内部管道，不启动独立 app-server；本文不把公开 app-server 文档当作桌面内部协议的兼容承诺。

## 集中管理入口

- src/official-desktop.json：唯一接口清单。包括已验证官方版本、验证依据、Win32 管道发现规则、只读磁盘位置、工具名称、IPC 方法及版本、事件字段、结构适配位置和相关回归。
- src/official-protocol.mjs：运行时使用的统一入口。负责当前连接的接口证据、功能依赖判断、IPC 方法/版本路由、工具和事件常量、脱敏兼容性状态。业务操作仍在 Bridge/OfficialQueue 中完成，原始输入和所有者校验不被清单替代。
- COMPATIBILITY-INTERFACES.md：从清单生成的可读接口表。请求/返回字段列是当前用到的摘要，不是完整官方 schema；需要改字段时同时核对表中列出的消费者源码。
- public/official-events.mjs：从清单生成的浏览器事件常量，供 Windows 和 Android 共用。不要手改生成文件。
- scripts/compatibility-report.mjs：生成/校验接口表、浏览器常量、发布支持信息。scripts/desktop_compatibility.py 供双端构建和发布调用。

GET /api/status 的 desktopCompatibility 提供历史已验证版本、清单 SHA-256、检测版本与 per-feature-interfaces 策略；capabilities 提供每项功能的 supported、依赖与具体原因。existingCodexWritable/writeSupported 是旧端摘要，新界面和服务端必须使用具体操作能力。版本号不能代替当前连接证据；每次重连、目录刷新、连接关闭后重新判定，旧证据不能授权新连接。

帮助页的“官方接口兼容性”提供可截图、可复制的只读对照报告，见 [COMPATIBILITY-VIEW.md](COMPATIBILITY-VIEW.md)。按用户 2026-09-10 要求，只比较 Remote 实际使用的接口名单，忽略名单外变化；不会为了查看报告执行下面的真实任务测试。网上的官方更新清单提供版本号，运行版工具目录和已下载包分别提供工具参数及静态协议声明。

网站访问授权新增 MCP elicitation 响应 v1，名单现含 20 项实际使用指令。依赖接口匹配时对 Browser origin 请求开放窄范围响应；原始实现核对版本为 26.903.8094.0，官方原文/协议与隔离回归已核对，真实授权往返尚未验证；所有网站权限和其他审批不扩大，见 [BROWSER-APPROVALS.md](BROWSER-APPROVALS.md)。

## 当前范围

历史行为验证覆盖 Windows x64 官方包 26.901.6511.0、26.903.8094.0，证据见 CREATE-IMAGES.md 和清单 validation。其他版本按本机当前接口证据逐功能判断；26.903.9818.0 本轮只读接口一致，未冒充完整行为实测。记录的是已验证的 Codex 核心功能，不能据此宣称每种官方功能都可用：

0.10.15 支持 VS Code 先运行并持有共享 IPC 管道的情况，官方 app-tools 仍须属于 ChatGPT.exe；不能把转发 PID 当作任务 owner。当前实测组合与签名校验、失败处理、专用任务证据见 [VSCODE-COEXISTENCE.md](VSCODE-COEXISTENCE.md)。GET /api/status 的 desktopConnection 返回脱敏的两类进程身份，失联时为 null。

- Codex 已验证主要读写、队列、设置及图片链路。具体证据与限制见清单 validation 条目引用的文档。
- 新建项目目前只支持真实项目的“本地”环境。工作树/分支切换未实现，首轮速度参数也未接入。
- 用户主动中断可用于已支持版本的普通 Codex 会话，验证当前轮次和官方所有者；自动中断测试仍仅专用任务，证据见 INTERRUPT.md。待审批状态可展示，不应称为已实现任意审批处理。
- Chat 列表/历史可读取，文字续写仍待专用真实会话验证；新建、模型和图片未支持。Work 没有独立验证，列表可能和 Chat 混合。
- 自动发现新安装目录、自动重连和能够读到历史均不构成新版写入兼容的证明。

## 官方升级后的流程

1. 只读记录新官方包版本、管道归属和工具目录，比较名称、schema、owner 发现和实时事件。不得重启或改写官方安装、历史或账号凭据。
   可先运行 node scripts/verify-compatibility-live.mjs：读取现有官方管道和工具目录，只输出版本、方法是否存在及清单声明字段是否缺失，不记录描述、任务内容或凭据；工具目录匹配不等于新版写入通过。
2. 在接口表定位受影响的方法及消费者；调整协议适配和实际观察到的参数/回执。禁止仅删除版本校验或猜测字段。
3. 完成只读验证后，使用专用 Probe 目录和任务验证同一 owner 的新建、两次续写、队列、设置、问题、图片和断线恢复。按影响范围执行，未测试项明确保留；不向承载开发工作的任务写入或中断。
4. 只有明确完成相应验证后，才将新版本加入 support.verifiedVersions，并在 validation 中记录日期、验证范围和不含私人内容的证据文档。JSON 记录不替代实际测试。
5. 运行 node scripts/compatibility-report.mjs --write 更新生成文件；Node22.19.0、npm run compatibility 与相关共享 UI 回归均须通过。只有用户明确要求构建时才按 AGENTS.md 的 GitHub 流程构建双端。
6. 双端按 AGENTS.md 发布；面向用户明确说明 Remote Codex 版本、支持的官方包版本、Codex/Chat/Work 范围、未验证版本的处理及本次验证限制。

## 发布时强制核对

EXE 和 APK 的构建报告均保存 desktopCompatibility（包括整个接口清单的 SHA-256）。清单改动后，两个产物都需要重新构建；签名器和发布器会拒绝缺失或不匹配的兼容性元数据，不能用旧二进制搭配新说明发布。

生成的 dist/RELEASE-NOTES.md 明确列出支持版本和模式限制，也内嵌于 EXE/APK。发布时覆盖远端固定的 release-notes.md；其 SHA-256 和 desktopCompatibility 同时进入两个签名更新清单。远端校验签名、说明哈希及双端兼容信息一致后才切换正式文件。旧客户端可忽略新增字段，原有包校验和安装签名规则不变。

## 历史验证（0.10.11）

2026-09-09：104 项 Node 回归及 13 项 Windows 窗口检查通过。新增用例覆盖清单/生成文件一致性、方法版本与 owner 路由、未验证官方版本在派发前阻止写入，以及支持说明签名防篡改。

单 EXE 在 PATH 不含 Node/Python 时完成内置运行时、DPAPI、静态资源、Win32 管道发现、官方项目/任务只读自检；实测官方版本 26.901.6511.0，与清单一致。

隔离 Android API 35 模拟器验证：APK 内嵌兼容信息与签名更新清单一致，发布说明包含支持官方版本且哈希一致，WebView 能加载生成事件模块；队列横竖屏生命周期回归通过。没有操作物理手机。

运行 python scripts/verify-compatibility-release.py 验证了缺失/过期清单元数据会被拒绝、EXE/APK 内嵌清单与构建报告一致、签名清单对应当前产物和发布说明。Edge 使用隔离生产界面/服务验证队列读取、图片和 4 种窗口尺寸。

本轮未升级官方应用，未向用户任务或当前开发任务写入测试消息；没有宣称支持新的官方版本。接口重构使用独立的既有协议用例验证参数及所有者路由，未重复进行全部真实写入探测。

上述只读预检已在当前官方桌面实测：清单中的 9 个 app-tools 均存在，所声明的请求字段全部匹配实际工具 schema。所有者 IPC 的验证依据仍为既有实测及本次独立回归，未用工具目录结果替代。

安装后验证：本机及笔记本的 Remote Codex 均已更新至 0.10.11；两端报告的接口清单哈希均与源码一致，官方连接正常，本机控制端保留 2 个已保存设备（该数量来自本机设备配置，不代表笔记本自身的设备列表）。检查仅读取状态和更新信息，没有发送任务消息。

- 本机官方版本为 26.901.6511.0，writeSupported=true。
- 笔记本官方版本为 26.903.8094.0，尚未完成该版本的协议验证，writeSupported=false。连接正常仅证明接入成功，不能据此宣称任务写入兼容。该限制沿用此前已有的版本保护；本轮将它集中管理并纠正了能力上报，没有扩大支持版本。

脱敏安装验证保存在被 Git 忽略的 work/compatibility-installed-local.json 和 work/compatibility-installed-laptop.json。

## 新建与新版验证（0.10.14）

笔记本 26.903.8094.0 已通过源协议/实时 schema 核对及专用任务的 12 项实际检查，现允许 Codex 核心写入。此前 0.10.11 记录的笔记本只读限制属于历史状态。新建可以一次提交文字和多张图片，官方历史包含一轮准备消息，随后同一 owner 接收完整原生图片输入。细节、专用任务 ID、未验证项和复测方法见 CREATE-IMAGES.md。
