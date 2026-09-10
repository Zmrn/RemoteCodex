# Remote Codex 开发与发布约定

- 2026-09-10 最新发布：0.10.32 已从 `9b7dfa03f3056f7a686a0aaec8065b951e585c39` 经 GitHub Build `34498105728` 同次生成 APK/EXE，并正式发布 Releases/v0.10.32。先通过最终版本 259 项 Node22.19.0 和同提交 Checks `34497736006`，preflight 后仅派发一次，云端签名前门禁通过；构建、下载、草稿上传读回及匿名完整下载均一次成功。原签名/证书、源码/兼容清单/更新渠道、EXE 隔离运行时和官方 26.903.9818.0/PID30692 只读访问通过，包内策略 20/20 接口及 23/23 功能条件匹配；并非真实写入实测。隔离 0.10.31→0.10.32 设备保存/强制重启通过，现有客户端数据未改变。未完成 Chat 不在包中，未执行 APK/模拟器或升级现有客户端，未访问旧服务器或本地构建。正式包清单哈希以构建提交及包内实际字节为准：`d87d2cf363159c5ae95939c900b4886b5b4fabfd1cc5b14ee00b3299b4d4a3f2`；详细证据和范围见 GITHUB-UPDATES.md，下面的准备状态是历史阶段。

## 当前兼容策略（2026-09-10，覆盖下方历史版本限制）

用户要求“接口无异常就能用；有异常也不能停用正常部分”。运行时、状态接口和帮助页统一用 `official-desktop.json` 的实际 tools/ipc 名单与 features 依赖表判断。新版本号本身不再禁用操作；缺失、不匹配、未知只限制依赖该接口的功能。不能简单加版本白名单、绕过身份/owner/轮次/回执验证，或把只读接口匹配标为完整操作实测。

`verifiedVersions` 仅记录历史行为验证。连接证据来自当前已核对的官方进程、实时 tools/list、同包静态 IPC 表和握手，绑定连接与目录，不接受客户端报告作为写入授权，不落盘。最新下载包只用于对照，不控制正在运行的版本。工具和 owner 管道分别判断；owner 握手失败可保留官方工具读取/文字新建等功能，未确认的管道不发送操作。缺少列表/项目/模型目录不能把设备整体判为断线或阻止默认设置发送。

实现与复测见 COMPATIBILITY-VIEW.md、test/feature-compatibility.test.mjs、scripts/verify-feature-compatibility-ui.mjs。源码修复完成时保持 Remote 0.10.31；用户随后明确要求发布，本轮准备 0.10.32，同提交 Checks 通过后才派发 GitHub 双端构建，正式结果以 GITHUB-UPDATES.md 发布记录为准。本机 26.903.9818.0 仅采集真实只读接口证据，没有执行真实任务写入。Chat/Work 的未实现功能仍不开放，未完成 Chat 工作单独保留；不执行 APK 或升级现有客户端。

## 打包发布的执行顺序（2026-09-10，优先于下方历史记录）

用户要求减少失败和重复通知。**先验证最终版本，再等待同一提交的 Checks 成功，最后才派发正式构建。禁止 push 后把 Checks 和签名构建同时启动。** 只有用户明确要求打包/构建才生成APK/EXE；修改流程、文档或修复需求不构建，也不通过关闭Checks或通知来掩盖失败。

