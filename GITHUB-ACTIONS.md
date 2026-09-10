# GitHub 副本与对话式云端构建

GitHub 仓库：[Zmrn/RemoteCodex](https://github.com/Zmrn/RemoteCodex)。2026-09-10 从 Gitee 最新 `ee308ef`（0.10.27）迁入完整 main 历史，同时保留新 GitHub 仓库的 MIT LICENSE。当前保留 Gitee，尚未删除或废弃其远端。

## 在 AI 对话中操作

用户说“打包当前版本”时，AI 可以直接执行以下脚本，无需用户打开网页点击：

```powershell
# 先确认本地提交已与 GitHub main 一致；不得覆盖其他设备的新提交
node scripts/github-actions.mjs build
# build 返回稳定 runId，此后不要重复派发相同请求
node scripts/github-actions.mjs watch <runId>
node scripts/github-actions.mjs download <runId>
```

`build` 仅派发 GitHub main 的 `.github/workflows/build.yml`，用唯一 request_id 找到本次运行。它拒绝未提交的受跟踪文件和与远端不同的提交；派发结果不明确时先 status 查询，不能盲目重复。`status` 可列最近运行，`status <runId>` 查询一次，`watch` 等待状态并在失败时返回非零退出码。

脚本优先使用安全环境中的 GH_TOKEN/GITHUB_TOKEN，否则使用已有 Git Credential Manager 登录；凭据仅在内存中发送到 api.github.com，不写入文件、日志、命令参数或对话。另一台电脑没有 GitHub 登录时，需先由用户完成登录，不能从此电脑导出登录令牌。

`download` 只下载成功的 main 双端构建，校验任务来源、文件白名单、提交与运行编号、更新清单 RSA 签名和程序 SHA-256。保存在被忽略的 `work/github-downloads/<runId>/`，不覆盖现有文件；AI 随后提供 EXE/APK 文件链接。下载链接来自 GitHub API，转到资源存储域名时不携带 GitHub 凭据。

## 两条工作流

- **Checks**：main push、PR 和手动/API 触发。运行 Node 回归、接口清单、窗口与通知隔离检查，不接收任何正式签名材料。
- **Build EXE and APK**：只接受 main 的手动/API 触发，使用 `signing` 环境。固定标准 `windows-2022`，Node 22.19.0、Python 3.13、Temurin JDK 21、Android platform 35 / build-tools 35.0.1；沿用项目的双端构建入口，额外运行 Android 主机 JVM 检查。

所有第三方 Actions 固定到完整提交 SHA，令牌只读，checkout 不保留凭据。签名任务不能来自 PR 或其他分支，不使用 pull_request_target。签名 Secrets 只暴露给恢复步骤，随后按 runner 的 Windows 用户重新 DPAPI 封装；构建结束（包括失败）删除本轮生成的签名与配置文件。

产物按明确白名单上传：EXE、APK、两个构建报告、两个签名更新清单、支持说明、构建来源记录。artifact 保留 **3 天**，内部程序仍为固定 `RemoteCodex.exe` / `RemoteCodex.apk` 文件名；不上传整个工作区、work、data 或原签名文件，不缓存密钥。

这两条工作流不登录官方 ChatGPT、不执行真实会话、不运行 APK，也不自动上传现有更新服务器。云端构建成功只证明构建与隔离检查成功，不能取代当前官方版本的真实桥接验证。`GITHUB-BUILD.json` 明确记载这些未测项。

## 首次签名配置

正式云端产物必须沿用已有签名。不能在每个 runner 生成一个新的 APK 证书或更新密钥；Windows 用户绑定的 DPAPI 文件也不能直接复制到云端使用。

在 GitHub 的 `signing` Environment 中保存以下配置，分支策略限制为 main。配置可以由获授权的 AI 通过 API 完成：

| 类型 | 名称 | 值的来源 |
| --- | --- | --- |
| Secret | REMOTE_CODEX_ANDROID_KEYSTORE_BASE64 | 原 data/android-signing.p12 的 Base64 |
| Secret | REMOTE_CODEX_ANDROID_KEYSTORE_PASSWORD | 原 DPAPI 密码文件在原 Windows 用户下解密后的密码 |
| Secret | REMOTE_CODEX_UPDATE_PRIVATE_KEY_PEM | 原 DPAPI 发布密钥在原 Windows 用户下解密后的 PEM |
| Variable | REMOTE_CODEX_ANDROID_CERT_SHA256 | 原 APK 签名证书 SHA-256（公开指纹） |
| Variable | REMOTE_CODEX_UPDATE_BASE_URL | 现有 release.local.json 的公共 baseUrl |

这些值不得粘贴进对话，不得提交 Git。向 GitHub 保存原签名材料属于独立的敏感配置动作，应取得用户授权；Secret 通过 GitHub 提供的公钥在本机加密后提交。缺少任何一项时正式构建明确失败，不生成替代身份。环境可按团队需要增加审核人；启用审核后，等待审批不属于构建错误。

在仍可解密原签名的 Windows 用户下，使用 Python 的 `cryptography` 和 `PyNaCl` 依赖运行一次配置工具；普通构建和下载不需要这两个依赖。工具默认只读，`--apply` 仅在用户已授权存储签名材料后运行：

```powershell
python -X utf8 scripts/configure-github-signing.py
python -X utf8 scripts/configure-github-signing.py --apply
```

工具校验原更新公钥与 APK 证书，在内存中解密并使用 GitHub 公钥加密后上传；不生成明文签名文件，不上传 SSH 或登录凭据。遇到已有不同的环境分支策略时停止，不放宽策略。2026-09-10 用户已授权并完成本仓库的三项 Secrets、两项 Variables 配置，`signing` 环境仅允许 main 分支。

云端仍内嵌现有 baseUrl，因此不会改变已安装客户端的更新入口。本轮只接入构建与产物下载；需要把发布服务器也接入云端时，另行配置部署权限与网络访问，不能直接复制现有 SSH 凭据或修改 Tailscale。尚未正式发布的同版本重建产物，也不能直接覆盖已经发布的同版本资源。

## 免费范围

[GitHub 官方计费说明](https://docs.github.com/en/billing/concepts/product-billing/github-actions)（2026-09-10 查阅）：公开仓库使用标准 GitHub 托管运行器的构建分钟免费，Windows 包含在内；larger runners 始终收费。artifact/Packages 的共享存储以及 cache 有独立额度和计费规则，不能将“公开仓库免费”理解为所有规格与存储无限免费。本流程只使用标准运行器，不启用付费规格，artifact 保留 3 天。

## 现有克隆的远端

本工作区暂保留 `origin` 指向 Gitee，新增 `github` 指向 GitHub。迁移期间源码同时推送两处；未来用户确认正式废弃 Gitee 后再调整默认远端。新克隆建议直接使用 GitHub：

```powershell
git clone https://github.com/Zmrn/RemoteCodex.git
cd RemoteCodex
```

仓库不包含签名材料、release.local.json、已保存设备或用户会话。MIT LICENSE 与已有第三方许可证分别保留，EXE/APK 打包包含本项目许可证。
