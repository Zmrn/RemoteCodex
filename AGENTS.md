# Remote Codex 开发与发布约定

本项目通过 Windows 上已运行的官方 ChatGPT/Codex 会话所有者转发操作。Android 是控制端，共用 `public/` 界面；不得启动独立 Codex 后端并将其称为桌面桥接。Chat 模式已实现列表与历史读取；文字续写通过官方 app-tools 的 Chat 分支，尚待专用真实会话验证，见 `CHAT-MODE.md`。

## 新会话接手

- 先确认实际操作系统、主机、工作目录、Git 远端/分支及工作区状态，不能把云端/沙箱测试说成本机验证。本机原工作区中的仓库位于 `outputs/remote-codex/`；直接克隆时以包含本文件与 package.json 的 Git 根目录为准。远端为 `https://gitee.com/Anso/remote-codex.git`，本次交接分支为 `main`，开工时重新核对。
- 当前源码基线（2026-09-09）：Remote Codex **0.10.16**，部分历史优先显示可读内容，双端发布、笔记本内置更新和 Android 隔离横竖屏通过，见 [HISTORY-READ.md](HISTORY-READ.md)。0.10.15 新增 VS Code 持有共享 IPC 管道时的官方 ChatGPT 桥接，真实专用任务的 12 项检查通过，见 [VSCODE-COEXISTENCE.md](VSCODE-COEXISTENCE.md)。Windows x64 官方包 **26.901.6511.0、26.903.8094.0** 的 Codex 核心读写已验证。软件版本以 package.json 为准，官方支持范围以 src/official-desktop.json 的 validation 为准；交接快照不是实时状态，也不代表所有功能均已验证。
- 2026-09-09 接手笔记本已重建并发布最终合并 0.10.15 EXE/APK，包含 VS Code 共存和设备保护；笔记本内置更新及配置保留验收通过。130 项 Node、13 项窗口、最终 EXE 自检和包内旧版→新版强制重启测试通过。最终哈希及两台机器各自的验证范围见 VSCODE-COEXISTENCE.md、DEVICE-STORAGE.md；本机没有做最终合并 APK 的模拟器/真机行为测试。
- 最近修复及证据见 [CREATE-IMAGES.md](CREATE-IMAGES.md)：新建文字/多图、失败草稿保留、正式控制端跨设备发送；115 项 Node 回归、13 项窗口检查、Android API 35 横竖屏及真实官方 owner 测试已通过。新官方版本、Chat 写入、原生生图等不能由这些结果推定成功。
- 交接时有三份原有未跟踪文件：`CHAT-FEASIBILITY.md`、`scripts/build-chat-ui.py`、`windows/ChatUi.cs`。保留并在相关任务中单独审阅，不自动删除、覆盖、纳入发布或用 `git add -A` 顺带提交；它们不是已完成 Chat 功能的证明。
- `work/` 中的现场证据、临时设备更新脚本和 `release.local.json` 不在 Git 中。新克隆缺少它们时，从已提交文档与 scripts 中的复测入口接手；不要杜撰设备地址、访问密钥或重新生成签名身份。
- 接手和每次迭代后更新相关功能文档及本文件的必要约定。按日期识别历史验证记录；若与当前源码、中央清单冲突，先复核并纠正过时说明，不把老报告当当前限制。

## 产品行为约定

- 0.10.17 Android 2×2 小组件合计各设备任务，未读回执在 Remote Codex 真正显示最新回报后产生，独立文件锁/原子保存，不写官方已读状态或设备配置。官方 50 个未固定任务上限、离线/不可读/未知必须标明部分统计；参见 [WIDGET.md](WIDGET.md)。用户于 2026-09-09 特别授权本轮跳过 APK 模拟器/真机测试，构建及签名/元数据检查后直接发布，由用户更新后测试；此例外不应泛化为以后无需行为验证。

