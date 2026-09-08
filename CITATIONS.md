# 网页引用显示修复（0.10.3）

官方回复中的私用区字符 `U+E200 cite U+E202 … U+E201` 是来源查找标记，不是网页地址，也不是文件编码损坏。之前渲染器直接输出了这些字符，导致方框和内部 ID 混入正文。

Windows 和 Android 共用的渲染器现在将其显示为小型引用编号，例如 `[1, 2]`；同一回复中的重复来源使用同一编号。点击编号展开“来源链接未提供”的说明。复制回复保留 Markdown、转换引用编号，并附上来源缺失说明。普通 HTTP(S) Markdown 链接继续可用。行内代码和围栏代码保留字面内容；不完整的引用标记显示为可读提示。

## 实际接口限制

2026-09-09 读取用户报告的同一条真实 Chat 会话：官方 OpenAI.Codex 26.901.6511.0，ChatGPT.exe PID 131084。app-tools `read_thread` 的六条 assistant 项目只包含 `type`、`id`、`text`，attachments 为空，没有引用网址或标题。当前官方 renderer 源码确有 `content_references` 处理，但 app-tools 返回结果没有携带这份元数据。

本版解决了乱码显示，**没有恢复这些引用的真实网址**；无法直接点击编号访问来源页。不会将不透明的 turn/view/search ID 拼接成地址，也不会猜测、重新搜索或将私人正文发送给外部服务。需要来源原网页时，应在官方 ChatGPT 查看。没有修改官方记录、缓存或安装文件。

## 验证

| 项目 | 结果 | 证据 |
|---|---|---|
| 原会话引用显示和复制 | 已通过 | 官方命名管道只读 → 当前渲染器；6 条回复、82 处引用，未渲染标记 0，复制残留 0，浏览器异常 0，任务写入 0。脱敏汇总在忽略的 `work/citations-read-*/result.json`。 |
| 真实来源网址恢复 | 部分通过 | 普通 Markdown 网址保持可点击；内部引用所需的来源元数据未被当前官方历史工具返回，显示明确说明。 |
| 分组、重复编号、不完整引用 | 已通过 | Node 单元测试；编号只在当前消息内使用，不依赖历史分页是否已加载。 |
| 代码、普通链接及实际复制按钮 | 已通过 | `verify-features-ui.mjs` 使用真实应用界面与隔离 API，验证加粗/列表引用、说明点击和复制按钮。 |
| Windows 可运行构建 | 已通过 | Node 67/67，窗口回归 13 项；EXE 内置 Node/Python、DPAPI、官方管道与项目/会话只读自检 passed。 |
| Android WebView | 已通过 | 隔离 `emulator-5580`，正式签名 APK 0.10.3，`stage=citations`：编号、点击说明、复制转换、代码及普通链接通过。没有安装到物理手机。 |
| 已安装 Windows 应用 | 已通过 | 本机桌面启动器自动更新到 0.10.3，更新状态 current；从它实际运行的服务打开真实界面，目标 Chat 首段 4 项消息、41 处引用正确显示，说明可展开，异常和任务写入均为 0。 |
| 双端发布 | 已通过 | 更新服务校验双端签名、版本、大小、哈希后覆盖；EXE 和 APK 各一份，版本均为 0.10.3。 |

Android 测试首次失败是 instrumentation 注入的 `import('/ui.mjs')` 以 `about:blank` 为基址，未加载模块；测试改用当前应用的绝对 origin 后通过。正式界面使用自身 ES 模块导入，不受该测试注入问题影响。

## 复测与发布

```powershell
npm test
node scripts/verify-features-ui.mjs
# 仅查询，参数必须为明确选定且含引用的真实 Chat ID；不发送任务消息。
node scripts/verify-citations-read.mjs <thread-id>
# 本机 EXE 更新后验证其实际服务和界面，仅查询目标 Chat。
node scripts/verify-chat-live-ui.mjs <thread-id>
python scripts/build-release.py
python scripts/build_android_test.py
adb -s emulator-5580 install -r dist/RemoteCodex.apk
adb -s emulator-5580 install -r work/RemoteCodex-tests.apk
adb -s emulator-5580 shell am instrument -w -e stage citations com.anso.remotecodex.tests/.Probe
python scripts/publish-update.py
```

浏览器验证需要 `playwright-core`，可通过 `REMOTE_BRIDGE_PLAYWRIGHT` 指定模块 URL。读入的私人正文仅用于内存中的验证，测试报告只记录 ID、字段形状、计数与状态；不得把临时探测原文加入 Git。

发布继续使用固定文件名、既有签名和忽略的 `release.local.json`，同时覆盖 EXE、APK 及两个签名清单。

0.10.3 EXE：44,004,352 字节，SHA-256 `d58ea6955718d29e694d159f60f91ef74727f83a2bb6eac6c4596771aaabab6d`。APK：170,044 字节，SHA-256 `c5ee6fc3af5e3137c7b118da78d7058be41d431c193c2aecf4f5704c50311b4a`，versionCode 10003，签名身份沿用。
