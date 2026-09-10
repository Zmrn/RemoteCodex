# GitHub 直接更新（0.10.29 待构建）

2026-09-10 用户要求不再经原远端服务器分发更新。Windows 和 Android 更新入口改为 GitHub Releases，公开配置统一在 `src/update-source.json`。客户端不需要 GitHub 登录或访问密钥；设备互连仍沿用原连接方式。

本次完成源码与隔离测试，**未构建 APK/EXE、未创建或发布 GitHub Release、未更新客户端、未操作旧服务器**。0.10.29 是下一次明确构建指令使用的源码版本，不代表已上线。

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

下载页：[GitHub Releases](https://github.com/Zmrn/RemoteCodex/releases)。该页是否已有迁移版以实际发布状态为准，本次没有发布。

## 验证与范围

204 项 Node 回归和 22 项主机 JVM 更新网络检查通过。覆盖 GitHub/CDN 重定向、不转发凭据、HTTP/其他域名/循环拒绝、下载大小限制、固定版本、双端签名及来源校验、草稿公开顺序、未知上传/发布结果恢复、已发布资源不可覆写、版本回退和标签冲突。更新格式的单文件测试补齐独立 scratch 目录创建，不再依赖其他测试先运行。

Node/Java 使用隔离服务替身，不创建真实 GitHub Release。尚无本版本云构建、真实 Release 上传/读回、Windows 内置更新、APK 安装或执行验证。官方兼容清单未更改：Windows x64 官方 26.901.6511.0、26.903.8094.0 的 Codex 核心；通知仅 .903 本机 Codex owner。Chat 列表/文字历史与实验性续写保持，新建/模型/生成图片未完成，Work 未独立验证；本次不增加官方真实操作证据。