- 0.10.16 历史批量读取失败时按原任务/游标缩至一轮，先显示可读内容；单轮仍失败必须保留已读消息、草稿与失败段，提供手动重试，不能当成空历史或自动跳段。Windows/Android 共用提示，测试及限制见 [HISTORY-READ.md](HISTORY-READ.md)。真实问题任务仅允许只读验证，不能用发送或中断来“修复”历史。

- Windows 使用深色主题，图标为 ChatGPT 图案右上角蓝色网络标记。左上角切换 Codex/Chat；新对话直接使用主输入框，项目、模型、推理、权限使用内嵌下拉，不另开创建或模型窗口。弹层内点击不应误关闭。
- 设备切换、设备命名、Tailscale 地址/端口/密钥设置入口在侧栏左下角；版本号也在左下角。问号直接提供检查/安装更新和自动更新设置，下载时显示小进度，不藏在“设置本机接入”中。
- 窗口可自由缩放，保存正常尺寸、位置和最大化状态；低分辨率和失去副屏时限制在可见工作区。窄屏/手机竖屏默认隐藏侧栏、可展开；手机横屏使用桌面布局。Android 系统栏、刘海、键盘必须排除在 WebView 内容区域外。
- Windows 保持单实例。**关闭窗口隐藏到托盘，托盘右键退出才真正结束桥接程序及其子进程**；这是当前约定，覆盖早期“关闭窗口即退出”的需求。停止桥接器不能终止官方任务。单 EXE 内嵌 UI 与受它管理的运行组件，不要求用户另开浏览器或手动运行后台服务。
- 切设备/模式/任务时隔离草稿、异步读取和队列，取消旧请求，避免迟到响应污染新页面；保留已保存设备。查看断线自动重连，恢复实时订阅和遗漏消息，不能重发未知结果的写指令。
- 长输入自动增高，确认发送后缩回；失败保留文字和全部图片。多次粘贴/选图追加而非覆盖，保持原图及顺序，单张可移除；当前上限由 public/image-input.mjs 管理（20 张、每张 5 MiB、合计 10 MiB）。图片可放大、附件可下载原文件；截图或代码生成 PNG 不等于官方原生生图成功。
- 运行中发送进入官方队列，可立即调整方向、取回编辑、删除。队列先显示文字及图片占位，再加载预览。首屏按需加载最新历史，向上翻页；支持基本 Markdown、表格和网页引用，不能把引用控制标记显示为乱码。
- 模型/权限/推理/加速来自目标官方能力，运行时设置面向下一轮；新建草稿允许预选支持的设置，不无故要求先建任务。当前官方创建接口没有首轮 serviceTier；不要把未接入参数显示为已生效。问题回答保留稳定 requestId、用户选项与自由输入，不能把 accepted 回执当用户已作答。

## 文件位置与验证入口

- 主链路：`src/server.mjs` / `remote.mjs`（本机及设备转发）、`bridge.mjs` / `desktop.mjs` / `transport.mjs`（官方所有者）、`state.mjs` / `conversation-pages.mjs`（实时状态和历史）、`queue.mjs`（官方队列）。共享界面在 `public/`；Windows 壳在 `windows/PortableLauncher.cs`、`DesktopWindow.cs`；Android 在 `android/`。
- 已安装 Windows 数据在 `%LOCALAPPDATA%/RemoteCodex/data`，源码调试有独立数据目录；不要混用。通过实际 `server.json` 读取运行地址，桌面回环端口可能随机，不硬编码 43127。设备从现有设备存储读取，密钥仅内存解密使用，不输出。桌面入口是用户桌面的 `RemoteCodex.exe`；替换运行中 EXE 优先走内置更新器，不能把复制失败当更新成功。
- 自动写入前确认新会话的 `CODEX_THREAD_ID`，非 Codex 终端按需设置 `REMOTE_BRIDGE_DEVELOPMENT_THREAD_ID`；遵守 `src/probe-safety.mjs`，只操作本次明确创建的专用测试任务。不要依赖上一会话的任务 ID 或去操作旧私人任务。
- 常规回归：`npm test`、`npm run compatibility`。UI 改动按相关 `scripts/verify-*-ui.mjs` 验证；隔离假 API 的测试不等于真实官方操作通过。若缺 Playwright，优先检查本机已有/捆绑运行环境；脚本可通过 `REMOTE_BRIDGE_PLAYWRIGHT` 指定模块。
- 新建多图真实复测：`node scripts/verify-create-compatibility.mjs --create-probe --version=<实际官方版本>`；只读升级预检：`node scripts/verify-compatibility-live.mjs`。前者会创建专用任务并消耗少量额度，不能用于任意旧任务。
- Android 行为测试先构建正式 APK 与 `python scripts/build_android_test.py`，仅在项目 `work/android-avd/RemoteCodexTest` 的隔离 `emulator-5580` 安装/运行对应 instrumentation stage；例如 `create-images`、`compatibility`，具体命令见 [ANDROID.md](ANDROID.md)。每次显式指定序列号，不操作其他已连接设备；以结果 `PASS` 为准，不能只看 adb 退出码。结束后停止自己启动的模拟器。
- 单 EXE 自检使用 `RemoteCodex.exe --headless --home <隔离目录> --self-test`；不要把旧 `scripts/verify_portable.py` 的历史后台启动流程当作现行单实例 UI 验收。包校验用 `python scripts/verify-compatibility-release.py`（需要同版本的签名清单）；安装后读取实际版本、官方连接、兼容清单与能力，不能只看构建成功。