1. **确认与隔离。** 在真实Git根目录确认origin为GitHub、当前分支、工作区及origin/main新提交。有未完成工作时使用干净隔离worktree；保留未完成Chat差异和用户配置，不用`git add -A`、不重放旧stash，不访问Gitee或旧服务器。
2. **先定最终版本。** 检查GitHub现有Release/标签及未完成草稿，避免复用已发布版本；只在`package.json`升版本，补`releases/版本.md`，兼容范围仍来自中央清单。不要先跑旧版本测试再升版本直接打包。
3. **提交前验证。** 使用CI同版Node **22.19.0**（核对`node --version`，必要时使用已知绝对路径），在最终版本工作树执行`npm test`、`npm run compatibility`、`git diff --check`；修改共享界面或原生模块时补相应已有专项验证。工具链以workflow为准，CI固定Temurin21/API35。升级测试的“新版”从当前版本推导，不能写死下个正式版本；异步UI检查等待可观察结果，不用过短固定睡眠。失败先定位并修正，不反复推送碰运气。
4. **提交并等待Checks。** 只提交本次已完成文件，推送GitHub main，记录完整SHA。`node scripts/github-actions.mjs status`找到该SHA的Checks运行，`watch CHECKS_RUN_ID`等待成功。失败/取消/仍在运行/缺失均不能构建；改代码、版本或构建说明后是新SHA，重新验证并等待新SHA的Checks，不能引用上个提交的绿灯。
5. **只派发一次并固定运行。** 在干净且与GitHub main一致的工作树，先执行只读`node scripts/github-actions.mjs preflight`，通过后才`node scripts/github-actions.mjs build`。build再次检查同SHA的Checks，GitHub工作流在签名配置前也检查自己的GITHUB_SHA；网页手动启动不能绕过。保存requestId、完整SHA和build runId，后续只用这个runId执行watch/download/publish，不用“最近一次运行”猜测。
6. **失败按状态处理。** Checks失败只修Checks，不派发Build；确定构建失败时先读失败步骤日志，修正后通过新提交Checks再构建，不回退本地。网络超时或派发结果未知不等于失败：用status中的Build requestId及SHA找已派发任务，未确认前不重发。已有成功云产物的下载/上传失败只恢复该次产物，不重建。
7. **验证同次产物。** `download BUILD_RUN_ID`下载并验签；核对双端版本/源码SHA/运行ID、原RSA与APK证书、哈希/包名/versionCode、兼容清单、GitHub更新源、包内容无用户配置或私钥。不得混用其他run或本地重建产物。包内容验证、隔离运行时检查、真实官方连接及APK行为各自记录；官方管道不可用不等于安装包坏，也不能标成真实桥接通过。沿用用户不执行APK、自行更新验证的安排，不擅自安装或升级现有客户端。
8. **草稿发布并读回。** 验证后`publish BUILD_RUN_ID`，标准发布器上传八项资源并逐项读回核验才公开。上传/公开结果未知时先检查同版本草稿、构建标记及资源；确认状态后使用同run恢复，不盲目重传、不删资源、不覆盖已公开版本。公开后匿名读取latest签名清单，再按固定版本完整下载双端包与说明核对。
9. **收尾与交付。** 推送发布记录，保全未完成工作并逐条核对增删行；如使用stash，只应用本次记录的对象一次且保留。提供APK/EXE链接，明确官方版本、平台、Codex/Chat/Work范围及未验证项。纯发布记录提交不再次打包，已发布产物仍对应构建SHA。

0.10.31的教训：版本从0.10.30升为0.10.31后，测试仍将0.10.31当可升级目标；未先跑最终版本测试且并发派发Checks/Build，导致同一问题产生两次失败通知。9bdd09d已修为动态候选版本；本流程与入口检查用于提前阻断同类问题。网络失败仍可能发生，按固定运行恢复，不承诺外部服务永不失败。

- 本轮仅完善流程与入口，保持版本0.10.31，不构建/发布/安装。新增只读命令`preflight`与`check-commit SHA`；Checks查询失败保守阻止构建。回归入口`test/github-checks.test.mjs`，执行详情见GITHUB-ACTIONS.md。

- 2026-09-10 最新发布：0.10.31由GitHub构建34483037972从9bdd09d03bbbeec6337d60331d3c245cdd988dbb同次生成并正式发布Releases/v0.10.31，Checks34483033637通过；更新版本展示/接口页面/网站授权/会话命名与列表修复已进入双端包。原签名/证书、双端包内容与源码、兼容元数据、隔离旧云包升级/强制重启数据保护及匿名latest/固定版本完整下载通过。EXE包内Node/Python/DPAPI通过，但官方app-tools管道不可用，真实桥接自检未完成，不引用0.10.30的通过结论。未执行APK、未升级现有客户端、未写真实任务；官方兼容名单未扩大，8份未完成Chat改动不在包中。首次34482830222因更新测试写死0.10.31失败，修测试后重新云构建，无本地构建；发布网络失败后只读确认同运行空草稿，再恢复标准发布器。详细哈希和范围见GITHUB-UPDATES.md，下面准备/未发布条目是历史状态。

