# VS Code 与官方 ChatGPT 共存（0.10.15）

## 原因与实现

同一用户的 `codex-ipc` 是共享路由管道，最先建立它的进程可能是 VS Code 扩展宿主。旧版先要求这个管道属于 WindowsApps 的 ChatGPT.exe，再找相同 PID 的 app-tools，因此 VS Code 先运行时会报 `Official desktop IPC owner unavailable`，与官方版本是否相同无关。

0.10.15 将两种身份分开：

- `codex-browser-use-*` 工具管道仍必须由已运行的官方 WindowsApps ChatGPT.exe 持有，并通过真实 `tools/list` 校验。
- `codex-ipc` 允许官方进程，或 Authenticode 有效、证书发布者及产品/公司都匹配清单的 Microsoft VS Code。只叫 Code.exe、签名未知/无效或产品不符均拒绝。
- 握手后重新检查两个管道的 PID/映像；发生替换就关闭连接并让重连流程重新发现。失败不残留已连接客户端或旧工具目录。
- 新建、项目/历史读取仍直达官方 app-tools。原生消息、设置、队列、停止按真实 conversationId 发现 owner，再用 targetClientId 定向发送；回执和实时事件必须来自相同 owner。

规则集中在 `src/official-desktop.json` 的 `discovery`；实现见 `src/win_probe.py`、`src/desktop.mjs`。`GET /api/status` 的 `desktopConnection` 分别提供 officialPid、brokerPid、brokerKind、sharedBroker、brokerVersion，不暴露安装路径或凭据；断线时该字段为 null。

当前协议没有公开的“owner UUID 对应哪个 Windows PID”查询。`supportsUntrustedAppInput` 也被 VS Code 实现，不能用它证明官方进程身份。本次证明来自直连官方 app-tools 新建任务、相同任务与 owner 的定向控制/实时流，以及官方界面显示的组合证据；没有启动独立 app-server，也没有用共享历史代替实时状态。

## 原开发设备真实验证：已通过

2026-09-09，原开发设备 Windows 11 x64，保持原 ChatGPT 和 VS Code 进程运行：

| 项目 | 实际记录 |
| --- | --- |
| 官方包 | 26.903.8094.0，ChatGPT.exe PID 44340 |
| IPC 转发宿主 | Microsoft VS Code 1.136.2，Code.exe PID 27048 |
| Codex VS Code 扩展 | 26.903.61454 |
| 文字专用任务 | 01a08582-59c6-7001-b137-bb29bd7cf482 |
| 图片/控制专用任务 | 01a08582-88e1-71d1-9875-7bca96732791 |
| ownerClientId | 36169a42-6f14-41a6-9151-1dfd8a3a726d |
| 测试时间（UTC） | 09:31:41 至 09:32:22 |

固定场景的 12 项检查通过：官方版本、实时工具 schema/安装包协议、目录内测试模型、文字新建读回、多图新建、两张图片内容识别、模型/推理/只读权限、官方队列添加、删除队列、查看连接重连后保持原 activeTurnId、停止、原任务继续收发。

6 次被记录的设置/消息/队列/停止请求，targetClientId 与 handledByClientId 全部相同。73 条该任务实时状态事件均来自上述 owner；09:32:18.667Z 的 revision 49 明确为 interrupted，续写后 revision 66 为 completed。重连前后官方 PID 和转发 PID 均未变化。

只读查看与写入的调用链：

```text
Remote Codex -> 官方 app-tools (ChatGPT PID 44340) -> 创建真实任务 / 读历史
Remote Codex -> 共享 IPC (VS Code PID 27048) -> 该任务 ownerClientId
             <- 同 owner 的处理回执及 snapshot/patches
```

专用数据与脱敏诊断保存在被忽略的 `work/create-compatibility-1CTRrQ/`。它只包含本次专用任务；发布到 Git 的本文保留必要 ID、版本和事件摘要，不发布私人历史或凭据。

官方 Windows 界面核对：**部分通过**。实际点击打开文字专用任务 `RemoteBridge-Probe-20260909T093146-6dbc28`，截图可见一致的测试消息和 `TEXT_CREATE_OK` 回复。随后图片任务的界面检查被用户物理 Escape 停止，未继续注入输入，也未声称完成图片窗口核对或从官方输入框手动续写。图片识别、停止和续写证据来自上述真实接口测试。

## 复测入口

```powershell
# 只读：进程、共享管道身份、真实工具 schema；不会新建或发送
node scripts/verify-compatibility-live.mjs
# 会创建两条清晰命名的专用任务；不要传私人任务 ID
node scripts/verify-create-compatibility.mjs --create-probe --version=26.903.8094.0
# 安全拒绝、身份变化、重连及原有 owner 控制回归
node --test test/desktop-discovery.test.mjs test/reconnect.test.mjs test/interrupt.test.mjs
```

## 支持边界

- 整体已支持 Windows x64 官方 26.901.6511.0、26.903.8094.0；本次 VS Code 持有共享管道的真实写入只验证后者与上述 VS Code/扩展组合。官方独占管道路径保留，单元回归覆盖两种路由。
- 官方内部接口不是稳定公共协议。VS Code Insiders、Cursor、其他编辑器及扩展版本没有由本次结果证明兼容；不放行未知进程作为转发宿主。
- 未重启/关闭官方 ChatGPT 或 VS Code，没有改网络、安装文件、凭据、数据库，也没有自动写入或停止开发任务及私人任务。
- 本轮测试查看连接断开/恢复；没有强制终止 VS Code 管道宿主来模拟崩溃。宿主退出后能否由官方立即重建管道取决于官方实现，桥接器仍按退避重试并在失联时显示未知，不重发写指令。
- Chat 列表/历史保持既有读取能力，文字续写未完成专用真实验证；Chat 新建/模型/图片未支持，Work 未独立验证。原生生图和审批提交没有在本轮复测。

