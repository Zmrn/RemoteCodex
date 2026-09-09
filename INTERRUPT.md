# 停止当前回复（0.10.12）

修复原因：此前 public/app.js 仅为 testThreads 显示停止按钮，Bridge.interrupt 又使用 guardProbe，导致用户无法停止普通 Codex 会话。现将自动测试范围与用户主动操作分开；Probe 脚本继续排除开发任务，仅操作自身新建的专用任务。

## 行为与调用链

- 在支持版本的 Codex 运行中会话显示方形停止按钮；输入草稿后保留停止按钮，同时显示发送到队列按钮。草稿和已排队内容由原有队列机制管理，停止操作本身不修改它们。
- conversationView 将所有者的 activeTurnId 单独返回，不依赖当前分页是否包含运行轮次；没有确认轮次时显示禁用的停止按钮。
- POST /api/threads/:id/interrupt 经设备代理转交目标电脑的 Bridge；请求带 requestId 和 expectedTurnId。
- Bridge 核对真实 Codex ID、已验证官方版本，重新 follow 获取当前 owner 的新快照。当前轮次变化、已结束、owner 不符或连接变化时不发送中断。
- 经清单注册的 thread-follower-interrupt-turn v4 向同一 owner 发送 conversationId、mode=user-stop、expectedTurnId。回执必须有匹配的 handledByClientId、result.ok=true 和 result.interruptedTurnId。
- 操作日志防止重复发送。请求发出后丢失回执显示未知，不自动重试；仅将确认之前未派发的失败标记为 rejected。收到请求回执只提示“已请求停止”，实际中断状态取自官方实时事件。
- 新客户端对旧接入端保留其原有 Probe 限制；普通会话停止需要更新目标 Windows 接入端。Chat/Work 中断未验证，不支持；不能转用 Codex 方法。

## 实测证据

2026-09-09，本机 Windows x64 官方桌面版本 26.901.6511.0：

- 专用任务 01a084d2-e461-7061-90df-271aec127269，运行轮次 01a084d2-e6a1-77d2-b2af-0fcd5b2cf248。
- 同一 owner 0f86277b-a44f-47bf-9adf-3e9a55cc9c64 接收中断，回执 requestId=6a5c1feb-6b22-4fe9-9827-7ca4d6d56403，result.ok=true，interruptedTurnId 与预期一致。
- 2026-09-09T06:20:11Z 官方实时事件从 running 变为 interrupted，runtime 变为 idle。相同请求重试未再次派发。
- 随后仍经相同 owner、相同任务发送一条文字，轮次 01a084d2-ee59-7122-a7c7-dfc7d5117e3a 完成并返回 STOP_PROBE_CONTINUED；没有复制会话。
- 证据来自官方 owner 管道及读取结果，本轮没有切换官方可见窗口或用截图证明中断。脱敏记录在被忽略的 work/interrupt-live-K9wZhV/report.json。

独立 Node 用例覆盖普通非 Probe 会话、最新轮次、旧轮次误停保护、Chat/断线/owner 更换、请求去重、回执丢失及重启后不重发。生产界面的隔离浏览器验证包括桌面、手机竖屏和横屏，覆盖停止与排队按钮、草稿保留、轮次尚未加载、重复点击、回执后等待真实状态与断线。

本轮不扩大官方版本范围；26.903.8094.0 仍未完成协议验证，不能据此宣称可写入或中断。

双端验证：110 项 Node 回归、13 项窗口位置检查通过；单 EXE 的内置 Node/Python、DPAPI、静态资源、真实官方项目/任务只读自检通过。旧 verify_portable.py 的后续后台启动阶段与当前单实例桌面启动方式不兼容，未将该阶段记为通过，也未停止用户现有实例。

隔离 Android API 35 模拟器安装真实 0.10.12 APK 后，interrupt instrumentation 在竖屏和横屏均通过上述 8 项停止控件检查；同时通过系统栏/输入框边界和回环会话/CSRF 校验。测试脚本注入隔离接口，没有中断远端或物理手机上的真实任务。首次测试因模拟器残留 Chat 模式未进入 Codex 列表，测试夹具已使用独立窗口恢复标识并明确选择 Codex 后通过。

## 复测

1. node --test test/interrupt.test.mjs
2. node scripts/verify-interrupt-ui.mjs（需 playwright-core；可用 REMOTE_BRIDGE_PLAYWRIGHT 指向已有模块）
3. node scripts/verify-interrupt-live.mjs --create-probe（创建一个专用官方测试任务并测试停止、续写；不对已有任务写入）
4. 双端构建后 python scripts/build_android_test.py，再在隔离模拟器执行 adb -s emulator-5580 shell am instrument -w -e stage interrupt com.anso.remotecodex.tests/.Probe。