- 2026-09-10：用户明确要求“发个包”，准备0.10.31 GitHub同次双端构建发布，包含更新版本展示、实际使用接口兼容性页面、网站授权及会话命名/重命名/列表同步。release/0.10.31隔离工作树仅含已提交内容，原8份Chat修改留在主工作区；不本地构建、不执行APK、不升级现有客户端、不扩大官方版本名单。最终runId、签名/包内容与线上核验结果以GITHUB-UPDATES.md正式发布记录为准，不能将此准备记录当作发布成功。

- 2026-09-10：普通创建不再传Probe标题/目录或登记测试目标，自动命名交官方；内部测试必须createProbe显式登记，普通HTTP不能选择Probe。会话行右键/移动共享界面长按经官方set_thread_title改Codex名；核对原名/ID/连接，ACK不覆盖列表、未知不重放，Chat禁用。创建ID立即打开内容，列表不等项目、每5秒轮询及事件合并刷新、拒绝乱序/旧连接返回，历史标题不反写列表；官方索引缺新ID时仅同步提示、不补行。官方list_threads使用stateDbOnly索引且等待其他来源，不能承诺5秒内一致。243 Node22、8组新UI/项目UI/9组侧栏回归、23 Java编译及POST路由通过；未真实创建/改名、未构建发布安装或执行APK，未完成Chat修改独立保留。见THREAD-LIST.md。

- 2026-09-10：共享会话界面接入 Browser 网站访问授权：拒绝、一次、请求声明支持时的 session/此网站。待申请与结束只服从官方 owner requests/completed/action；ACK 不清卡。新 MCP elicitation v1 纳入实际接口名单（现 20 项），服务端复核新 owner/请求指纹、严格生成固定 response，跨客户端/重启保护未知派发不重放。只适配官方 26.903.8094.0；全网站授权缺官方策略读取入口，转官方应用处理；不扩大为任意 MCP、Chat/Work 或其他审批。236 Node、8 组新 UI、7 组兼容 UI、原问答 UI 和 23 Java 源文件编译/主机路由通过；真实申请只读、未真实授权往返，见 BROWSER-APPROVALS.md。本轮不构建/发布/安装或执行 APK，未完成 Chat 修改独立保留。

- 2026-09-10：帮助页增加“官方接口兼容性”，只检查中央清单 tools/ipc 中 Remote 实际使用的 19 项指令，名单外变化不报异常。独立只读连接获取运行版 tools/list，公开官方更新清单获取最新版号，已下载同产品包提供静态 IPC 版本；新版未运行时工具参数保持未知。缺指令/所用参数或版本不符标红，无证据标待验证；不发任务消息、不保留官方状态副本、不自动扩大支持版本。Windows/Android 共用页面与目标端 GET 报告，见 COMPATIBILITY-VIEW.md。本次只开发/回归，未构建、发布、安装或执行 APK，未完成 Chat 改动独立保留。

- 2026-09-10：帮助/设备更新页共享展示当前安装、最近验签的远端最新版、实际下载目标、已校验安装包版本及检查时间。下载包版本必须来自候选包和自身签名清单的校验，不能从 waiting/最新版本推断；重启重新核验，旧包和新清单分别显示，旧端缺字段明确未知。切设备或用户操作后的迟到请求不能覆盖新状态或改变安装目标。见 UPDATE-STATUS.md；本次仅源码修复及隔离回归，未构建/发布/安装或执行 APK，原 8 份未完成 Chat 修改独立保留。

- 2026-09-10：0.10.30 已由 GitHub Actions 34463415359 从 5f1d660 同次构建 APK/EXE，验签后正式发布 GitHub Releases/v0.10.30；包含 6a01f4d 图片加载/重试与 Ctrl+Enter 调整方向、f88b318 官方已读通知修复。Checks34463387667通过；原APK证书、双端清单/哈希/源码/渠道/兼容元数据、EXE隔离自检及旧云包到新云包设备保存/强制重启通过；八项资源草稿上传读回后公开，匿名latest清单和固定版本完整下载核验通过。未执行APK、未更新现有客户端、未写真实任务；8份未完成Chat修改不在发布中。完整结果见 GITHUB-UPDATES.md；下面“源码待构建”是开发阶段历史。

