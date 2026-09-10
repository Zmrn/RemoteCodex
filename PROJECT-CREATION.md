# Codex 新建时选择项目（0.10.8）

点击新对话，在输入框上方点击文件夹/项目名，搜索并选择当前设备的官方 Codex 项目，再发送第一条消息。选择“无项目”仍使用独立目录。项目旁的“本地”表示在项目当前目录和当前分支运行；本版不提供切换工作树或分支。

Windows 与 Android 共用项目下拉。各设备分别保存选择，并随草稿恢复；从已有项目任务点击新对话时沿用该项目。Chat 模式不会显示或发送 Codex 项目设置，之前暂停的 Chat 新建/模型窗口联动不包含在此次发布中。

## 调用链与数据来源

1. 当前设备 `/projects` → 已运行官方应用的 app-tools 命名管道 → `list_projects`。使用 `projectKind`（兼容早期 `kind`）与 `hostId` 过滤此设备本地项目。
2. 用户提交 `/threads`，携带 `project: { projectId, environment: "local" }`。后端发送前重新查询当前设备官方项目列表；只接受这份列表里的 ID。
3. 官方 `create_thread` 收到 `target: { type: "project", projectId, environment: { type: "local" } }`。没有启动另一个 Codex 后端，没有改写官方配置/数据库。
4. 创建前持久化请求标识；同一请求重试不会创建第二个任务。项目失效、设备断开、桌面连接更换时保留草稿并报错；不回退到无项目。
5. 真实 `threadId` 沿用官方读取、owner 发现与后续发送。0.10.26 起列表不再按桥接器创建记录补行，避免已归档/移除的任务复活；新任务可立即按官方返回 ID 打开，侧栏等待官方列表更新。旧创建记录仍用于请求保护，见 OFFICIAL-DATA.md。

## 复测

2026-09-10 修复：普通创建由官方自动命名，不再登记为Probe；拿到官方ID后不等待项目/列表刷新就打开内容。列表每5秒及事件刷新，索引等待有提示，右键可向官方提交重命名。数据与验证边界见 [THREAD-LIST.md](THREAD-LIST.md)。

```powershell
node --test test/projects.test.mjs test/send-lifecycle.test.mjs test/chat.test.mjs
node scripts/verify-project-ui.mjs
# 仅在已授权的测试环境使用。只创建专用无工具测试任务，不操作已有任务。
node scripts/verify-project-live.mjs --write --project-id=<官方已保存的本地项目ID>
```

浏览器测试需要 `REMOTE_BRIDGE_PLAYWRIGHT` 指向已安装的 Playwright 模块。真实探测在 `work/project-official-probe/` 保存请求标识和脱敏证据；复跑必须沿用该记录，不要删除后重发。

Android：构建并在隔离模拟器安装 APK 与 `work/RemoteCodex-tests.apk`，运行 `am instrument -w -e stage projects com.anso.remotecodex.tests/.Probe`。该测试只用独立界面数据，不向真实项目发送消息。

## 实测结果

2026-09-09，官方 Windows `OpenAI.Codex_26.901.6511.0`，PID 6096：

| 功能 | 结果 | 证据 |
| --- | --- | --- |
| 真实项目目录 | 已通过 | 官方返回 N3，ID `3925328d-f6d0-4795-b7bd-6a2177e38f34` |
| 在项目中新建 | 已通过 | app-tools 接收上述 ID 和 `environment.type=local`；新任务 `01a08466-16e6-72b2-bd32-20ea4ff35d50`，官方 `read_thread.cwd` 与 N3 的 `E:\Project\ninja3` 一致 |
| 同任务连续发送/读取 | 已通过 | 同一 ID 中两轮完成，分别读到 `PROJECT_FIRST_OK`、`PROJECT_SECOND_OK`；真实 owner `0f86277b-a44f-47bf-9adf-3e9a55cc9c64` |
| 官方打开与项目归属 | 已通过 | `navigate_to_codex_page` 对同一 ID 返回 `navigated:true`；官方列表最终返回相同项目 ID。列表最初延迟，创建记录补入逻辑覆盖此情况 |
| 项目下拉及异常处理 | 已通过 | 浏览器生产页面验证搜索、菜单内部点击、设备隔离、刷新恢复、旧设备/失效项目阻止发送、失败保留草稿、项目 ID 请求和窄屏边界 |
| Android 项目选择 | 已通过 | API 35 隔离模拟器 `emulator-5580` 的真实 WebView，10 项检查通过；使用独立测试数据，不是真机实测 |
| 回归 | 已通过 | Node 95/95；原 Chat 界面回归通过 |
| 单 EXE 自检 | 已通过 | PATH 仅含 Windows System32；内置 Node/Python、DPAPI、资源、官方管道和项目/会话读取通过 |
| 发布后真实实例 | 已通过 | 本机和笔记本均自动更新到 0.10.8，保持官方连接，均上报 `projectCreation.local=true`；分别读到 1/2 个项目。本机两个已保存设备仍完整；打包后的项目控件及模块返回正常 |
| 旧单文件启动脚本后续检查 | 部分通过 | 自检后，启动被现有全局单实例锁转到已运行窗口，旧脚本预期的隔离 `server.json` 未出现，未宣称整套旧脚本通过 |
| 工作树/分支选择、Chat 项目新建 | 未测试 | 未实现，界面明确显示本地执行，不冒充可切换 |

未修改 N3 源码、官方安装或数据库；测试消息要求不调用工具，只回复标记。原始诊断保存在被忽略的 `work/project-official-probe/`、`work/project-ui-*/` 下，不提交私人列表或附件。Android 测试初次因注入脚本使用相对 import 失败，改为绝对 URL 后复测通过；生产模块加载方式无此问题。
