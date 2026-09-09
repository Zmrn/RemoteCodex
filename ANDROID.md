# Android 控制端

0.10.22 修复取回草稿清空后残留“继续编辑”：文字和图片全部清空时清理，旧残留可点垃圾桶删除；断线删除意图持久化，恢复连接只重试 Remote 本地备份清理，其他设备与草稿保持。额度重置时间后增加天/小时/分/秒倒计时。共享界面320/390竖屏、844横屏及重启回归通过，手机与目标电脑应一起更新。按用户安排仅构建、签名、静态包检查，不安装或运行 APK；详见 QUEUE-PREVIEW.md、USAGE.md。

0.10.20修复切换模式/设备时整个侧栏自动收起，保持原开合状态，仅关闭对应菜单；自动恢复任务和连接失败也保留侧栏。正文被侧栏覆盖时不生成已读回执。共享界面横竖屏与旧设备切换/已读回归通过，本轮按用户安排未执行APK，详见[SIDEBAR-NAVIGATION.md](SIDEBAR-NAVIGATION.md)。

0.10.19 将2×2小组件可见卡片调整为按实际格子短边居中的正方形，并按已确认设计重做原生任务概览页：深色系统栏、顶部刷新、分段数量、设备筛选和可查看的断线/部分统计详情。筛选只读展示，不修改设备配置或回执。构建及主机检查通过，延续用户自行更新后测试APK的安排，未执行APK；厂商桌面的尺寸和原生交互需在手机确认。见 [WIDGET.md](WIDGET.md)。

0.10.18 将全部已配置设备的统计连接放入独立前台服务，默认随应用打开启动；切换设备/退出页面不会停止其他电脑的重连，通知栏和帮助页可暂停/恢复。每台设备约15秒同步，失败独立退避重试，网络恢复时主动重连，结果逐台更新。Android 系统仍可能限制后台启动或停止服务；具体行为和未验证项见 [WIDGET.md](WIDGET.md)。本轮未安装/执行 APK，生产 Java 调度与恢复逻辑在主机 JVM 验证。

0.10.17 新增 2×2 桌面任务小组件，显示全部已配置设备的未读回报 / 运行中数量及分类汇总列表，目标 Windows 也需同步更新。计数、持久化、刷新频率与官方列表上限见 [WIDGET.md](WIDGET.md)。本轮按用户要求不运行 APK 模拟器/真机测试，构建、签名及元数据验收后发布，由用户更新后验证实际行为；下面的 API 35 行为记录均属于早期版本。

0.10.16 支持先显示官方可读的历史；较早或中间缺失段加载失败时，保留当前内容与草稿并提供手动重试。目标 Windows 接入端也需更新至 0.10.16。单轮本身超过官方通道上限时仍可能不可读，不跳过未知内容；复测入口为 `stage=history-read`，范围与本轮结果见 [HISTORY-READ.md](HISTORY-READ.md)。

0.10.15 已于 2026-09-09 由接手笔记本与 Windows 同步重建、验签并正式发布，包含 VS Code 共存及 Windows 设备保护修复。APK 使用原安装证书，最终包兼容清单与 Windows 一致；本机没有运行最终合并 APK 的模拟器或真机行为测试。原开发设备合并前的 Android 兼容性 PASS 单独保留为历史记录。被控 Windows 新增 VS Code 共享 IPC 支持，手机沿用同一个官方任务接口；精确版本、哈希和实测范围见 [VSCODE-COEXISTENCE.md](VSCODE-COEXISTENCE.md)。

0.10.14 已支持 Codex 新建时一次提交文字和多张图片，或者只发图片；目标 Windows 接入端也需更新。官方创建接口只有文字参数，因此同一任务会先完成一轮自动准备，再接收完整原生图片输入。Android API 35 横竖屏、失败保留草稿和正式设备转发均已验证，见 [CREATE-IMAGES.md](CREATE-IMAGES.md)。接手开发先读 [AGENTS.md](AGENTS.md)，下面带旧版本号的段落保留历史验证范围。

