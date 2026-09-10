# 图片放大预览 · 0.9.11

## 2026-09-10：加载占位与失败重试（0.10.30 已发布）

已随GitHub同次双端构建34463415359发布；包内容/签名和匿名下载检查通过，未执行APK或升级现有客户端。完整记录见 GITHUB-UPDATES.md。

正文附件、Markdown HTTPS 图片和放大预览共用 `public/image-load-state.mjs`：下载及图片解码期间显示转圈与“图片加载中…”，不显示空 src/未解码图片的浏览器裂图。HTTP 失败、超时或图片解码失败后显示“图片加载失败”和重试按钮；点击重试回到加载状态，成功后才显示原图与下载链接。

正文附件继续在进入阅读区域时加载；成功下载可供刷新复用，失败的缓存会移除，重试重新读取原资源。任务和设备的取消信号在创建图片节点时绑定，迟到的下载结果不能污染切换后的页面；保留原图、任务媒体访问校验与 Android 原图下载路由。这里只维护图片显示状态，不改变官方消息、任务已读状态或草稿。

验证：`node scripts/verify-image-steer-ui.mjs` 覆盖挂起下载、HTTP 503、200 返回损坏图片、连续手动重试、成功缓存、放大、跨设备同 ID 与迟到失败、320/390/844 视口；`node scripts/verify-markdown-images-ui.mjs` 覆盖 HTTPS 图片、失败重试、无 Referrer 和放大。全部为共享生产界面的隔离数据测试，本轮没有运行 APK 或向真实任务写入。

验证日期：2026-09-09，Windows 本机。

## 使用

点击会话、待发送或队列中的图片，打开全窗口深色预览。默认适应窗口，可切换原始尺寸并滚动查看细节；双击图片也可切换尺寸。点击背景、右上角关闭按钮或按 Esc 返回。预览内保留“下载原图”。

仅使用桥接器已经读取的图片，不发送新任务，不生成替代图片。预览会保留自己的临时图片引用，关闭时释放，避免后台刷新缩略图影响正在查看的原图。

## 验证

| 项目 | 结果 | 证据 |
| --- | --- | --- |
| 会话、待发送、队列图片打开 | 已通过 | 真实前端 + 隔离 API 数据，分别点击三类缩略图 |
| 键盘操作和关闭 | 已通过 | Enter 打开、Esc 关闭并返回焦点；关闭按钮和背景点击关闭；点击图片本身保持打开 |
| 原始尺寸与下载 | 已通过 | 图片显示宽度与原图宽度一致；预览下载文件字节与 PNG 原件一致 |
| 竖屏、横屏 | 已通过 | 390×844、844×390 视口测试；竖屏截图人工查看无溢出 |
| 既有桌面功能回归 | 已通过 | 更新入口、23% 下载进度、剪贴板图片请求字节、文件下载、队列取回保持通过 |
| 单 EXE | 已通过 | 构建成功；隔离 `--self-test` 确认内置运行时、DPAPI、资源、官方管道和项目/会话只读访问 |
| Windows 原生窗口点击 | 未测试 | 用户此前说明电脑已锁屏或暂时不在电脑旁；本轮使用 Windows 上的无头 Edge 验证前端，没有声称完成原生窗口鼠标实测 |

前端证据：`evidence/desktop-ux-ui.json`、`evidence/image-preview-mobile.png`，使用隔离测试图片，无私人任务写入。自检证据：`work/image-preview-portable-check/data/self-test.json`。

## 复测

```powershell
$env:REMOTE_BRIDGE_PLAYWRIGHT = ([System.Uri](Resolve-Path '../../work/formatter/node_modules/playwright-core/index.mjs').Path).AbsoluteUri
node scripts/verify-desktop-ux-ui.mjs
```

可以将 Playwright 路径换成本机已安装的 `playwright-core`。手动验收时点击一张图片，再试原始尺寸、Esc、下载原图；此操作不向官方任务发送消息。

## 构建

`RemoteCodex.exe`，0.9.11，43,992,064 字节。

SHA-256：`8ffa5d8cc5ef430f39b2a460b27ae03d692286cac3b47c8107b0a706614e648f`。

签名更新源已发布 0.9.11，资源服务器只保留一个 EXE 副本。

本机与已保存的笔记本均通过现有更新入口安装并回读确认 0.9.11，官方 ChatGPT 的 PID 分别保持 131084、10728。桌面 `RemoteCodex.exe` 哈希与上述发布包一致，本机实际服务提供的 `image-viewer.mjs` 与源码逐字一致。安装证据：`evidence/image-preview-release.json`。