- 2026-09-10：已读回执与显示内容必须来自同一份官方 owner 合并结果；不能先用可能为空的原始历史生成回执。同步仍经官方 readStateChanged v3、身份/owner/最新回报/idle 核对并读回确认，绝不本地清点。最新回复末尾可见 800ms 即可，不要求滚完后续记录卡片；仅明确发送前失败可在仍可见时最多校验 3 次，发送异常/未确认/HTTP 丢失不重发。见 OFFICIAL-READ-STATE.md、scripts/verify-report-read-ui.mjs。当前源码修复待构建；实际问题任务仅只读，未修改官方数据、未执行 APK、未发布或安装。未完成 Chat 差异继续保留。

- 2026-09-10：正文/Markdown/放大图片统一加载占位，HTTP/解码失败可显式重试；Codex 运行中 Ctrl+Enter 直接经既有 owner steer v1 调整方向，普通发送仍入队。必须核对目标能力与新 owner 快照/当前轮次，未知不重放或回退；草稿和全部图片保留，预选设置留待下一轮。见 IMAGE-PREVIEW-VALIDATION.md、QUEUE-PREVIEW.md，复测 test/steer.test.mjs、scripts/verify-image-steer-ui.mjs。当前仅源码开发与隔离测试，未构建/发布/安装、未写入真实官方任务、未执行 APK；未完成 Chat 修改独立保留，官方版本范围不扩大。

本项目通过 Windows 上已运行的官方 ChatGPT/Codex 会话所有者转发操作。Android 是控制端，共用 `public/` 界面；不得启动独立 Codex 后端并将其称为桌面桥接。Chat 模式已实现列表与历史读取；文字续写通过官方 app-tools 的 Chat 分支，尚待专用真实会话验证，见 `CHAT-MODE.md`。

## 新会话接手

- 先确认实际操作系统、主机、工作目录、Git 远端/分支及工作区状态，不能把云端/沙箱测试说成本机验证。本机原工作区中的仓库位于 `outputs/remote-codex/`；直接克隆时以包含本文件与 package.json 的 Git 根目录为准。正式仓库为 `https://github.com/Zmrn/RemoteCodex.git`，默认 origin 与 main 上游指向 GitHub。2026-09-10 用户明确停用 Gitee，并将自行删除其仓库：GitHub 是唯一远端主仓库，本地不保留 gitee-archive，不再访问、同步或维护 Gitee。其他克隆也以 GitHub 为唯一目标，先核对实际 URL，不按远端名字猜测；历史记录中的 Gitee 地址不再是操作目标。
- 当前源码基线（2026-09-09）：Remote Codex **0.10.16**，部分历史优先显示可读内容，双端发布、笔记本内置更新和 Android 隔离横竖屏通过，见 [HISTORY-READ.md](HISTORY-READ.md)。0.10.15 新增 VS Code 持有共享 IPC 管道时的官方 ChatGPT 桥接，真实专用任务的 12 项检查通过，见 [VSCODE-COEXISTENCE.md](VSCODE-COEXISTENCE.md)。Windows x64 官方包 **26.901.6511.0、26.903.8094.0** 的 Codex 核心读写已验证。软件版本以 package.json 为准，官方支持范围以 src/official-desktop.json 的 validation 为准；交接快照不是实时状态，也不代表所有功能均已验证。
- 2026-09-09 接手笔记本已重建并发布最终合并 0.10.15 EXE/APK，包含 VS Code 共存和设备保护；笔记本内置更新及配置保留验收通过。130 项 Node、13 项窗口、最终 EXE 自检和包内旧版→新版强制重启测试通过。最终哈希及两台机器各自的验证范围见 VSCODE-COEXISTENCE.md、DEVICE-STORAGE.md；本机没有做最终合并 APK 的模拟器/真机行为测试。
- 最近修复及证据见 [CREATE-IMAGES.md](CREATE-IMAGES.md)：新建文字/多图、失败草稿保留、正式控制端跨设备发送；115 项 Node 回归、13 项窗口检查、Android API 35 横竖屏及真实官方 owner 测试已通过。新官方版本、Chat 写入、原生生图等不能由这些结果推定成功。
- 交接时有三份原有未跟踪文件：`CHAT-FEASIBILITY.md`、`scripts/build-chat-ui.py`、`windows/ChatUi.cs`。保留并在相关任务中单独审阅，不自动删除、覆盖、纳入发布或用 `git add -A` 顺带提交；它们不是已完成 Chat 功能的证明。
- `work/` 中的现场证据、临时设备更新脚本和 `release.local.json` 不在 Git 中。新克隆缺少它们时，从已提交文档与 scripts 中的复测入口接手；不要杜撰设备地址、访问密钥或重新生成签名身份。
- 接手和每次迭代后更新相关功能文档及本文件的必要约定。按日期识别历史验证记录；若与当前源码、中央清单冲突，先复核并纠正过时说明，不把老报告当当前限制。