按改动阅读对应说明：新建图片 [CREATE-IMAGES.md](CREATE-IMAGES.md)、升级接口 [COMPATIBILITY.md](COMPATIBILITY.md)、项目 [PROJECT-CREATION.md](PROJECT-CREATION.md)、队列 [QUEUE-PREVIEW.md](QUEUE-PREVIEW.md)、停止 [INTERRUPT.md](INTERRUPT.md)、额度 [USAGE.md](USAGE.md)、设备存储 [DEVICE-STORAGE.md](DEVICE-STORAGE.md)、重连 [RECONNECT-VALIDATION.md](RECONNECT-VALIDATION.md)、运行设置 [RUNNING-SETTINGS-VALIDATION.md](RUNNING-SETTINGS-VALIDATION.md)、窗口/托盘 [WINDOW-PLACEMENT.md](WINDOW-PLACEMENT.md) / [DESKTOP-UX-VALIDATION.md](DESKTOP-UX-VALIDATION.md)、Markdown/引用 [MARKDOWN.md](MARKDOWN.md) / [CITATIONS.md](CITATIONS.md)、图片预览 [IMAGE-PREVIEW-VALIDATION.md](IMAGE-PREVIEW-VALIDATION.md)、其他交互回归 [REVIEW-FIXES.md](REVIEW-FIXES.md)。

## Chat 与 Codex 的区别

- `kind=chatgpt` 列表包含普通 Chat 与 Work，现有接口没有分类字段，界面必须说明，不能将 Work 新建当作 Chat 新建。
- Chat 不使用 Codex owner/follow、队列、模型/权限或中断接口；文字请求显式携带 `mode=chat`，目标端核对同一个真实 Chat ID，再经官方 `send_message_to_thread` 转发。
- 普通 Chat 新建、模型目录/切换、图片暂无已验证的入口，不能补造模型目录或回退到 Codex/独立 API。旧设备未上报 Chat 能力时只读。
- Chat 状态来自官方 renderer 定时查询，历史可能经过官方缓存；历史 `completed` 是适配器合成的记录标记，不是实时完成证据。断线、读取失败显示未知。
- 模式切换必须隔离列表、草稿、导航与异步读取，保持真实会话 ID；Windows 和 Android 共用此行为。

## 操作边界

