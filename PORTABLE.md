# Windows 单 EXE 桌面版 0.9.0

双击 `RemoteCodex-0.9.0-windows-x64.exe` 打开应用。现在使用应用内嵌窗口：**关闭窗口退出整个桥接程序；最小化继续运行**。没有独立后台模式或托盘驻留。重复打开会定位现有窗口，不产生第二套服务。能确认身份的旧版残留桥接实例会在打开新版时自动停止，无需手工执行 `--stop`。

窗口、Node 桥接进程、Python 和 WebView2 子进程受同一个 Windows 进程作业管理；主程序正常退出或崩溃时，Windows 清理它的子进程。内部仍有多个运行组件，但都由同一个桌面应用负责启动和退出。官方 ChatGPT 进程不属于这个作业，不会被停止。

关闭应用后，其他设备无法通过本桥接器连接此电脑；需要远程使用时请保持应用打开或最小化。官方正在执行的任务继续运行。

## 运行条件与数据

需要 64 位 Windows 10/11、.NET Framework 4.7.2+ 和已安装的 Microsoft Edge WebView2 Runtime。本机已验证 Runtime 152.0.4191.66。若另一台电脑缺少 Runtime，会报告界面启动失败并清理本程序的运行组件，不自动安装系统软件。

EXE 内置 Node.js 22.19.0、Python 3.13.2、WebView2 SDK Loader 和托管组件。分发只需一个 EXE；运行后会解压到 `%LOCALAPPDATA%\RemoteCodex\versions\`。设备配置、密钥和 UI 数据保存在 `%LOCALAPPDATA%\RemoteCodex\data\`。操作本机任务仍需要已运行并登录的官方 ChatGPT；当前写入适配版本 `26.901.6511.0`。不启动独立 Codex 后端。

设备名称、端口和 DPAPI 密钥沿用旧版配置。0.9.0 内嵌窗口的草稿会在关闭、更新后恢复。0.8.x 的独立 Edge 窗口使用不同的浏览器存储，未发送草稿不保证迁入新窗口；旧浏览器资料保留，已发送消息仍在官方任务中。

## 本机接入与更新

左下角设备菜单 → 编辑设备，可查看/复制已分配的 Tailscale IP，修改访问端口，生成或自定义访问密钥。勾选允许连接并保存后开放 Tailscale 入口；默认仅回环访问。不会改变 Tailscale、代理、DNS 或防火墙。

同一界面可检查更新、安装更新或开关自动更新。应用运行时启动后检查一次，此后每小时检查；有未发送草稿或正在编辑设置时自动安装等待。关闭应用后不检查更新。

更新先校验发布签名、平台、版本、长度和 SHA-256，再保存草稿、退出旧窗口、替换 EXE、打开新版窗口。更新助手只在安装期间短暂运行，不作为常驻服务。安装失败会尝试回退本机备份。更新源只分发软件，不接收任务、图片或账号数据。

资源服务：`http://100.75.83.51:43130/latest.json`，要求能连接 tx 的 Tailscale 网络。远端 `/opt/remote-codex-updates` 只保留一个 `RemoteCodex.exe` 与一份签名清单。新版本应提高版本号后覆盖发布。

## 开发与诊断

```powershell
python scripts/build_portable.py
# 发布到用户授权的 tx 资源服务
python scripts/publish-update.py dist/RemoteCodex-0.9.0-windows-x64.exe --version 0.9.0
# 只读诊断
.\RemoteCodex-0.9.0-windows-x64.exe --self-test
# 可选：停止本桌面实例（一般直接关闭窗口即可）
.\RemoteCodex-0.9.0-windows-x64.exe --stop
```

`--home <目录>` 隔离缓存和设备数据；`--port <端口>` 固定本地 UI 回环端口。`--headless` 仅为兼容 0.8.x 更新助手保留，普通启动调用会转到可见桌面，不再留下无窗口后台。`--prepare-only` 只校验解压，用于更新预检。

发布私钥仍为开发电脑 `data/release-signing-key.json`，以当前 Windows 用户 DPAPI 加密。不要提交、上传、打包或重新生成；公钥随客户端分发。EXE 未做 Windows Authenticode 签名，更新清单使用独立 RSA-SHA256 签名。包内第三方许可证见 `THIRD_PARTY_NOTICES.md`。