## 产品行为约定

- 2026-09-10 用户明确要求最新版构建后，0.10.29 已由 GitHub Actions 34443633443 从 9c9080e 同次生成双端产物，并正式发布到 GitHub Releases/v0.10.29；签名/哈希、APK原证书、EXE隔离只读自检、匿名latest清单及固定版本完整下载通过，见 GITHUB-UPDATES.md。没有本地构建、安装更新本机、执行APK或操作旧服务器；原8份未完成Chat修改保留。只有明确构建指令才构建。旧版入口嵌在包内，迁移版需首次从GitHub手动覆盖安装，保留数据，不改旧服务器做跳转。原SSH发布器和本地--publish已拒绝运行。

- 2026-09-10：0.10.28 通知排版/5 秒自动收起已双端发布、笔记本内置升级通过，设备与通知草稿保留、官方 PID 未变。198 Node、41 原生通知、13 窗口、最终包自检/强制重启及线上签名通过；未执行 APK、未进行真实两设备通知回复测试。最终哈希与范围见 NOTIFICATIONS.md。已合并另一设备 GitHub 构建提交并保留双远端；本机经 Git Credential Manager 浏览器授权完成登录，源码已同步 GitHub/Gitee，登录凭据不导出。

- 0.10.28 通知默认 5 秒无操作收起，输入/键盘/点击重新计时；草稿先保存再关闭，输入后清空和仅焦点不应永久保留窗口。发送中/保存失败保持输入保护。卡片按统一缩放和字体测量布局、回复按需展开；关闭回执失败不能重新弹出，只允许显式恢复指定草稿。见 NOTIFICATIONS.md；本轮继续不执行 APK。

- 0.10.27 Windows 通知只监听其他设备，排除 local、本机网络地址及同一 instanceId；所有设备独立重连，不依赖当前页面或隐藏 WebView 的计时器。只从新官方 owner 快照投影事件，投递去重不能成为自有未读/已回答状态；显示/关闭不写官方回执。普通回复保留独立草稿与稳定请求 ID，未知结果不重发，配置变化不得重定向草稿。两端需更新；Chat/Work 通知不支持，当前 owner 适配仅 26.903.8094.0。见 [NOTIFICATIONS.md](NOTIFICATIONS.md)。本轮继续不执行 APK，由用户更新验证。

- 0.10.26 用户明确区分本地未发送草稿与官方事实。官方列表、当前状态、已读、已回答、已应用设置和消息成员均以官方来源为准；不得由旧创建记录、历史结果、done 或 accepted 回执补造。未发送的文字/图片/回答/预选设置、设备偏好与防重复提交记录继续本地保护，不逐字同步草稿。官方进程目录经核对后供队列/目录备用读取，不使用桥接器环境猜测。详细规则和复测见 [OFFICIAL-DATA.md](OFFICIAL-DATA.md)。

- 0.10.23用户要求统计只服从官方状态，覆盖早期Remote自有已读定义。禁止用本地回执、历史完成或安卓缓存推断当前未读/运行状态。统计使用schemaVersion=2/statePolicy=official-only、独立短时官方owner快照；没有确认就未知。旧task-receipts.json/readTokens不再读写，设备/密钥/草稿保持。用户实际阅读只请求官方清除标记，官方未确认不本地清零、不自动重放。安卓仅内存短时渲染观察，离线/过期/旧协议不计数。实现及未测范围见OFFICIAL-READ-STATE.md、WIDGET.md；用户不执行APK的安排继续。

- 0.10.22清空取回草稿仅由用户文字输入/移除图片事件触发，必须文字和图片全空；不能从导航、初始化或通用saveDraft推断删除。已有draft恢复记录可显式删除，不清除新输入或其他设备草稿。删除意图先持久化，ack-recovery只删Remote对应本地备份且可幂等重试，不能扩大成官方队列/消息重放。未知取回/steer记录保留保护。IndexedDB快照克隆并串行写入，防止旧保存覆盖新删除。复测见QUEUE-PREVIEW.md。额度倒计时按墙钟每秒刷新，见USAGE.md。沿用用户不执行APK、自行更新验证的安排。