0.10.9 的设备菜单同时显示普通 Codex 的 5h 和周额度。Plus 主显示优先 5h，Pro 主额度只提供周窗口时显示周额度；Spark 独立额度只在详情出现。两类窗口由目标电脑的官方数据识别，被控 Windows 同样需更新到 0.10.9。复测为 `stage=usage`，见 `USAGE.md`。

0.10.8 在 Codex 新对话的输入框上方增加项目下拉，可搜索当前电脑的官方项目，选择后在其当前目录/分支本地执行；按设备保留选择。被控电脑也需更新到 0.10.8。Android WebView 的设备隔离、下拉交互与横竖屏边界已在隔离模拟器验证，见 `PROJECT-CREATION.md`；此更新不包含仍暂停的 Chat 新建/模型联动。

安装 `dist/RemoteCodex.apk`（固定文件名）。支持 Android 8.0 / API 26 及以上，使用系统 Android System WebView；较旧系统请保持 WebView 更新。APK 无原生 CPU 库，可在 ARM64、ARM 和 x86 系列设备上安装；本轮实际运行验证使用 Android 15 / API 35 x86_64 隔离模拟器，未安装到用户物理手机。

手机打开 Tailscale 并接入同一网络。Windows 电脑运行 Remote Codex，官方 ChatGPT 保持登录；在电脑编辑本机设备，开启已有 Tailscale 地址上的接入，取得 IP、端口和访问密钥。手机从设备菜单添加电脑并命名，之后可切换设备。

竖屏默认收起左侧栏，点击左上角展开，设备菜单仍在侧栏左下角；横屏使用桌面布局。Codex 新任务从主输入框发送文字或图片后创建。没有设备时，新任务按钮引导添加电脑，不会创建手机本地 Codex 后端。

Codex 的消息、项目、任务、队列、问答、模型和权限界面共用 Windows 前端，均转交所选电脑。图片从系统文件选择器选取；点击图片可放大。附件下载读取电脑上的原文件，再由 Android 系统选择保存位置。Codex 首条提交可以仅含图片；不同输入法能否将剪贴板图片作为文件交给 WebView 尚未实测，模拟粘贴事件通过不等于所有输入法均支持，图片选择器仍是可靠的手机上传入口。

0.10.1 从左上角下拉切换 Codex / Chat；竖屏先展开侧栏。Chat 显示独立的官方 ChatGPT 会话列表并读取历史，已有 Chat 的文字续写为试验性；被控 Windows 也需更新到 0.10.1 才开放文字入口。Chat 模型、图片、新建和队列暂未接入，详见 [CHAT-MODE.md](CHAT-MODE.md)。

返回键先关闭弹层或侧栏，否则将应用切入后台。手机切后台、断开或系统回收控制端进程不会中断电脑上的官方任务；回到前台时重新连接。0.10.18 启用全部设备同步时使用前台服务及持续通知；系统省电、强制停止和网络条件仍可能暂停连接。

## 自动更新

左下角问号直接显示当前版本、检查更新、安装更新和自动更新开关。默认前台每小时检查，Android 后台任务约每六小时检查（执行时机由系统省电与网络条件决定）。有新版时自动下载，进度显示在问号及更新面板，下载完成后通知用户安装。

**普通 APK 不能静默安装。** 首次更新时允许 Remote Codex 安装应用，此后每次仍需在 Android 系统安装器确认。必须能访问构建时配置的 Tailscale 更新资源地址；网络不可用时显示错误，后续检查会重试。

更新验证独立 RSA 签名清单、APK 大小与 SHA-256、包名、versionCode 和当前安装证书，拒绝篡改、降级和其他签名的 APK。设备列表与加密访问密钥留在应用数据中，正常覆盖安装不清除。不要先卸载旧版：卸载会删除设备、密钥和草稿。

## 本地构建与发布

