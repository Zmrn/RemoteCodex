# 会话 Markdown 显示 · 0.10.5

旧版只用正则处理少量行内格式和列表，没有表格解析；官方返回的 `| 列名 | ... |` 因此作为普通文字显示。本版 Windows 与 Android 共用 Marked 18.0.12 的 GFM lexer，由本项目逐项创建 DOM。历史与实时消息走同一个渲染器，不改写官方消息。

## 支持范围

- 表格：表头、分隔线、列对齐、空单元格、转义竖线、单元格内粗体/代码/链接/图片与 `<br>` 换行。
- 段落、换行、六级标题、分隔线、引用与嵌套引用。
- 有序/无序列表及嵌套、非 1 起始的编号、只读勾选列表。
- 粗体、斜体、删除线、转义、行内代码、围栏/缩进代码块和语言标记。
- 普通网页链接、引用式链接、自动识别网址；保留现有引用按钮、HTTPS 图片加载与点击放大。

两列表格可在手机宽度内换行；列数过多时仅表格内部左右滑动，外层页面不会被撑宽。代码保持原始空白，代码中的 Markdown、HTML 与引用标记不再解析。

解析器与完整 MIT 许可证内置在 APK/EXE，无 CDN 或运行时依赖下载。只渲染基本 Markdown；数学公式、Mermaid、脚注、语法着色和任意 HTML 排版未实现。除裸 `<br>` 外，原始 HTML 作为文字显示；脚本与危险链接不执行。HTTPS 图片仍直接请求原图网站，沿用已有图片策略。这个改动针对会话正文，不新增独立的 `.md` 文件编辑器。

## 验证

本轮使用非敏感格式样本，不向真实任务发消息，不改变官方应用或数据库。

| 检查 | 结果 | 证据 |
| --- | --- | --- |
| 截图中两列七行表格、列对齐与行内格式 | 已通过 | `scripts/verify-markdown-ui.mjs`，`fixtures/markdown-probe.md` |
| 嵌套列表、勾选列表、六级标题、引用、代码、实体字符 | 已通过 | 同一浏览器回归脚本 |
| 桌面、390px 竖屏与 844px 横屏；宽表格内滚动 | 已通过 | `evidence/markdown-desktop.png`、`evidence/markdown-mobile.png`、`evidence/markdown-gfm-ui.json`（忽略文件） |
| 表格中的引用按钮与图片放大、HTML/链接安全、流式表格前缀 | 已通过 | 同一浏览器回归脚本 |
| 原有图片、附件下载、队列与 Chat UI | 已通过 | `verify-markdown-images-ui.mjs`、`verify-desktop-ux-ui.mjs`、`verify-chat-ui.mjs` |
| Android APK 内置解析器、表格与横竖屏 | 已通过 | Android 15/API 35 `emulator-5580`，`android/test/Probe.java` 的 `stage=markdown` |
| Node 与 Windows 窗口尺寸回归 | 已通过 | 73 项 Node 测试、13 项窗口检查，由 `build-release.py` 执行 |
| 单 EXE 的官方桌面只读访问 | 已通过 | `--headless --self-test`，内置运行时/资源/DPAPI/管道/项目与任务读取 |
| 用户物理手机上的实际显示 | 未测试 | 本轮只使用隔离模拟器，没有操作物理手机 |

`fixtures/markdown-probe.md` 中的七行历史报告是格式样本，并不是本次发布修复了七项历史问题的声明。

## 复测命令

在仓库根目录执行；浏览器测试需要本机 Playwright Core 和 Edge，可通过 `REMOTE_BRIDGE_PLAYWRIGHT` 指向现有 Playwright ES module。

```powershell
node scripts/verify-markdown-ui.mjs
node scripts/verify-markdown-images-ui.mjs
node scripts/verify-desktop-ux-ui.mjs
node scripts/verify-chat-ui.mjs
python scripts/build-release.py
python scripts/build_android_test.py
adb -s emulator-5580 install -r dist/RemoteCodex.apk
adb -s emulator-5580 install -r work/RemoteCodex-tests.apk
adb -s emulator-5580 shell am instrument -w -e stage markdown com.anso.remotecodex.tests/.Probe
```

验证后用 `python scripts/publish-update.py` 同步发布两个固定名称的程序，沿用已有签名身份和忽略的本机发布配置。