- 0.10.21接入官方26.903.8094.0本机Codex双向已读，用户于2026-09-10明确要求反向清除官方标记。统计只读、保守跨分区排除，不批量生成回执；用户真实可见阅读后先保存Remote精确回执，再经官方IPC核对身份/本机host/owner/当前回报后清除标记，未确认不重放。不得直接改写官方文件；登录身份投影不能输出令牌。仅本机默认执行环境/当前已加载owner；Chat/Work和其他版本仍不支持该同步。源证据、8项真实专用任务检查、官方任务级通知无逐轮CAS边界见[OFFICIAL-READ-STATE.md](OFFICIAL-READ-STATE.md)。用户自行测APK安排继续。

- 0.10.20已双端正式发布，笔记本内置更新及2项设备/选择/密钥/接入与更新设置保留验收通过，官方进程未重启；产物与未测范围见SIDEBAR-NAVIGATION.md。

- 0.10.20切换Codex/Chat与设备必须保持侧栏当前开合状态；自动恢复任务不得再次收起，异步完成不得强制展开。仅对应下拉菜单收起，显式任务导航保留原收起行为。侧栏覆盖正文时不能产生已读回执，关闭后按实际可见性判断。复测和范围见[SIDEBAR-NAVIGATION.md](SIDEBAR-NAVIGATION.md)。用户自行更新验证APK的安排延续，本轮不执行APK。

- 0.10.19 已双端正式发布并完成笔记本内置更新，2项设备/选择/密钥及接入、更新设置和历史保留，官方进程未重启；产物、验收与未测项见WIDGET.md。

- 0.10.19 已按用户批准实施任务概览新设计及2×2卡片正方形适配。每个小组件独立读取桌面尺寸，Android12+响应式RemoteViews、旧系统横竖屏双布局；汇总页设备筛选只影响本页，连接服务、全局设备选择、密钥与已读持久化保持。WidgetSnapshot为只读聚合，与WidgetSizing通过主机JVM20项检查；沿用用户更新后自行测APK的安排，未执行APK，不能宣称厂商启动器尺寸或原生点击已实测。范围见WIDGET.md；此前“设计稿尚未实施”的描述只代表0.10.18及更早状态。

- 0.10.18 Android 全部设备统计与重连独立于当前页面，使用可暂停的 connectedDevice 前台服务；正常约15秒、失败独立退避到30秒，逐设备保存结果。只有 status/connect/summary 可以进入自动恢复，不能重放任务写指令。数据保护和系统后台限制见 WIDGET.md。本轮延续用户自行更新 APK 测试的安排，未安装/运行 APK，不能把主机 JVM 检查当作 Android 前台服务实测；汇总页新设计尚未获实施指令，未混入此版。

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
- 官方列表可能暂缺新任务。创建回执仅用于请求保护和真实 ID 导航，不能补入侧栏；列表等待官方返回。复测见 `PROJECT-CREATION.md`、`OFFICIAL-DATA.md`。

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

## 构建与发布（2026-09-10 用户最新约定）