构建使用 Python 3.10+、Node.js 22+、Android SDK platform 35 / build-tools 35.0.1 和 JDK 17+；原开发设备使用 JDK 21，接手笔记本最终合并包使用 JDK 17。通过 SDK 自带 aapt2、javac、D8、zipalign、apksigner 构建，无 Gradle 下载依赖。接手笔记本的工具链来自已校验的 Microsoft/Google 官方资源，没有修改 Unity SDK 或现有 Android 虚拟设备。

```powershell
Copy-Item release.example.json release.local.json
# 编辑 release.local.json，填入本机 SDK/JDK 路径、SSH 地址、目标目录和公共资源 baseUrl。
python scripts/build-release.py
# 确认 Android 行为测试后，同时发布 APK、EXE 和两个签名清单：
python scripts/publish-update.py
# 后续迭代的一步构建发布入口：
python scripts/build-release.py --publish
```

`release.local.json` 被 Git 忽略；实际 SSH 配置不写入应用，只有公共更新资源 URL 会注入构建产物。服务端使用 `scripts/serve-updates.py`，仅提供四个固定资源，不接收用户对话或账号信息。第一次从仅支持 EXE 的资源服务升级时，需要替换此脚本并重启资源服务。发布器在两个构建的版本、大小、哈希全部一致后才上传，服务端再验签并覆盖；远端每个平台只保留一份正式程序。

已有 RSA 发布身份不能重新生成。首次 Android 构建创建 `data/android-signing.p12` 和 DPAPI 加密的 `data/android-signing-password.json`。签名文件不入 Git、不打包；安全备份该身份，否则无法为已安装 APK 继续签发可覆盖安装的更新。

## 复测

0.10.7 同步更新设备菜单：每次展开重新读取设备列表，保存或恢复的设备无需重启页面即可出现。Windows 端修复配置缓存覆盖并加入可校验的双副本与系统文件锁，见 [DEVICE-STORAGE.md](DEVICE-STORAGE.md)。Android 保留原 Keystore / SharedPreferences 存储格式；`stage=device-storage` 验证页面启动后新增/删除设备的刷新、新存储实例读取以及已有配置保留。


0.10.6 同步修复问答输入和持久化、内容读取重试及订阅释放。结果图片下载优先携带来源设备/任务的鉴权媒体地址，原生层直接读取原文件；仅有 blob/data 图片时通过本机二进制下载入口传递原始字节，不转成膨胀的 base64 JSON。沿用媒体接口的 25 MiB 图片上限和普通附件的 256 MiB 上限。7 MiB PNG 已在隔离模拟器验证保存长度和 SHA-256 一致；测试用 instrumentation 拦截系统保存选择器返回目标 URI，再执行真实保存回调。用户物理手机未测试，完整结果见 [REVIEW-FIXES.md](REVIEW-FIXES.md)。

```powershell
adb -s emulator-5580 shell am instrument -w -e stage review-fixes com.anso.remotecodex.tests/.Probe
```

0.10.5 将会话 Markdown 改为随包内置的 GFM 解析器和安全 DOM 渲染。表格、嵌套列表、标题、引用、任务列表及代码使用 Windows/Android 共用样式；普通表格自动换行，宽表格只在容器内左右滑动。Android 15 隔离模拟器通过 `stage=markdown` 的表格结构、排版、安全链接、引用和横竖屏检查，未将模拟器结果视为物理手机验证。详见 [MARKDOWN.md](MARKDOWN.md)。

```powershell
adb -s emulator-5580 shell am instrument -w -e stage markdown com.anso.remotecodex.tests/.Probe
```

0.10.4 源码调整：WebView 放入原生安全区域容器，系统栏、刘海和键盘的 Insets 用来缩小 WebView 实际尺寸；不再把 padding 加在 WebView 内部。API 30+ 使用明确的 systemBars、displayCutout、ime 类型；API 26–29 保留 adjustResize 和旧 Insets 兼容路径。