- Codex 新建项目由当前目标设备的官方 `list_projects` 读取；用户在输入框上方选择项目和“本地”后，以真实 `projectId` 和 `environment.type=local` 传给官方 `create_thread`。本轮没有实现工作树或分支切换，不得用显示文字冒充已切换。
- 不接收自填工作路径，也不把不存在、其他主机或 Chat 项目退化为无项目任务；旧设备没有 `projectCreation.local` 能力时阻止项目创建。新建选择按设备保存，Chat 不复用 Codex 的项目选择。
- 官方列表可能暂缺新任务。创建回执保存的项目归属只能作为桥接器创建记录补入侧栏，运行状态仍需官方实时读取；不能把创建记录当运行状态。复测见 `PROJECT-CREATION.md`。

- 不改写官方历史数据库、安装文件、凭据或网络配置；不重启官方应用。
- 不向承载开发工作的任务发送测试消息或中断。写入验证只使用明确命名的专用测试任务。
- 上一条限制针对自动测试，不得将用户界面里的停止功能限制为 Probe 会话。已支持版本的 Codex 会话由用户主动停止时，必须核对官方实时 activeTurnId、expectedTurnId 和相同 owner 回执；回执不等于已中断，以实时状态为准，断线不自动重发。Chat 未验证中断入口，不得套用 Codex 方法。复测见 INTERRUPT.md。
- 队列首屏与历史读取并行；新客户端请求 images=multi-v1&previews=refs-v1，只在元数据中携带图片引用，不能把 Base64 原图重新塞进队列列表。预览独立加载，切设备/任务取消读取并释放图片 URL；取回与恢复编辑必须保留全部原图和持久化恢复记录。旧端兼容及复测见 QUEUE-PREVIEW.md。
- 会话状态注明来源；断线或证据不足显示未知，不把磁盘记录当实时状态。
- 额度按目标设备官方返回的 `windowDurationMins` 区分 300 分钟与 10080 分钟，左下角仅显示普通 `codex` 额度：存在 5h 窗口时优先，否则显示周额度。Spark 等独立额度只进详情，不能替代主显示；Plus/Pro 名称不能用来补造或隐藏真实窗口。保留旧 `weekly` 字段兼容，缺失/断线显示未知，见 `USAGE.md`。
- 本机控制端仅绑定回环地址。电脑远程接入只使用用户已配置的 Tailscale 地址与密钥。
- 带图新建须完整转交文字和全部图片，不能只传文字并丢图。当前官方 create_thread 只有文字入口，桥接器在同一官方任务完成准备轮后发送原生图片；请求去重和失败草稿保留不得破坏，见 CREATE-IMAGES.md。固定兼容性 Probe 接口仅可测试清单候选版本和其自身新建任务，不得扩展为任意任务/代码的版本校验绕过接口。
- 手机访问密钥使用 Android Keystore；Windows 密钥使用 DPAPI。日志、报告、APK、EXE、Git 均不得包含用户密钥或私人消息。
- Windows 设备配置以数据目录中的有效持久化副本为准，不得用启动时的旧内存列表整份覆盖；读取失败不能当作首次启动。修改设备存储须验证旧实例覆盖、保存中断、备份恢复、显式删除和密钥不泄露，见 `DEVICE-STORAGE.md`。
- 0.10.15 起，设备增删改必须在同一系统锁下保留独立历史，普通保存不能删改其他设备；重复启动/选择不整份重写配置。升级前保全设备与接入设置，升级后核对一致性，失败不得记作成功。不得清理或覆盖用户数据目录、独立历史与升级前快照。涉及数据保护时同时运行 `scripts/verify-agent-restart.mjs`；安装包验收必须检查不含用户配置。用户于 2026-09-09 表示旧设备自行重新配对，本次不继续恢复旧备份。
- 物理手机必须确认目标后才能安装测试；默认使用项目 `work/` 下的隔离模拟器，不修改用户现有 AVD。

## 同步发布（每次更新必须遵守）