- **只有用户明确要求构建/打包时才生成 APK/EXE，统一使用 GitHub Actions，不在本地构建。** 普通需求、修复、review、源码提交或“确认能否构建”只做相关开发/测试/提交，不自动构建、发布或升级客户端。这条覆盖旧文档中“每次迭代必须构建发布”和本地构建流程。明确要求发布但没有可用云端产物时，先说明需要构建，不能把发布或测试需求自动当作构建指令。
- GitHub Actions 和对话式构建入口见 [GITHUB-ACTIONS.md](GITHUB-ACTIONS.md)。收到明确构建指令后，先将本次完成的源码提交到 GitHub main，并从与远端一致的干净工作树执行 `node scripts/github-actions.mjs build`，使用返回的 runId watch/download。未完成修改保留在原工作区；不能混入构建或因其未提交就覆盖/丢弃。派发结果未知不能重复提交，云端失败也不能擅自回退本地构建。源码只推 GitHub，合并保留其他设备提交，不能强推。
- push/PR 的 Checks 自动回归继续保留，但不生成正式 APK/EXE 或发布资源。Build EXE and APK 仅 workflow_dispatch。已核对 GitHub 读写权限、active 工作流、signing 三项 Secrets 和原APK证书变量，以及成功双端构建 34437906384；更新入口改由源码配置声明。本次更新渠道改动没有触发新构建。
- CI Checks 无正式密钥；正式双端 build 只用 main 的 signing 环境和原签名身份。不得上传本地 DPAPI 登录凭据、SSH 凭据、用户数据或整个 work/data；签名材料只通过获授权的 GitHub 加密 Secrets 配置，缺失时报错，不生成替代证书。产物仅白名单文件，保留 3 天，固定标准 windows-2022，不启用付费规格。云端构建不代表真实官方桥接验证，不登录 ChatGPT/执行 APK，不自动改现有更新入口或部署资源；构建与正式发布是两个操作。
- 2026-09-10 用户已授权并完成 signing 环境原签名配置，通常无需再次迁移或上传。首次双端云端构建 `34437906384`（源码 `20d782f`、0.10.27）及对话式下载验签通过：198 Node、49 主机 JVM、原 APK 证书和双端清单/哈希；详情、产物哈希及官方支持范围见 GITHUB-ACTIONS.md。本轮未安装/运行 APK、更新现有客户端或发布更新资源。同版本云端重建不能覆盖已发布的正式资源。

- **每次发布必须在发布说明和最终交付中明确列出支持的官方 ChatGPT/Codex 桌面包版本、平台、Codex/Chat/Work 支持范围及未验证项。不能只写 Remote Codex 自身版本，也不能把“可以连接/读历史”当作新版完整兼容。**
- 官方接口和已验证版本统一在 src/official-desktop.json 管理；运行代码使用 src/official-protocol.mjs，不得重新散落硬编码版本、IPC 方法及版本号。升级处理遵循 COMPATIBILITY.md；接口字段/适配位置和回归入口见自动生成的 COMPATIBILITY-INTERFACES.md。
- `codex-ipc` 是共享转发管道，其 PID 可能属于已验证的 Microsoft VS Code；不能再要求它与官方 app-tools 同一 PID。官方 app-tools 身份、转发进程签名/产品、任务 owner 是三个不同检查，不能只按 Code.exe 文件名放行，也不能把 supportsUntrustedAppInput 当作 ChatGPT 身份证明。规则与已测组合集中在 discovery.sharedBroker；维护/复测见 VSCODE-COEXISTENCE.md。
- 新官方版本按实际接口依赖逐功能启用；只有完整行为实测才更新 verifiedVersions 和 validation，不能将只读接口匹配当作实测。变动的接口只影响所依赖功能，未知不视为匹配。更新清单后执行 node scripts/compatibility-report.mjs --write 和 npm run compatibility。
- 双端构建报告、签名更新清单及 RELEASE-NOTES.md 必须来自同一份兼容性清单。发布器必须拒绝缺失/过期元数据和混用旧产物；GitHub Release 内的说明哈希受更新签名保护。

1. `package.json` 是唯一正式版本来源。APK versionCode 为 `major*1000000 + minor*1000 + patch`；minor、patch 必须小于 1000。
2. **明确构建时由同一次 GitHub Actions 生成 Android APK 和 Windows EXE。** 正式发布继续由本会话负责，使用该次云端产物完成双端验证与发布，不允许只发布一端或用本地重建替代。下载后的源码、版本、提交、兼容清单、双端签名与哈希必须相符；已有同版本正式资源不能被同版重建覆盖。
3. 固定文件名为 `RemoteCodex.exe`、`RemoteCodex.apk`，版本显示在程序左下角；不要在文件名中加版本。
4. 公共更新入口统一在 `src/update-source.json`，使用本仓库 GitHub Releases；本地 release.local.json 仅保存工具路径等被忽略的开发配置，旧 baseUrl/SSH 项不再参与构建或发布。不得向应用注入设备/登录凭据或私钥。
5. 同次云构建下载验签后执行 `node scripts/github-actions.mjs publish RUN_ID`，在固定提交对应的 v版本草稿Release中上传明确的八项资源，逐项从GitHub读回验签/哈希通过才公开。已发布同版本不可覆盖，标签/运行/资源不符拒绝。未知结果按同版本运行检查后恢复，不盲目重试公开操作。客户端清单走latest入口，安装包按已验签版本固定到tag；不再向旧服务器上传或配置跳转。测试和首次迁移见 GITHUB-UPDATES.md。
6. 保留 `data/release-signing-key.json`、`data/android-signing.p12`、`data/android-signing-password.json`。不得重新生成已有身份。它们被忽略，密码绑定当前 Windows 用户；迁移构建机需安全迁移签名身份，不能提交 Git。
7. Android 自动检查和下载更新，系统仍要求确认安装；不得宣称普通 APK 能静默安装。验证清单 RSA 签名、SHA-256、包名、版本和 APK 安装证书。
8. 发布前运行 Node 回归与 Android 构建验证；Android 行为改动在隔离模拟器验证。记录具体通过项和未测试项，不把模拟器结果称作真机验证。
9. 更新 `ANDROID.md` 或相关复测说明。交付 APK/EXE 链接并提交推送源码、文档（包括本文件）。不提交 `dist/`、`work/`、`data/`、本机配置或原始私人证据。

