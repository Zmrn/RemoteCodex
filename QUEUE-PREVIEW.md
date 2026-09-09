# 队列渐进加载（0.10.10）

## 0.10.22：清空取回草稿

2026-09-10。取回官方排队消息后，Remote 会保留独立恢复记录。旧版仅清空输入框没有删除这份记录，因此再次加载时仍提示“继续编辑”。现在用户将文字和全部图片清空时，同步清理对应记录；仅删文字但还有图片、切换任务/设备、初始化时的临时空输入框均不触发删除。已有残留的 draft 记录可点垃圾桶删除，不影响新输入内容；结果未知的取回/调整方向记录不能按普通草稿删除。

控制端先持久化按设备、任务、恢复 ID 隔离的删除意图，再调用既有 ack-recovery 清理目标 Remote 本地备份。断线或回执丢失只重试这项幂等清理，不重放官方写入；迟到列表不能恢复已删除的提示。IndexedDB 保存按调用顺序串行，读取等待此前写入完成。目标端同任务锁内删除，保存失败恢复内存记录，不需要官方写连接。电脑与控制端一起更新可获得完整保护。

复测：`node --test test/draft-discards.test.mjs test/queue.test.mjs`、`node scripts/verify-draft-discard-ui.mjs`、`node scripts/verify-queue-progressive.mjs`、`node scripts/verify-agent-restart.mjs`。新 UI 检查覆盖纯文字、双图取回/逐张移除、跨任务保留、新草稿保护、断线重启、旧响应、回执丢失、另一设备相同 ID、320/390 竖屏与 844 横屏。全部使用隔离 fixture，真实官方写入为零。按用户安排不执行 APK，由用户更新后验证手机实际行为；不把共享浏览器验证当成 APK 实测。

2026-09-09。目标：先展示队列文字和图片占位，再逐张显示图片；无需等待全部图片或历史消息。

## 已确认的原因与处理

- 旧 GET /queue 将原图 Base64 放进 imageDataUrls，单图还重复放进 imageDataUrl；恢复草稿也嵌入图片。界面等待完整 JSON 下载和解析后才渲染文字。
- 队列刷新原来位于历史读取结束之后。现在历史和队列同时请求，并合并重叠的队列刷新。
- 新请求 images=multi-v1&previews=refs-v1 返回 previewProtocol=refs-v1 和 imageRefs，列表与恢复记录均不带图片正文。队列 revision、来源、confirmed 和编辑限制仍从原始官方队列计算。
- 图片使用既有、受验证的 /threads/{id}/media?id={hash} 接口，按任务和内容哈希定位；不新增任意路径读取，不改官方存储或 IPC 写入协议。图片缓存沿用现有 96 MiB 上限。
- 界面同时最多读取两张预览；刷新复用正在读取和已完成的图片，单张失败可重试。移除消息、切换设备/任务或断线时取消无用读取并释放 URL。
- 删除和调整方向不等待图片预览。取回编辑仍由原来的写入回执返回完整图片；断线遗留草稿只在点击“继续编辑”时经带 recoveryId 的 GET /queue 读取完整草稿，核对所属任务及 draft 状态，不删除恢复记录。
- 旧客户端仍收到原来的内嵌图片；旧目标电脑会忽略新参数并返回旧格式。分开加载需要控制端和目标端均更新。

## 实测结果

| 项目 | 结果 | 证据及范围 |
| --- | --- | --- |
| 因果验证 | 已通过 | 生产界面的历史请求和图片请求同时暂停，队列文字、两个图片占位先出现；历史恢复后按钮可操作，图片仍未返回 |
| 队列响应减量 | 已通过 | 相同两图测试队列：旧 JSON 18,178 字节，新元数据 608 字节；revision 相同，保留 official-disk 来源 |
| 单图独立完成 | 已通过 | 第 2 张先于第 1 张完成，立即显示；最多两个预览请求并行 |
| 编辑、调整方向、恢复 | 已通过 | 图片挂起时调整方向与取回正常；完整双图保留；继续编辑按需读取持久化草稿。使用隔离数据，不向私人任务写入 |
| 原图与权限 | 已通过 | 实际 HTTP 图片字节与输入一致；缺 CSRF 返回 403，跨任务图片和恢复 ID 被拒绝；放大查看正常 |
| 生命周期 | 已通过 | 失败重试、刷新复用、取消旧请求、释放 URL、设备相同图片 ID 隔离、断线未知、旧格式兼容 |
| Windows 界面 | 已通过 | Edge 无界面自动化验证 1440×960、390×844、320×568、844×390，无横向溢出 |
| Android | 已通过 | 隔离 API 35 模拟器 emulator-5580，正式 APK + 同签名测试 APK；横屏和竖屏均通过相同图片生命周期用例，私有会话及 CSRF 校验保持；未操作物理手机 |
| 回归及单 EXE | 已通过 | 100 项 Node 测试、13 项窗口尺寸检查；单 EXE 在 PATH 无 Node/Python 时完成内置运行时、DPAPI、静态资源、官方管道和项目/任务只读自检 |
| 双端发布 | 已通过 | 0.10.10 的 EXE/APK 均已签名发布，发布器验证版本、大小及哈希；更新目录各保留一份正式资源 |
| 本机升级后读取 | 已通过 | 实际运行版本 0.10.10，官方连接正常，新队列响应 previewProtocol=refs-v1；两台已保存设备均保留。此次队列为空，来源仍标记 official-disk、confirmed=false |
| 笔记本升级后读取 | 已通过 | 实际运行版本 0.10.10，官方连接正常；真实队列有 3 条消息、1 张图片，新协议只返回文字及图片引用，未发送任何测试消息 |
| 真实队列远程耗时 | 部分通过 | 经已有 Tailscale 接入顺序读取同一 revision：旧 JSON 1,022,180 字节、6,415 ms，新元数据 1,361 字节、1,143 ms；此前另一次新读取为 483 ms。这是单次样本，不是稳定带宽基准，字节数为解压后的 JSON 大小 |

原始测试输出和截图仅保留在被忽略的 work/ 下；不将私人任务、密钥或图片放入 Git。

笔记本的队列数据来源是官方保存记录（official-disk、confirmed=false），不能把此次读取标成所有者实时队列事件。性能比较仅在内存处理内容，落盘报告只有数量、字节、耗时及 revision 是否一致，不含任务 ID、消息和附件。未在用户运行任务中添加或调整队列。

## 复测

在项目根目录：

    node --test test/queue.test.mjs
    node scripts/verify-queue-progressive.mjs
    node scripts/measure-queue-payload.mjs
    python scripts/build-release.py
    python scripts/build_android_test.py

浏览器脚本需要 playwright-core，可通过 REMOTE_BRIDGE_PLAYWRIGHT 指向已安装模块的 file URL。脚本自建回环测试服务并清理，使用生产源码和隔离队列，不启动 Codex 后端。

测量脚本只读官方队列文件，仅输出数量、字节大小和本地计算时间；不输出任务 ID、文字或图片，且不宣称获得实时状态。

Android 使用项目隔离模拟器，安装 dist/RemoteCodex.apk 和 work/RemoteCodex-tests.apk 后执行：

    adb -s emulator-5580 shell am instrument -w -e stage queue-preview com.anso.remotecodex.tests/.Probe

测试 APK 和其 fixtures 不属于正式 APK。正式双端仍按 AGENTS.md 同步构建和签名发布。