## 源码交接与构建状态

用户在本轮最后要求停止构建/发布，改为提交源码并交给另一台设备构建。该要求到达前，本地已完成：

- 120 项 Node 回归、13 项 Windows 窗口检查，全部通过。
- 0.10.15 EXE/APK 本地构建；单 EXE 使用内置 Node 22.19.0 / Python 3.13.2 完成官方项目/任务只读自检，确认 officialPid 44340、brokerPid 27048。
- 同一原有签名身份签署本地更新清单；隔离 Android API 35 `emulator-5580` 的 `stage=compatibility` 返回明确 `result=PASS`（APK 版本、兼容清单、支持说明哈希及 WebView 模块）。本轮没有继续执行 `create-images` 横竖屏 UI 测试，也没有安装物理手机。测试模拟器已停止。

**没有上传或发布 0.10.15，没有替换本机或笔记本客户端。** 本机运行版仍是 0.10.14；修复通过源码实例及隔离 EXE 自检验证。`work/`、`dist/`、签名身份和发布配置都不提交 Git。

交接提交时还合并保留了远端 `98e1b76` 的设备持久化/升级保护修复；合并后的 130 项 Node 回归及兼容清单检查全部通过。上述本地构建产物生成于合并之前，不能作为最终合并版本发布；最终版本由另一台设备重新构建。

另一台设备拉取本提交后，先读 AGENTS.md，使用已经安全迁移的原签名文件与被忽略的 release.local.json，运行 `python -X utf8 scripts/build-release.py`；完成其本机行为/包校验后，按既有双端发布流程执行 `python -X utf8 scripts/publish-update.py`。不要另生成签名身份。安装后再核对实际 `/api/status` 的 connected、desktopCompatibility、desktopConnection 以及设备配置保留情况；不能把本报告的进程号当作新设备上的常量。

## 笔记本最终合并发布（2026-09-09，已完成）

以上“没有发布”描述的是原开发设备交接时的历史状态。接手笔记本已从包含 `d19d0f1`（VS Code 共存）和 `98e1b76`（设备保护）的 `99d6847` 重新构建并正式发布双端 0.10.15；未发布的 Chat 开发改动保留在独立主工作区，没有进入安装包。

| 最终资源 | 字节数 | SHA-256 |
| --- | ---: | --- |
| RemoteCodex.exe | 44,060,160 | `51e10bfb736b6fd0d20c5b16fd114f4a501bf9ee363b0d39e06f6d189a489bbe` |
| RemoteCodex.apk | 203,541 | `589955a86d4bf02014999b6c18f12209040dcc23dc0ec6d608c77ae238c720d7` |

最终兼容清单 SHA-256 为 `a79a15704fc35c1243d38187c0317761a76cc85c30ea8d3a54cf0435acab12bb`。两端使用原签名身份，线上清单验签、文件大小/哈希及支持说明哈希一致，资源服务只保留各平台一个正式包。较早的本地 0.10.15 构建均未正式发布，不能混用其哈希。

本轮通过 130 项 Node 回归、13 项窗口检查、兼容清单与真实只读预检、最终 EXE 自检、0.10.14→0.10.15 包内设备保存/强制重启/删除测试和包内敏感文件排除检查。笔记本已通过内置更新器安装同一正式 EXE，设备与接入/更新设置核对一致，`connected=true`、`writeSupported=true`，官方 PID 保持 108796，`desktopConnection` 为 `brokerKind=official-desktop`、`sharedBroker=false`。这证明本机官方独占路径正常；VS Code 共享转发的真实写入证据仍是本文原开发设备的专用任务记录。

构建使用 JDK 17、API 35/build-tools 35.0.1 和 Python 3.12.14（zlib 1.3.2）；包内运行时仍为 Node 22.19.0/Python 3.13.2。默认 Python 3.14 的 zlib-ng 产生不同压缩字节，最终选择与旧包压缩结果一致的构建环境。慢链路下只传输约 400 KB 差异，由服务器核对旧包哈希后重建完整 EXE，再经标准双端发布器验签/验哈希切换资源，没有改变最终已测试包。

同时修正发布服务漏掉 `/release-notes.md` 的路由，并补充带超时、固定长度和哈希检查的 SSH 暂存上传，只有完整文件才原子替换 `.next`；5 项隔离传输/资源服务测试通过，服务脚本实际上传和正式发布说明 HTTP 校验通过。复测：`python scripts/verify-publish-transport.py`。现有配置中的服务已更新，地址、端口和网络配置未变。

本机未对最终合并 APK 做模拟器或真机行为验收。支持范围仍为 Windows x64 官方 26.901.6511.0、26.903.8094.0 的 Codex 核心读写；VS Code 共享管道只验证 26.903.8094.0 + VS Code 1.136.2 + 扩展 26.903.61454。Chat 列表/历史可读，文字续写待真实验证、新建/模型/图片未支持，Work 未独立验证。
