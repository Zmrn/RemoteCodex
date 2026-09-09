# 队列渐进加载（0.10.10）

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
| 真实大队列远程耗时 | 未测试 | 本次读取本机官方保存记录时，非空队列为 0；不将测试样本的字节减少比例称为真实网络提速比例 |

原始测试输出和截图仅保留在被忽略的 work/ 下；不将私人任务、密钥或图片放入 Git。

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
