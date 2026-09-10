# GitHub 直接更新

最新发布为 [0.10.30](https://github.com/Zmrn/RemoteCodex/releases/tag/v0.10.30)，包含图片加载/重试、Ctrl+Enter 调整方向与官方已读通知修复；详细验证见本文末尾。0.10.29 是首次迁移到 GitHub 直接更新的版本。

2026-09-10 用户要求不再经原远端服务器分发更新。Windows 和 Android 更新入口改为 GitHub Releases，公开配置统一在 `src/update-source.json`。客户端不需要 GitHub 登录或访问密钥；设备互连仍沿用原连接方式。

2026-09-10 用户明确要求最新版云端构建后，0.10.29 已由 GitHub Actions 同次生成 APK/EXE 并正式发布到 GitHub Releases。下载后的原签名、双端哈希、EXE 包内只读自检及匿名 GitHub 更新下载均通过；未安装更新本机客户端、未执行 APK、未操作旧服务器。具体运行和产物见本文末尾。

## 更新链路

- Windows 查询 `https://github.com/Zmrn/RemoteCodex/releases/latest/download/latest.json`；Android 查询同目录 `android-latest.json`。
- 清单经过原 RSA 公钥验签后，按其中的版本下载 `/releases/download/v版本/RemoteCodex.exe` 或 `RemoteCodex.apk`。下载不会重新解析 latest，避免新版发布时把旧清单与新安装包混用。
- 两端最多跟随 5 次重定向，只允许 HTTPS 的本仓库 Releases 和 GitHub 的 release-assets/objects 资源域名；不携带设备密钥或 GitHub 凭据。网络失败、404、超限、签名或哈希错误均明确失败，不回退到旧服务器。
- Windows 的 SHA-256、长度、平台与安装保护保持；Android 的清单签名、APK 哈希、包名、版本与原安装证书检查保持，安装仍由 Android 系统确认。设备、密钥、草稿和历史存储格式不变。
- 原 `release.local.json` 与 GitHub 环境中的旧 `REMOTE_CODEX_UPDATE_BASE_URL` 不再决定安装包的更新源。包验收同时检查 EXE/APK 内嵌的 GitHub 入口；本机配置不能把旧服务器重新注入新包。

## 构建和正式发布

只有用户明确要求构建/打包时才运行 `node scripts/github-actions.mjs build`，随后用同一个 runId `watch`、`download`。日常 push/PR 只运行 Checks；构建工作流仍仅由 workflow_dispatch 启动，不因为提交而生成 APK/EXE。

正式发布使用已经下载并验签的云端产物：

```powershell
node scripts/github-actions.mjs publish <runId>
```

发布器只接受本仓库 main 成功的双端 build，校验运行编号、源码提交、GitHub 更新源、两个签名清单、构建报告、兼容清单、包哈希和发布说明。旧服务器入口的历史云构建因缺少新渠道证明被拒绝，不能直接当作迁移版发布。

发布先建立 `v版本` 的草稿 Release，目标固定到该次构建的完整提交 SHA。上传 APK、EXE、两个构建报告、两个签名清单、RELEASE-NOTES.md 和 GITHUB-BUILD.json，再从 GitHub 读回每个资源校验大小与哈希，全部通过后才公开。读回上限由已验证的产物大小决定。用户更新使用 Releases 的长期资源；Actions 中保留 3 天的临时 artifact 用于构建交付。

同版本/运行的失败重试先检查已有草稿和资源，不盲目删除、覆盖或重新上传；上传或发布结果未知时不自动重复操作。已发布版本不允许改写；发现另一运行占用标签、目标提交不符、资源异常或已有更新版本时停止。旧 SSH 发布入口和本地 `--publish` 入口已明确拒绝，不会再触碰旧服务器。GitHub 发布用现有 Git Credential Manager 授权，只向 GitHub API/上传域名发送凭据，不向资源 CDN 转发。

## 首次迁移

已安装的 0.10.28 及更早版本把旧更新入口写在包内，无法通过未升级的客户端直接获得新的入口。下一次构建并发布迁移版后，需要从 GitHub Releases 手动安装一次：Windows 替换程序时保留原数据目录，Android 使用同证书覆盖安装。此后按现有自动更新设置直接查询 GitHub。不要卸载并清理数据，也不通过旧服务器加跳转或补发迁移包。本次不改正在运行的客户端或用户数据。

下载页：[0.10.29 GitHub Release](https://github.com/Zmrn/RemoteCodex/releases/tag/v0.10.29)。这是首个使用 GitHub 直接更新入口的正式迁移版。

## 验证与范围

204 项 Node 回归和 22 项主机 JVM 更新网络检查通过。覆盖 GitHub/CDN 重定向、不转发凭据、HTTP/其他域名/循环拒绝、下载大小限制、固定版本、双端签名及来源校验、草稿公开顺序、未知上传/发布结果恢复、已发布资源不可覆写、版本回退和标签冲突。更新格式的单文件测试补齐独立 scratch 目录创建，不再依赖其他测试先运行。

上述 Node/Java 回归使用隔离服务替身。后续云构建、真实 Release 上传/读回和匿名下载已通过，见下文；Windows 内置升级、APK 安装或执行仍未在此版验证。官方兼容清单未更改：Windows x64 官方 26.901.6511.0、26.903.8094.0 的 Codex 核心；通知仅 .903 本机 Codex owner。Chat 列表/文字历史与实验性续写保持，新建/模型/生成图片未完成，Work 未独立验证；此次包内自检只读取官方项目与任务，不增加写入或 Chat 功能验证。

## 2026-09-10 正式云构建与发布

- 源码：`9c9080e73061ba48e27549b1c556cabc36136b36`，版本 0.10.29；原工作区 8 份未完成 Chat 修改未纳入构建。
- [Build EXE and APK 34443633443](https://github.com/Zmrn/RemoteCodex/actions/runs/34443633443)：成功，标准 Windows runner；双端构建与回归、Android 主机 JVM 检查、更新网络回归、原身份签名、兼容元数据/包内容校验及签名临时文件清理全部通过。
- 同次八项产物经草稿上传、逐项读回哈希核验后公开：[Remote Codex 0.10.29](https://github.com/Zmrn/RemoteCodex/releases/tag/v0.10.29)。没有本地重建、旧服务器操作或替换已发布资源。
- 本机下载后：两个更新清单 RSA 验签、APK v2/v3 签名和原证书一致、EXE 隔离目录包内运行时/DPAPI/官方只读访问通过（实际官方 26.903.8094.0，PID 108796）。没有安装/执行 APK，也没有升级当前客户端。
- 发布后：使用生产更新下载函数、不带登录凭据，从 latest 取得两个签名清单，再按 v0.10.29 固定版本下载完整 EXE/APK；大小、SHA-256、发布说明与本次云产物一致。最新 Release 含全部八项资源。

| 产物 | 字节数 | SHA-256 |
| --- | ---: | --- |
| RemoteCodex.exe | 44121088 | `3f2fc9c004469f9d321246fb1b2995149a05e62a1ee1eea78f45be7fa7952e3b` |
| RemoteCodex.apk | 257537 | `af1b5cde0d5f9f5c1257a16f7a9808087c914300b910b8be059215356f4f955e` |

原 APK 证书 SHA-256：`3c0a98ec3c9f37318525f5d0e4afb3417812215d625e48a9013b5ee649acb2b1`。中央清单 SHA-256：`1a24252d7c4dbbebf0367feb6325a329f11abc7268d3a6c467ab5ec7da1532b5`。构建包内 GITHUB-BUILD.json 的 `published:false` / `liveDesktopTested:false` 是云端产出当时的状态，发布后不改写已验签资源；后续验证和发布状态以本节为准。

## 0.10.30 正式发布（2026-09-10）

用户明确要求打包发布后，仅派发一次 [Build EXE and APK 34463415359](https://github.com/Zmrn/RemoteCodex/actions/runs/34463415359)，构建提交 `5f1d660a8946ad8fc7e17e2217694a2f864453c7`。同提交 [Checks34463387667](https://github.com/Zmrn/RemoteCodex/actions/runs/34463387667) 成功，包含新增的共享页面→HTTP→生产已读函数→隔离官方IPC测试。功能来自 6a01f4d、f88b318；未完成 Chat 修改未纳入，版本号仅升为0.10.30，没有扩大官方兼容范围。

标准发布器使用同次已下载并验签的八项产物，草稿上传并逐项从GitHub读回哈希核验后公开到 [v0.10.30](https://github.com/Zmrn/RemoteCodex/releases/tag/v0.10.30)。发布后通过不携带登录凭据的生产更新函数取得latest双清单，再按固定版本完整下载EXE/APK及说明；原RSA签名、长度、SHA-256、发布说明哈希与云产物一致。

| 产物 | 字节数 | SHA-256 |
| --- | ---: | --- |
| RemoteCodex.exe | 44124160 | `8669b9f1b44e409df7b60ff95bba98a22fe54ef5b75c3b678d145ebae499a57c` |
| RemoteCodex.apk | 257614 | `8c8d28fda2ec15fcb4095c1e13b1463d9b5b4cfabe1a158a6e66e79cfe6957a5` |

APK包名/版本10030、v2/v3签名和原安装证书通过；原证书指纹不变。中央清单SHA-256为 `84de01df63976cb53cec8df7874236d51520abbd6144f552a6a5a76bf4b32c5d`，双端元数据一致。EXE隔离home自检通过，使用内嵌Node22.19.0/Python3.13.2、DPAPI和实际官方26.903.8094.0/PID108796只读项目/任务列表。双端UI、EXE源码与发布提交核对一致，GitHub更新入口和无用户配置/签名文件检查通过。隔离的0.10.29云包源码→0.10.30云包源码，设备保存/升级/强制重启/显式删除检查通过；现有客户端设备与接入配置保持原样。

支持仍为Windows x64官方26.901.6511.0、26.903.8094.0的Codex核心；官方已读与通知限于后者本机Codex。Chat列表/文字历史，续写待专用真实验证，新建/模型/生成图片未完成；Work未独立验证。新交互仅隔离回归及问题任务只读核对，不是本次真实任务写入验收。本轮没有运行APK或模拟器、升级现有客户端、访问旧服务器或本地构建；安装验证由用户进行。GITHUB-BUILD.json中的published/liveDesktopTested仍保留云端产出时的false，不改写已发布产物。