0.10.4 的 Codex 图片选择器允许一次选择多张，多次选择或粘贴追加到草稿，单张移除。缩略图横向滚动，不撑高输入区。每条最多 20 张、每张 5 MiB、合计 10 MiB；保持原始图片字节，不自动压缩。草稿切换、更新恢复、队列取回和调整方向均保留多张图片及顺序。该版本的多图续写要求被控 Windows 同步更新，旧版目标明确拒绝多图发送并保留草稿；单图继续兼容旧版。当时 Codex 首条仍要求文字，此限制已由 0.10.14 的带图新建解除；Chat 图片仍未接入。

0.10.4 同时接入回复中的 HTTPS Markdown 图片（`![说明](地址)`），在原来的文字位置显示缩略图，支持点击放大和打开原图。图片从原网站加载，不转发会话文字、桥接密钥或页面 Referrer；原网站不可用时保留原图链接与重试按钮。原生附件仍使用原来的鉴权下载通道。验证结果见 [MOBILE-IMAGES-VALIDATION.md](MOBILE-IMAGES-VALIDATION.md)。

多图单元测试为 `test/multi-images.test.mjs`、`test/queue.test.mjs`；超过旧请求大小上限的传输测试在 `test/agents.test.mjs`。`scripts/verify-multi-images-ui.mjs` 使用隔离浏览器与假 API，测试追加、单独移除、无效批次、草稿恢复、队列与跨导航发送确认。`scripts/verify-multi-images-live.mjs` 使用 `work/multi-image-official-probe/` 持久化专用测试任务和请求 ID，经真实官方 owner 发送两张非敏感图并验证描述；不能将假 API 测试视为真实图片接收证据。

原生安全区域复测（仅针对隔离模拟器）：

```powershell
adb -s emulator-5580 shell cmd overlay enable-exclusive --category com.android.internal.systemui.navbar.threebutton
adb -s emulator-5580 shell am instrument -w -e stage safe-area com.anso.remotecodex.tests/.Probe
adb -s emulator-5580 shell cmd overlay enable-exclusive --category com.android.internal.systemui.navbar.gestural
adb -s emulator-5580 shell am instrument -w -e stage safe-area com.anso.remotecodex.tests/.Probe
```

`safe-area` 对比系统实际 Insets 与 WebView 屏幕矩形，包含竖屏、横屏、键盘弹出、回到竖屏以及多选 ClipData 顺序。刘海设备及旧 Android 版本仍需各自的运行验证，不能仅靠 API 35 构建通过作结论。

0.10.3 同步修复网页引用标记显示与复制，Android `stage=citations` 验证结果和官方来源元数据限制见 `CITATIONS.md`。

`android/test/Probe.java` 是单独的同签名 instrumentation 测试，不包含在交付 APK 中。先构建主 APK，再运行 `python scripts/build_android_test.py`，测试包在 `work/RemoteCodex-tests.apk`。安装、卸载、启动和截图命令必须写明测试模拟器 serial，不对未经指定的物理手机执行。

```powershell
adb -s emulator-5580 install -r dist/RemoteCodex.apk
adb -s emulator-5580 install -r work/RemoteCodex-tests.apk
adb -s emulator-5580 shell am instrument -w -e stage smoke com.anso.remotecodex.tests/.Probe
adb -s emulator-5580 shell am instrument -w -e stage layout com.anso.remotecodex.tests/.Probe
```

`smoke` 要求空设备列表；不要清空真实使用数据来满足它。真实读取测试使用已保存的设备以及显式指定的专用测试任务 ID。测试程序不向真实任务发消息。升级验证使用相同签名、较小版本号的隔离 APK，确认自动下载后，实际点击系统安装器，再核对安装版本与保留数据。详细本轮结果见 `ANDROID-VALIDATION.md`。


## 0.10.21 已读同步

任务概览缓存新增官方已读观察来源，精确回报同token时采用本轮已读，不让未知运行状态反写旧未读；离线/旧回报的官方观察不压掉在线计数。Remote实际可见阅读仍经共享界面，目标电脑负责通知官方；26.903.8094.0本机Codex验证范围及协议边界见OFFICIAL-READ-STATE.md。主机JVM验证生产缓存/聚合，按用户安排本轮不安装或执行APK。
