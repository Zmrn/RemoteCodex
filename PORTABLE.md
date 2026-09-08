# Windows 单 EXE 版本

复制 `RemoteCodex-0.8.1-windows-x64.exe` 一个文件到其他 Windows 电脑，双击即可启动。内置 Node.js 22.19.0、Python 3.13.2 和全部网页/桥接源码，不需要预装 Node.js、Python、npm 或额外安装包，也不在首次启动时联网下载依赖。

需要 64 位 Windows 10/11、系统 .NET Framework 4.7.2+ 和 Microsoft Edge。要操作目标电脑的本地任务，该电脑仍需安装、运行并登录受支持版本的官方 ChatGPT 桌面端；当前写入适配版本仍为 `26.901.6511.0`。EXE 不包含官方应用、登录状态或任何用户数据。

## 启动、停止与升级

默认双击打开 Windows UI。首次启动会将校验过的程序文件解压到 `%LOCALAPPDATA%\RemoteCodex\versions\`，以后复用缓存。设备配置、配对密钥、上传文件和浏览器资料独立保存在 `%LOCALAPPDATA%\RemoteCodex\data\`，不会写入 EXE 所在目录。

界面使用系统 Edge。桥接服务在后台运行；关闭窗口不会停止官方任务，也不会停止桥接服务。再次双击会连接本版本已经运行的桥接服务。

```powershell
# 停止本单文件版桥接服务；官方 ChatGPT 和任务继续运行
.\RemoteCodex-0.8.1-windows-x64.exe --stop

# 仅启动后台服务
.\RemoteCodex-0.8.1-windows-x64.exe --headless

# 只读自检：内置运行时、DPAPI、Win32 管道、官方项目与任务读取
.\RemoteCodex-0.8.1-windows-x64.exe --self-test
```

自检结果位于应用数据目录的 `data\self-test.json`。未启动或未登录官方桌面时，自检会报告连接未完成，不会替代启动独立 Codex 后端。

升级时先用旧版或新版 EXE 的 `--stop` 停止桥接器，再双击新 EXE。运行数据保留，旧版本缓存也保留。已有源码版的数据不自动复制；迁移设备时需要重新配置连接，不能复制 Windows DPAPI 密钥文件。

## 端口与其他设备

单文件版默认自动分配空闲的本机回环端口，以便和源码预览共存。UI 自动打开正确地址，可从 `data\server.json` 查看地址。默认不开放远程入口、不修改任何网络配置。

目标电脑已有 Tailscale 连接时，可显式指定目标电脑的 Tailscale IP 和 agent 端口：

```powershell
.\RemoteCodex-0.8.1-windows-x64.exe --agent-address <TAILSCALE_IP> --agent-port 43128
```

这是可选的远程监听操作，需要在目标电脑自行启用；本次打包验证仅使用回环地址。其他设备添加这个地址、端口及桥接连接密钥即可连接，但第二台实体电脑仍待实测。

高级选项：`--port 43127` 固定回环端口，`--home <绝对目录>` 指定独立的缓存和数据目录（测试或隔离配置用）。`--stop` 也必须使用相同的 `--home`；不要将多台电脑的运行目录同步为同一份。

## 从源码构建

构建电脑需要 Python 3.10+ 和系统 .NET Framework C# 编译器，运行生成的 EXE 不需要这些构建工具。

```powershell
powershell -NoProfile -File scripts/Build-Portable.ps1
```

构建脚本从 Node.js、Python 官方 HTTPS 地址下载固定版本运行时并检查源码内固定的 SHA-256。下载缓存和构建中间文件在 `work/`，最终 EXE 和构建清单在 `dist/`，均不提交 Git。仅按白名单打包程序源码、网页和运行时；不包含 `data/`、会话、凭据、图片附件或开发者机器信息。

EXE 使用内置资源及文件清单校验解压内容，随后从自身缓存中的绝对路径启动 Node.js/Python。Node.js 的 LICENSE、Python 的 LICENSE.txt 和相关原型许可证均包含在 EXE 的资源里，解压后可在版本目录查阅。

这是单文件分发的自解压程序；运行后会产生缓存和本机数据。它不是单进程程序，也不把官方 ChatGPT 打包进去。目前没有购买代码签名证书，生成文件未签名。


## 本机接入设置与在线更新

左下角设备菜单 → 编辑“这台电脑”：自动读取已分配的 Tailscale IP，可设置端口、生成或自定义访问密钥、复制地址和密钥。勾选“允许其他设备通过 Tailscale 连接”并保存才会开放入口；默认保持关闭。密钥需 16–128 个 ASCII 字符，可使用字母、数字和 . _ ~ -，由 Windows DPAPI 加密保存。更换密钥会断开旧查看连接，官方任务继续；其他控制端需要更新保存的密钥。端口被占用或 IP 不属于本机时拒绝更改，保留原来的有效配置。

编辑设备的更新区域提供检查、安装和自动更新开关。单 EXE 版默认每小时检查，在启动后也检查一次；有未发送草稿、正在发送消息或打开设置窗口时，自动安装会等待。手动点击安装会保存当前窗口的文字、图片和会话选择，更新后恢复。更新使用相同回环端口重新启动桥接器；其他电脑已保存的 agent 端口和密钥不变。

更新源为用户服务器 tx 的 Tailscale 地址 `http://100.75.83.51:43130/latest.json`；资源服务只提供最新版 EXE 与版本清单，不参与会话控制。每个清单用独立发布私钥签名，客户端内置公钥，下载后核对签名、平台、版本、大小和 SHA-256。签名不正确、包被截断或篡改时不执行；安装失败会尝试用本机备份回退，并阻止对该失败版本的自动反复安装。未连接 Tailscale 时检查会显示失败，当前版本照常使用。

EXE 所在目录必须可写；不会申请管理员权限覆盖受保护目录。请把 EXE 放在自己可写的文件夹。在线更新只替换桥接 EXE，不更新官方 ChatGPT；官方版本兼容限制仍然适用。0.7.0 及之前没有更新模块，必须手动换成 0.8.1 一次。以后发布只需提高版本号并覆盖服务器最新资源，无需再逐台复制。

### 开发者发布新版

先修改 `package.json` 的版本号，构建并测试，再运行：

```powershell
python scripts/build_portable.py
python scripts/publish-update.py dist/RemoteCodex-0.8.1-windows-x64.exe --version 0.8.1
```

服务器目录为 `/opt/remote-codex-updates`，由 `remote-codex-updates.service` 提供资源，只保留一个 `RemoteCodex.exe` 和一份 `latest.json`，上传阶段的 `.next` 文件校验后原子替换，远端不保留版本历史。发布脚本不会更改 Tailscale、代理、DNS 或防火墙。

发布私钥在开发电脑 `data/release-signing-key.json` 中，以当前 Windows 用户的 DPAPI 加密保存；公钥在 `src/update-public-key.pem`。私钥绝不能上传到服务器、提交 Git 或包含在 EXE 中，也不能随意重建，否则已安装客户端不会信任新签名。发布失败时应修复访问或密钥问题，而不是关闭校验。源码分发不包含发布私钥。
