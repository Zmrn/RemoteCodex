# Android 0.10.0 本机验证（2026-09-09）

环境：Windows 主机，Android Studio JBR 21.0.4；Android platform 35、build-tools 35.0.1；独立 AVD 位于项目 `work/android-avd`，设备固定 `emulator-5580`。没有修改用户原 AVD，没有向检测到的物理手机安装。Node 回归 56/56 通过。

| 验证项 | 结果 | 实际证据与限制 |
|---|---|---|
| 发布 APK 构建与签名 | 已通过 | `RemoteCodex.apk`，包名 `com.anso.remotecodex`，versionName `0.10.0`，versionCode `10000`；apksigner v2/v3 校验通过，无原生 CPU 依赖。 |
| APK 本机运行 | 已通过 | 0.10.0 初始构建通过 ADB 安装并启动；相同实现的 0.9.999 隔离升级测试构建实际运行，执行后续读取、布局、下载与验签验证。 |
| 首次添加设备流程 | 已通过 | 空列表时输入框禁用；新任务按钮打开设备添加入口；不会产生手机本地任务。`smoke` instrumentation PASS。 |
| 横竖屏布局 | 已通过 | `layout` instrumentation PASS：横屏 `innerWidth > innerHeight` 且桌面布局，恢复竖屏后手机布局；初始竖屏抽屉关闭。 |
| 真实 Windows 桌面读取 | 已通过 | APK 原生代理经 Tailscale 连接本机已有桥接服务；官方状态 connected，读取真实任务列表及专用任务 `01a08123-5291-7d23-8b50-ab02a7518acd` 的非空消息。数据源 `official-desktop-tool-read + verified-owner-live-items`。 |
| 调用链 | 已通过 | APK 内嵌界面 → Android 127.0.0.1 私有查看服务 → 已配置的 Windows Tailscale 接入 → 官方桌面 IPC / 会话所有者。没有启动独立 Codex 后端。 |
| Android 真实消息写入 / 问答 / 队列 | 未测试 | 已接共用界面和相同 Windows 路由；本轮 APK 只读验证没有向任何真实任务发送测试消息。不能据此宣称这些交互已完成 Android 端实测。Windows 既有路由回归通过。 |
| Android 图片选择、原图保存、文件下载 | 部分通过 | 原生系统选择器、原文件流式缓存和系统保存入口已实现并编译；本轮未完成 Android 端文件选择与保存操作实测。普通图片文件链路也不代表原生生图工具验证。 |
| 设备密钥存储 | 已通过 | Android Keystore AES-GCM 往返一致；SharedPreferences 不出现明文密钥；公开设备列表不返回密文。测试访问密钥通过一次性本机种子服务送入测试应用，未写入源码、APK 或 Git。 |
| 私有查看服务 | 已通过 | 无应用会话 Cookie 读取 HTML 返回 403；有 Cookie、无 CSRF 访问 API 返回 403；仅绑定 127.0.0.1，未对网络开放手机控制服务。 |
| 自动更新发现、下载、验证 | 已通过 | 0.9.999 测试构建自动获取资源服务器签名清单并下载正式 0.10.0；phase=waiting；APK 大小、SHA-256、包名、versionCode、当前安装证书全部验证成功。伪造清单签名被拒绝。 |
| Android 系统确认安装完整更新 | 部分通过 | 实际打开“允许此来源”设置并启用，系统弹出“Do you want to update this app?”，点击 Update 后进入 Installing。模拟器 Play Protect 记录 `ALLOW_LIST_DOWNLOAD_FILE_NOT_FOUND_EXCEPTION`，随后停留 JIT scan / 待验证阶段，未确认最终安装完成。未关闭扫描或其他系统安全限制。 |
| 升级后设备及草稿保留 | 未测试 | 升级前已保存 `ANDROID_UPGRADE_DRAFT`，但上述系统安装未完成，不能将数据保留标为通过。正常持久化路径已经实现。 |
| APK 后台六小时调度与手机省电 | 未测试 | 使用 Android JobScheduler；本轮主动执行同一检查逻辑通过，没有等待六小时，也没有物理手机待机验证。 |
| 双平台发布 | 已通过 | 签名并发布同版本 APK、EXE 和两个清单；服务器逐个验签、校验大小与哈希后替换，确认各只有一份正式资源。 |
| Windows EXE 运行与更新 | 已通过 | 新 EXE `--self-test` exit 0；内置 Node/Python、DPAPI、Web 资源、命名管道、官方项目及任务读取均 passed。本机与已保存笔记本均从 0.9.12 在线更新到 0.10.0，更新状态 current；本机官方会话 connected，桌面启动器 SHA-256 与发布包一致。 |
| 物理 Android 手机 / 普通 Chat | 未测试 | APK 交付用户安装；此次未触碰物理手机，Chat 模式沿用未接通状态。 |

正式 APK：165812 bytes，SHA-256 `44f767e6c69228d2e54e05338a6543951efd21ea2178825c865537e5d56f5be3`。

正式 EXE：43993600 bytes，SHA-256 `912fcafe267d2ad2bb3e2d147541353618fca178d3dbee5170ca612097c08e5f`。

APK 安装证书 SHA-256：`3c0a98ec3c9f37318525f5d0e4afb3417812215d625e48a9013b5ee649acb2b1`。后续必须保留同一签名身份。

打包清单检查：APK 共 28 项，未包含签名私钥、密码、本机发布配置、设备配置或 instrumentation 测试。内置 `release.json` 仅含公共资源 `baseUrl`；`release.local.json` 经 `git check-ignore` 确认忽略。

结论：可以交付可运行的 Android 控制端，真实官方任务读取与签名更新下载已完成验证；系统安装扫描的最终完成、升级后数据保留以及 Android 图片/写入交互保留为明确的复测项，不以 Windows 回归或构建成功代替这些实测。
