# 0.9.3 运行中设置验证

环境：Windows 本机；官方 ChatGPT 包 `OpenAI.Codex_26.901.6511.0`。只对桥接器登记的专用 Probe 自动写入，开发任务与用户其他任务没有测试写入或中断。

## 原因与修改

前端在 `active` 状态禁用了权限、模型和推理强度按钮，并在刷新时关闭菜单；服务端也错误要求会话必须为 `idle`。此外，前端将运行中误判为未加载，即便按钮放开也可能只保存本地预选。

现在已加载的 `idle` / `active` 任务均使用官方同一个所有者的 `thread-follower-update-thread-settings`。该版本官方实现调用 `updateThreadSettingsForNextTurn`，再由所有者更新它管理的实例。桥接器不启动另一个后端，不发送中断、调整方向或额外消息来修改设置。未知状态、断连、不支持版本及提交中的限制仍保留。

## 实测

| 项目 | 结果 | 证据 |
| --- | --- | --- |
| 运行中权限下拉菜单 | 已通过 | 本地 UI 点击工作区权限，官方 owner 回应并通过实时流更新权限配置；审批保留 `on-request`。 |
| 运行中模型与推理强度 | 已通过 | 本地 UI 从 Astra 切到 GPT-5.4-mini、从 low 切到 medium；所有者实时设置一致。 |
| 运行中闪电开关 | 已通过 | 官方实时流确认 `priority` → `default`；当前轮继续，不在加速档位发送额外测试消息。 |
| 当前轮不受打断 | 已通过 | 设置期间只有设置 IPC；owner、turnId、inProgress 状态与当前轮参数保持一致，随后自然 completed 并回复 `RUNNING_SETTINGS_OK`。 |
| 下一轮实际采用设置 | 已通过 | 同一个任务发送第二条无工具消息；官方新 turn 的 params 确认 `gpt-5.4-mini` / `medium` / `:workspace` / `default`，回复 `NEXT_SETTINGS_OK`。 |
| 恢复测试设置 | 已通过 | Probe 的下一轮设置恢复 Astra / low / 只读 / Standard。 |
| 未知与断连限制、去重 | 已通过 | 单元测试与隔离 UI 测试确认禁用、不发送设置；相同请求只向 owner 发送一次。 |
| 等待审批或同步问答时修改 | 未测试 | `active` 状态支持该路径，本次真实测试覆盖普通运行中；不把它当作已验证的审批场景。 |
| 其他电脑、其他官方版本 | 未测试 | 本次在当前 Windows 验证；不改变其他版本的写入适配限制。 |

35 项自动测试通过。隔离 UI 同时回归问题卡片、图片、首轮权限以及运行中设置，浏览器无脚本错误。真实调用链为内嵌页面使用的同一网页代码 → 回环 HTTP → 桥接器 → 官方命名管道 → 已运行桌面任务所有者。没有 Windows 焦点或界面自动化依赖。

详细本机证据：`evidence/running-settings-live.json`（任务 ID、两个 turnId、owner、参数、revision 与调用记录），`evidence/running-settings-live-ui.png`、`evidence/features-ui.json` 和 `evidence/running-settings-ui.png`。这些本机证据不提交远端仓库。

测试脚本调查中曾有失败：首轮点击早于界面启动完成；官方权限流使用 `activePermissionProfile.id`，初版断言只检查 `permissions`；测试请求白名单误拦本机更新活动心跳。均修正后复测，未因此改变产品审批或安全策略。含已通过业务断言的心跳白名单失败记录保留在 `evidence/running-settings-heartbeat-fixture-failure.json`。

## 复测

```powershell
npm test
# 将 REMOTE_BRIDGE_PLAYWRIGHT 设置为本机 playwright-core 模块路径
node scripts/verify-features-ui.mjs
# 读取 work/feature-probe-home.txt 指向的专用 Probe 数据目录；真实创建任务并消费少量额度
node scripts/verify-running-settings-live.mjs --create-probe
python scripts/build_portable.py --cache ..\..\work\portable-runtime-cache
.\dist\RemoteCodex.exe --self-test
```

成品固定文件名 `RemoteCodex.exe`，界面左下角显示 0.9.3。关闭窗口退出桥接程序，官方任务继续执行。新建首轮速度参数仍无官方入口，本次没有扩大支持范围。

发布后验证：桌面实际运行版本为 0.9.3；桌面 EXE、构建包和经过签名校验的远端清单 SHA-256 一致。通过已更新程序的回环页面只读查看仍在运行的开发任务，权限、模型和推理菜单均可展开；未发送任何该任务的设置或消息。结果见 `evidence/running-settings-packaged.json`。资源服务器仍只保留一个 EXE。