行为验证未完成时继续相关测试，不自行构建。明确要求构建后下载对应云端产物，完成适用的包/行为验证后再按发布安排使用GitHub Release发布器，不重新构建。用户已要求停止远端服务器中转，不再使用旧SSH发布目标，也不迁移SSH凭据。官方应用需重启/升级等超出授权范围时再说明具体影响。

纯文档交接不改变软件行为或兼容性清单时，只校对引用、事实和 Git diff 后提交推送，不为此递增软件版本、重装客户端或发布双端产物。


- 2026-09-10：0.10.21已双端正式发布并完成笔记本内置更新。160项Node、13项窗口、9项隔离目录与身份投影、40项主机JVM、共享UI/侧栏/设备重连及8项真实专用任务已读检查通过。最终EXE包内运行时/已读元数据检查与双端签名/原证书/线上哈希通过；未执行APK。升级前后2项设备/选择/密钥/接入与更新设置/回执/历史保留，官方PID108796未变。EXE 44073984字节SHA-256 `04a6913d5985adace7a405b317a08550d275715f1ad32d8aa547967ed7029f2d`；APK 236614字节SHA-256 `6354b2d08863f65b7897158ec79915b5d80a3b7110c7464f3f6bc7f27b43a475`；清单 `ab30ffef217375389e999593b6cb3d31b3365e6e855ab163963717a8f191cc82`。同步范围与协议边界见OFFICIAL-READ-STATE.md。

## 0.10.24 连接诊断与数据保护

2026-09-10：连接诊断、旧设备草稿隔离、Android 带校验独立历史设备存储、通知未知状态、官方统计公平扫描和关键配置保护见 [CONNECTION-DIAGNOSTICS.md](CONNECTION-DIAGNOSTICS.md)。旧文档中的 SharedPreferences 可变设备存储由本版迁移替代；原文件仅作迁移输入，Keystore 与加密密钥保持。统计仍只服从官方，无自有已读/运行缓存。关键配置保护中，损坏请求记录不得重放，双副本不一致不得静默覆盖。用户不执行 APK、自行更新验证的安排继续。

- 2026-09-10：0.10.24 已双端正式发布，笔记本内置更新、两设备数据保留和官方 PID 不变通过；170 Node、13 窗口、49 JVM、共享 UI、最终包强制重启与只读诊断通过。未执行 APK；完整哈希、证据和官方支持范围见 CONNECTION-DIAGNOSTICS.md。

- 0.10.25：侧栏蓝点不再代表 completed，而只表示与小组件共用的官方 owner hasUnreadTurn 已确认未读。缺字段/不支持/离线/过期显示未知，不从历史、选择或本地回执推断；官方已读确认会使确认前的在途统计失效并重新采集。见 OFFICIAL-READ-STATE.md。保留设备/密钥/草稿；本轮继续不执行 APK，由用户更新验证。

- 2026-09-10：0.10.25 侧栏官方未读修复已双端发布，笔记本内置更新与两设备数据保留通过；174 Node、13 窗口、共享 UI、官方只读与最终包重启通过，未执行 APK。哈希及详细范围见 OFFICIAL-READ-STATE.md。
