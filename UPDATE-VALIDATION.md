# 0.8.1 本机接入设置与在线更新验证

验证日期：2026-09-08，Windows x64 本机。最终单文件为 `dist/RemoteCodex-0.8.1-windows-x64.exe`（43,699,200 字节，约 41.7 MiB）。

入口：左下角设备菜单 → 编辑当前设备。本机编辑界面显示 Tailscale IP、访问端口、访问密钥以及远程访问开关；本机和已保存远端的编辑界面都提供检查更新、安装更新和自动更新开关。源码版可检查版本，自动安装要求使用单 EXE 版。

| 功能 | 结果 | 实际证据和边界 |
|---|---|---|
| 本机 IP 与端口 | 已通过 | Edge 实际读取 Windows 网卡地址；本次为 `100.71.195.101`；修改测试端口并复制 IP:端口 |
| 访问密钥 | 已通过 | 界面生成、输入自定义值、复制、保存、重新读取；DPAPI 文件不含明文；旧版密钥兼容测试通过 |
| 远程监听配置 | 部分通过 | 回环集成测试验证启停、密钥轮换、旧密钥 401、端口冲突保留旧入口、配置重启恢复；本次没有启用真实 Tailscale 控制监听 |
| 响应式设置界面 | 已通过 | Edge 1440×1060 和 390×844；手机模式对话框宽约 359、高 804，可滚动保存；无页面 JavaScript 错误 |
| 检查更新及 tx 资源 | 已通过 | 从 tx 的 Tailscale HTTP 地址取得真实签名清单，验证签名及最终 EXE 摘要；远端仅一份 EXE |
| 手动在线安装 | 已通过 | 专用 0.8.0 测试 EXE，通过界面请求从 tx 下载 0.8.1，原路径替换、同回环端口启动，新旧实例 ID 不同 |
| 更新后的草稿和配置 | 已通过 | 未发送文字恢复；图片名称和原始字节哈希相同；设备名、接入端口、DPAPI 密钥保留；没有发送任何模型消息 |
| 自动在线安装 | 已通过 | 独立 0.8.0 实例开启自动更新后从 tx 下载；有草稿时等待，关闭开关后取消安装；空闲后重新开启，不调用安装 API 即自动替换为 0.8.1 |
| 安装失败恢复 | 已通过 | 将隔离 EXE 设为只读，真实替换返回 EPERM；安装助手恢复同端口的 0.8.0 桥接服务，原 EXE 哈希保留，结果为 rolled-back |
| 更新验证与路由边界 | 已通过 | 单元测试拒绝篡改清单、篡改 EXE、降级及越界远程管理路由；签名私钥不在 EXE、Git 或 tx 上 |
| 最终单 EXE 与回归 | 已通过 | 30 项测试通过；最终包仅用 System32 PATH 即可解压、自检、连接官方任务，重复启动、移动目录、设备配置保留和停止对象校验通过 |
| 原官方任务 | 已通过 | 手动升级前后官方 PID 一致；原 43127 桥接服务保留；测试脚本阻断任务发送、队列、设置、中断和导航写入 |
| 第二台实体 Windows、跨设备点更新 | 未测试 | 已实现按选定设备转发更新 API；没有在第二台实体机运行验证 |
| 更新期间断电、真实网络掉线和新版本启动崩溃 | 未测试 | 有签名、大小和 SHA-256 校验及恢复机制；不将代码检查等同于破坏性实测 |

## 实现与实测发现

更新资源服务位于 `root@tx:/opt/remote-codex-updates`，由 `remote-codex-updates.service` 运行，仅绑定 `100.75.83.51:43130`，只提供 `/latest.json` 与 `/RemoteCodex.exe`。上传完成后替换固定文件，不保留远端版本历史。该服务器只分发软件，不接收会话、图片或账号凭据。

清单使用 RSA-SHA256 签名，客户端包含 RSA 3072 公钥，发布私钥仅在开发电脑以 DPAPI 密文保存。此签名用于更新包验证，不是 Windows Authenticode 签名。

自动更新默认启用，启动后检查一次，此后每小时检查；有草稿、正在提交操作或正在编辑设置时等待安装。可随时关闭自动更新。手动安装会先保存当前窗口草稿；其他窗口在更新事件或检测到服务实例变化时保存并恢复。远程控制入口默认关闭，必须勾选允许连接并保存。

实测发现 Windows 启动器会让后台服务继承输出句柄，因此安装助手改用忽略标准输入输出的进程启动方式，并等待启动器退出，避免成功启动后仍卡在输出管道。当前 Tailscale 下载速度曾约 180 KB/s，初版三分钟超时不足；最终改为二十分钟上限，并复用已经完整校验过的缓存包。下载中断只报告失败，不执行不完整文件。

## 本地证据与复测

- `evidence/update-verification.json`：真实 UI 手动、自动更新结果；只包含测试配置及必要进程证据，不记录私人任务消息。
- `evidence/update-rollback.json`：只读目标 EXE 的安装失败恢复。
- `evidence/device-settings-desktop.png`、`evidence/device-settings-mobile.png`：设置区域预览，密钥已遮挡。
- `evidence/portable-verification.json`：最终 EXE 内置依赖、中文路径、只读官方连接、缓存校验及停止对象校验。

这些本机证据和所有运行数据从 Git 与 EXE 打包中排除。`PORTABLE-VALIDATION.md` 保留原 0.7.0 报告，不能把旧报告误认为新版实测。

```powershell
npm test
python scripts/build_portable.py --version 0.8.0
python scripts/build_portable.py
# 0.8.0 是本次升级测试专用包，不作为用户交付。
python scripts/verify_portable.py dist/RemoteCodex-0.8.1-windows-x64.exe
# 设置 REMOTE_BRIDGE_PLAYWRIGHT 为已安装 playwright-core 的模块地址后运行：
node scripts/verify-updates.mjs dist/RemoteCodex-0.8.0-windows-x64.exe dist/RemoteCodex-0.8.1-windows-x64.exe
python scripts/verify-update-rollback.py dist/RemoteCodex-0.8.0-windows-x64.exe dist/RemoteCodex-0.8.1-windows-x64.exe
```

升级测试需要连接 Tailscale，且 tx 上必须是签名有效的 0.8.1 资源。脚本只创建隔离数据目录，结束时停止自己的桥接服务。最终 EXE SHA-256：`a10c72b9acc93592ae172358251586b5c5e355756d4ec513e7cdac82f44fee9f`。

0.7.0 及更早版本没有更新模块，需先手动换成 0.8.1 一次：停止旧桥接器，替换 EXE，重新打开。之后可在线更新；每次发布应提升版本号，再用 `scripts/publish-update.py` 覆盖服务器最新资源。官方 ChatGPT 的安装、版本和任务不在本更新器的操作范围内。
