# 自动重连验证 · 0.9.9

验证日期：2026-09-09（本机 Windows，Asia/Shanghai）。

## 修改与原因

旧版在断线时停掉状态轮询，只在 SSE 报错后重开事件通道。首次连接失败、IPC 已断但 SSE 仍有心跳、TCP 长时间不返回数据，均没有完整的恢复流程。

现在界面和桥接 IPC 分别有单次执行的重试控制，失败后按 1/2/4/8/15/30 秒持续重试。SSE 每 15 秒接收心跳，45 秒无任何数据时关闭本查看连接并重试（检测定时器每 5 秒检查）。恢复网络、窗口获得焦点和恢复可见时检查连接。

恢复仅调用状态读取、`connect`、`follow`、列表和消息读取；已有任务的发送、队列、设置、审批和中断均不重放。重新建立分页游标，合并已显示的历史，保留草稿和附件。无法确认状态时显示未知。切换设备或关闭界面停止旧重试；桥接停止后，较晚返回的 IPC 连接结果不能重新激活它。

## 结果

| 功能 | 结果 | 实际证据 |
| --- | --- | --- |
| 初次失败自动连接；IPC 断开而 SSE 仍存活 | 已通过 | Edge + 真实 HTTP/SSE 隔离故障测试，实际观察 `/connect` 和重新订阅调用 |
| 网络断线与远端重启状态恢复 | 已通过 | 隔离故障测试恢复同一任务的新消息；双方安装 0.9.9 后，真实笔记本在测试浏览器离线恢复网络后 1071 ms 重新连接，官方 PID 10728 保持不变 |
| 静默 TCP | 已通过 | 按生产配置保持 TCP 打开、停发全部数据，45 秒检测阈值后自动重建事件连接 |
| 本机官方 IPC 自动恢复 | 已通过 | 只关闭探测程序自己的 `ipc`、`tools` 两条管道；分别 1695 ms / 1676 ms 自动恢复，同一官方 PID 131084、同一会话 ID、重新收到 owner 快照并读回 40 项 |
| 断线不丢草稿、图片、已显示历史 | 已通过 | UI 测试逐项断言；真实笔记本测试核对未发送草稿和原显示内容 |
| 服务重启后继续向上加载 | 已通过 | 清空隔离服务的分页缓存后自动重连，255 项消息全部可读且没有重复 |
| 切换设备、关闭 UI、主动停止 | 已通过 | 旧设备不再重试，关闭页面后停止请求；后台主动停止后不再连接，晚到连接和旧 owner 结果被拒绝 |
| 恢复网络与手动重新连接 | 已通过 | UI 在线事件和重新连接按钮恢复同一任务及草稿 |
| 真实 Windows 整机睡眠后唤醒 | 未测试 | 未让用户工作电脑进入睡眠；相关可见性、焦点和在线恢复路径已覆盖，休眠系统行为未实测 |
| 重复发送防护 | 已通过 | 本轮真实任务写入次数 0；现有断线写入结果未知且不自动重试的回归保持通过 |
| 自动测试与单 EXE | 已通过 | `npm test` 51/51；UI 故障、设备切换、分页与既有功能测试通过；单 EXE 自检确认内置运行时、DPAPI、静态资源及真实官方项目/会话读取 |

本机活动任务 `01a07f29-f68c-72b0-80b6-23229f894844` 仅用于只读订阅，未发送测试消息或中断。远端只读任务为 `01a07be8-b133-7c32-90e0-fbc6cd5a3858`。未修改官方安装文件、任务数据库或网络配置，未重启官方 ChatGPT。

首次本机探测选中的 idle 历史任务没有已加载 owner，返回真实 `no-client-found`；因此实时恢复测试改用已运行任务的只读订阅。该错误不代表历史读取失效。

## 复测

```powershell
npm test
$env:REMOTE_BRIDGE_PLAYWRIGHT = ([System.Uri](Resolve-Path '../../work/formatter/node_modules/playwright-core/index.mjs').Path).AbsoluteUri
node scripts/verify-reconnect-ui.mjs
node scripts/verify-pagination-ui.mjs
node scripts/verify-device-switch-ui.mjs
node scripts/verify-features-ui.mjs
node scripts/verify-reconnect-live.mjs
# 在已保存设备上只读核验；替换为自己的设备 ID 和任务 ID
node scripts/verify-reconnect-remote-live.mjs SAVED_AGENT_ID TASK_ID
```

UI 测试需要 `playwright-core` 和本机 Edge；上面的变量指向本工作区已有测试依赖，也可改为自己的依赖路径。远端脚本默认测试安装版；设 `REMOTE_BRIDGE_UI_SOURCE_TEST=1` 可仅在隔离测试浏览器中载入当前源码。

必要证据保存在本机 `evidence/reconnect-ui.json`、`reconnect-live.json`、`reconnect-remote-live.json`、`pagination-ui.json`。报告不记录私人正文、密钥和附件；这些本机证据不提交到仓库。

## 构建与发布

固定文件名 `dist/RemoteCodex.exe`，0.9.9，43,981,824 字节，SHA-256：`91dfa4b0de95bb9427f145df14cd6f4454e39537b3bec95bc1c899d72bc8eadb`。已发布到既有 tx 签名更新源，资源目录仅一份 EXE。官方程序版本和进程不由更新流程修改。

本机和“我的笔记本”均已通过自身更新器安装 0.9.9；本机桌面 EXE 的 SHA-256 与发布包相同。更新后官方 PID 分别仍为 131084 / 10728，连接状态均已确认。安装版完成远端断网重连复测，草稿和会话保持一致，任务写入次数 0。证据：`evidence/reconnect-installed.json`、`evidence/reconnect-remote-live.json`。