- **每次发布必须在发布说明和最终交付中明确列出支持的官方 ChatGPT/Codex 桌面包版本、平台、Codex/Chat/Work 支持范围及未验证项。不能只写 Remote Codex 自身版本，也不能把“可以连接/读历史”当作新版完整兼容。**
- 官方接口和已验证版本统一在 src/official-desktop.json 管理；运行代码使用 src/official-protocol.mjs，不得重新散落硬编码版本、IPC 方法及版本号。升级处理遵循 COMPATIBILITY.md；接口字段/适配位置和回归入口见自动生成的 COMPATIBILITY-INTERFACES.md。
- `codex-ipc` 是共享转发管道，其 PID 可能属于已验证的 Microsoft VS Code；不能再要求它与官方 app-tools 同一 PID。官方 app-tools 身份、转发进程签名/产品、任务 owner 是三个不同检查，不能只按 Code.exe 文件名放行，也不能把 supportsUntrustedAppInput 当作 ChatGPT 身份证明。规则与已测组合集中在 discovery.sharedBroker；维护/复测见 VSCODE-COEXISTENCE.md。
- 新官方版本必须先取得实际验证证据，再更新清单中的 verifiedVersions 和 validation；不得仅扩大版本范围、删除校验或自动放行。更新清单后执行 node scripts/compatibility-report.mjs --write 和 npm run compatibility。
- 双端构建报告、签名更新清单及 release-notes.md 必须来自同一份兼容性清单。发布器必须拒绝缺失/过期元数据和混用旧产物；发布时同时覆盖固定 release-notes.md，其哈希受更新签名保护。

1. `package.json` 是唯一正式版本来源。APK versionCode 为 `major*1000000 + minor*1000 + patch`；minor、patch 必须小于 1000。
2. **每次正式更新同时构建、验证并发布 Android APK 和 Windows EXE，不允许只更新其中一端。** 运行 `python scripts/build-release.py --publish`；该脚本先构建双端，再发布。
3. 固定文件名为 `RemoteCodex.exe`、`RemoteCodex.apk`，版本显示在程序左下角；不要在文件名中加版本。
4. 实际远端 SSH 地址、目标目录和更新资源 URL 统一配置在 **被 Git 忽略的 `release.local.json`**。从 `release.example.json` 复制；禁止在发布脚本中硬编码真实地址。构建产物只注入公共资源 URL，不注入 SSH 设置或签名私钥。
5. 发布到该配置的 `remoteDirectory`，同时覆盖两个程序及 `latest.json`、`android-latest.json`。远端只保留各平台一份正式资源。发布器必须验证双端版本、大小、哈希与签名；上传完成并校验后才替换正式资源。
   发布器只在服务器已有 `.next` 的完整哈希匹配时复用；新上传使用带超时与完整性检查的 SSH 流，失败仅重试暂存步骤，不能盲目重试正式切换。修改上传或资源服务时运行 `python scripts/verify-publish-transport.py`；线上同时核验固定 `/release-notes.md` 可读且哈希与签名清单一致。
6. 保留 `data/release-signing-key.json`、`data/android-signing.p12`、`data/android-signing-password.json`。不得重新生成已有身份。它们被忽略，密码绑定当前 Windows 用户；迁移构建机需安全迁移签名身份，不能提交 Git。
7. Android 自动检查和下载更新，系统仍要求确认安装；不得宣称普通 APK 能静默安装。验证清单 RSA 签名、SHA-256、包名、版本和 APK 安装证书。
8. 发布前运行 Node 回归与 Android 构建验证；Android 行为改动在隔离模拟器验证。记录具体通过项和未测试项，不把模拟器结果称作真机验证。
9. 更新 `ANDROID.md` 或相关复测说明。交付 APK/EXE 链接并提交推送源码、文档（包括本文件）。不提交 `dist/`、`work/`、`data/`、本机配置或原始私人证据。

行为验证未完成时先运行 `python scripts/build-release.py`，完成相应 UI/Android 验证后再用 `python scripts/publish-update.py` 同步发布；`--publish` 不是跳过行为验收的捷径。正常迭代沿用本会话已授权的固定资源目标，不修改网络或另建服务器；目标配置缺失/变化、官方应用需重启/升级等超出授权范围时再说明具体影响。

纯文档交接不改变软件行为或兼容性清单时，只校对引用、事实和 Git diff 后提交推送，不为此递增软件版本、重装客户端或发布双端产物。
