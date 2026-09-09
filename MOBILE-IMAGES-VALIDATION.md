# 0.10.4 手机安全区域、多图输入与网页图片

2026-09-09。APK 和 EXE 已同步构建、验签并发布；资源端每个平台仍只保留一份固定文件。

## 改动

- 原生 FrameLayout 接收 systemBars、displayCutout、IME Insets，将 WebView 实际矩形约束在安全区域；页面 fixed 元素与 CSS viewport 一起缩小。兼容旧系统 Insets 路径。
- Android 文件选择器允许一次选择多张，按 ClipData 顺序交回全部 URI。多次选择和粘贴追加到草稿，每张独立移除，缩略图横向滚动。
- 每条最多 20 张、单张 5 MiB、合计 10 MiB。保持原字节，不自动压缩。10 MiB 使调整方向的 input 和 restoreMessage 两份图片仍在官方 32 MiB 帧限制内。
- 草稿、持久化恢复、队列、取回编辑、调整方向、官方 owner 的 start-turn 均保留有序数组。旧版目标不支持多图时拒绝提交并保留草稿，单图兼容旧接口。旧控制端读取新版多图队列时禁用取回编辑，避免丢附件。
- HTTP 两跳与 Android 中继的请求限制统一为 24 MiB；队列新增前检查总量。没有改写官方数据库，也没有启动独立 Codex 后端。
- 发送确认按原设备和任务清理草稿；切走后又切回仍会清除已发送的文本和图片。
- 回复里的 HTTPS Markdown 图片按文字原位置显示，支持放大、打开原图、失败提示及重试。代码块和普通网页链接保持原意。网页图片直接由查看端访问原 URL，不转发会话文字或桥接凭据，Referrer 为空；不使用特权后端代理任意 URL。

## 验证结果

| 项目 | 结果 | 证据与范围 |
|---|---|---|
| Node 回归 | 已通过 | 最终源码 73/73；含 20 张数量限制、10 MiB 合计、顺序、去重、队列持久化、同 owner 调整方向、旧版能力兼容、Markdown 图片解析 |
| 大图跨设备传输 | 已通过 | 两个各 4 MiB 的图片经 base64 后超过旧 8 MiB 限制，仍通过鉴权 HTTP 双跳；返回字节一致，断线不自动重发 |
| 多图 UI | 已通过 | 真实 Edge 界面与隔离 API：多批选择/粘贴、删除中间项、无效批次保留、切换任务、IndexedDB 重载、队列取回、跨导航的延迟确认清理；手机横竖屏没有横向溢出 |
| 真实官方多图 | 已通过 | 专用 RemoteBridge-Probe 任务，经官方 owner 一次 start-turn 发送两张非敏感图；模型按顺序准确说出红底白方块、蓝底黄圆。稳定任务 ID、owner ID、turn ID 和回复保存在被忽略的 work/multi-image-official-probe/result.json |
| Android 安全区域 | 已通过 | API 35 隔离模拟器：三键导航、手势导航、模拟高刘海、横竖屏切换、真实键盘；以系统 Insets 对照 WebView 屏幕矩形。三键竖屏 WebView 为 [0,63,1080,2274]，键盘弹出后下边界为 1517；WebView 自身 padding 为零 |
| Android 选择器 | 已通过 | 多个 ClipData URI 顺序保持、重复视图不重复加入、取消选择无新增；多选 Intent 已接入。不同厂商图库与输入法的完整选择流程仍需各自设备验证 |
| 真实会话网页图片 | 已通过 | 只读提取用户指出的消息，在新版真实渲染器按原序加载全部 6 张 HTTPS 图片；原图均为 1920×1080。桌面、手机宽度及点击放大通过；原始私人消息仅存于忽略的 work/ |
| Android 网页图片 | 已通过 | 安装最终 APK 后通过 WebView 实际加载两个原网站 HTTPS 图片，缩略图、放大和原图入口通过；没有绕过 CSP 或使用截图替代图片 |
| 既有 UI 回归 | 已通过 | desktop-ux、Chat、设备切换、分页、断线重连（含 45 秒心跳失联）；保留原有附件下载、图片预览、引用及编辑行为 |
| Windows 单 EXE | 已通过 | 13 项窗口位置检查；最终 EXE 在独立目录只读自检：内置 Node/Python、DPAPI、Web 资源、官方管道识别、真实项目与任务读取全部通过 |
| 双端发布 | 已通过 | 0.10.4 APK/EXE 同版本、哈希、RSA 更新签名验证；APK 原签名身份保留。发布器确认远端各一份正式资源 |

## 限制与复测

Android 运行测试使用 API 35 x86_64 隔离模拟器，没有安装到用户物理手机。旧 API 26–29 的兼容路径已编译但未运行验证。系统安装器仍要求用户确认 APK 更新，不能静默安装。

Chat 模式的图片入口仍未接入；Codex 新建任务的首条消息仍需文字。这里的双图测试证明官方模型收到图片输入，不代表原生生图/编辑功能的新验证。网页图片加载依赖原网站；打开原图与本地附件下载是不同入口。

复测命令见 ANDROID.md。新增脚本为 scripts/verify-multi-images-ui.mjs、scripts/verify-multi-images-live.mjs、scripts/verify-markdown-images-ui.mjs；Android stage=safe-area 与 stage=web-images。源码测试不包含私人消息、真实访问密钥或签名私钥。

已通过内置更新器将本机 Windows 客户端从 0.10.3 更新为 0.10.4，并读回 current 状态；没有重启官方 ChatGPT。
