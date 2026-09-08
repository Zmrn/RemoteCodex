# 桌面交互修复 · 0.9.10

验证日期：2026-09-09，Windows 本机。当前源码连接已经运行的官方 ChatGPT，未启动独立 Codex 后端，未修改官方安装、会话数据库或网络设置。

## 本轮行为

- 已加载会话的输入框处理 Ctrl+V 图片粘贴，保留原文字，显示可移除的图片预览。PNG/JPEG/WebP，单张最多 5 MB；普通文字粘贴不受拦截。沿用现有边界：新建首条和未加载会话需要先发送文字，再发送图片。
- 左下角问号直接进入“帮助与更新”，顶部提供本程序的检查更新、安装更新及自动更新开关。存在新版时显示下载图标，下载时显示真实百分比和小进度条。远端设备的更新仍在各自设备编辑页中管理。
- 用户发送的本地文件附件、助手消息中的本地文件链接可下载。消息旁和“结果文件”都有入口；普通历史任务不再因未登记为 Probe 而被一律禁止。仅登记从官方消息读到的文件路径，HTTP 使用会话范围内的 ID，不能提交任意路径读取；原文件保留，最大 256 MB。源文件已删除或移动时明确失败，更早附件随翻阅加载。
- 队列右侧显示铅笔图标，展开后选择“编辑消息”仍从官方队列取回草稿。
- Windows 关闭按钮隐藏到托盘，远程接入与自动重连继续运行；点击托盘图标或重新运行 EXE 恢复窗口。右键托盘选择“退出 Remote Codex”才结束整个程序。`--stop` 和更新同样走真正退出流程。明确退出后如 WebView2 销毁停滞，6 秒兜底退出主程序，Windows 进程作业负责清理本程序子进程；隐藏窗口不启动此兜底。

## 验证结果

| 项目 | 状态 | 证据和限制 |
| --- | --- | --- |
| 粘贴图片、文字保留、发送字节 | 已通过 | Edge 中派发剪贴板图片事件，校验预览、文字、发送请求内原始 PNG 字节完全一致；纯文本粘贴未被 preventDefault |
| Windows 实际 Ctrl+V | 未测试 | Windows 自动化无法激活窗口，两次返回 `failed to activate captured window`，截图全黑、没有可访问性信息；没有假装完成系统剪贴板测试 |
| 更新入口和下载进度 | 已通过 | 点击问号直接看到更新按钮，不打开设备编辑；模拟下载 23% 时按钮、百分比和进度条一致，调用始终指向本机 `/api/updates` |
| 队列编辑图标和取回草稿 | 已通过 | SVG 尺寸至少 15×15，使用铅笔路径；选择编辑后草稿回到输入框 |
| 消息内文件及历史任务文件下载 | 已通过 | UI 下载文件字节比对；真实官方开发任务中已发出的 `RECONNECT-VALIDATION.md` 下载 5138 字节，与本机原文件完全相同，任务写入次数 0 |
| 文件读取边界 | 已通过 | 无 CSRF、跨会话 ID、任意路径、目录和 UNC 路径被拒绝；源文件删除后明确失败 |
| 窄屏界面 | 已通过 | 390×844 视口未出现横向溢出 |
| 关闭到托盘、点击恢复、托盘右键退出 | 部分通过 | NotifyIcon、关闭拦截、恢复消息和退出入口均已编译；Windows 鼠标交互因上述自动化问题未完成，待人工验收 |
| 单实例与显式退出清理 | 已通过 | 真实安装版重复执行 EXE 保持同一主进程；`--stop` 后 9 个所属进程全部退出，再次启动正常，官方 PID 131084 不变。该测试没有模拟托盘点击，也不代替隐藏后恢复测试 |
| 单 EXE 自检与回归 | 已通过 | Node 自动测试 54/54；新增桌面 UI、既有问答/模型、分页回归通过；单 EXE 自检确认内置运行时、DPAPI、资源及真实官方项目/会话读取 |

首次显式退出检查出现过 25 秒超时，之后补上退出兜底和初始化期间退出保护，再次执行完整的显式退出/重新启动测试通过。Windows 自动化的黑屏原因尚未确认；只读系统检查的输入桌面为 `Default`，因此没有把它直接认定为锁屏。

用户随后回复“电脑已锁屏或暂时不在电脑旁”，因此本轮保留实际 Ctrl+V 和托盘鼠标操作为待人工验收，不继续尝试界面输入。

## 发布与安装

- 本机和已保存的笔记本均已安装并回读确认版本 0.9.10；官方 ChatGPT 进程分别保持 PID 131084 和 10728，更新未重启官方应用。
- 桌面启动器仍为 `RemoteCodex.exe`，SHA-256 与下方最终构建一致。
- 签名更新源已发布 0.9.10；资源服务器保留一个 EXE 副本。笔记本通过已有更新入口完成安装，证据为 `evidence/ux-remote-update.json`。

## 构建与复测

启动：双击桌面或 `dist/RemoteCodex.exe`。停止：托盘右键“退出 Remote Codex”，或 `RemoteCodex.exe --stop`。

```powershell
npm test
$env:REMOTE_BRIDGE_PLAYWRIGHT = ([System.Uri](Resolve-Path '../../work/formatter/node_modules/playwright-core/index.mjs').Path).AbsoluteUri
node scripts/verify-desktop-ux-ui.mjs
node scripts/verify-features-ui.mjs
node scripts/verify-pagination-ui.mjs
node scripts/verify-attachment-live.mjs
python scripts/verify-tray-lifecycle.py
```

UI 检查使用工作区已有 playwright-core，可将环境变量改为自己的安装路径。`verify-attachment-live.mjs` 只读当前官方任务内本项目公开报告，需对应会话存在该报告链接。`verify-tray-lifecycle.py` 会短暂退出并重新打开本桥接程序，不操作官方任务。

本机证据：`evidence/desktop-ux-ui.json`、`attachment-live.json`、`tray-lifecycle.json`、`ux-local-install.json`；截图 `evidence/help-update-preview.png` 使用隔离测试数据。证据目录不提交到源码仓库。

最终 EXE：0.9.10，43,990,016 字节；SHA-256 `07adf48d28d22759244015f8f99cf2fe2ca036c8251f845444c750354d0c56c3`。
