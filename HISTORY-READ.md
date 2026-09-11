# 部分历史优先显示 · 0.10.16

## 2026-09-11 消息时间显示（源码未发布）

共享会话页现在常驻显示每条消息的时间。超长历史分段读取保留已核对 `item_completed` 的官方 `timestamp`，标为“记录于”；其他消息只有整轮 `startedAt` 时明确标为“本轮开始”。按当前控制端时区显示，不使用本地观察时间补造，详见 MESSAGE-TIMES.md。本次源码未打包。

## 0.10.34 已发布（2026-09-11）

下述发送准备与文件流关闭修复已随GitHub Build34550835116正式发布至[v0.10.34](https://github.com/Zmrn/RemoteCodex/releases/tag/v0.10.34)。包内源码对实际长任务只读确认官方列表与新的owner状态匹配，无read_thread或任务写入。原签名、包内容和隔离升级数据保护通过；未执行APK或升级现有客户端。请同时更新目标Windows接入端及Windows/Android控制端；完整范围见GITHUB-UPDATES.md。下面未发布描述为开发阶段记录。

## 2026-09-11：发送前不再读取整轮正文（未发布）

GitHub首次Checks中，历史身份拒绝测试随后重命名目录遇到EPERM。流式索引提前退出原来只调用`destroy()`，现在等待`close`之后才完成，避免Windows还持有文件句柄。新增延迟关闭的确定性回归，保留原身份/符号链接拒绝断言；没有重试写入或跳过校验。修正后Node22.19.0全套277项、接口清单与共享大历史UI6组通过；下面276项为首次提交前的验证记录。

0.10.33修复了大历史显示，但发送准备仍调用`read_thread`读取一整轮。问题任务的官方日志显示内部读取完成、发送工具结果时超过8MiB帧上限，因此消息在派发前被拒绝；不是已发送后丢失回复。

`src/thread-metadata.mjs`现在为`Bridge.codexThread()`提供共享元数据读取：先调用官方`list_threads(limit:50)`，严格核对任务ID、Codex类型、本机host与冲突项，只取当前列表返回的元数据。发送采用此路径时，额外等待本次follow之后新观察到的同任务owner状态，并在最终派发前复核连接、owner和idle。列表缺目标或不可用时保留原官方单任务读取，关闭输出并缩小输出文字；仍超限则明确提示“未发送、草稿已保留”，可在官方打开或固定任务后重试。未知派发结果沿用原requestId保护，不换通道重发。

这个读取方法同时供原本只需任务元数据的设置、队列、调整方向、停止、问答、改名与创建准备使用；各功能自身的owner/轮次/请求核验保持。完整历史和已读回执仍走原官方核验，绝不以rollout里的完成记录授权写入。未扩大官方版本、Chat/Work、接口和功能范围。

Node22.19.0全套276项通过；新`test/thread-metadata.test.mjs`覆盖长会话不读正文、重复请求、过期owner、运行变化、换连接、错误身份、未知回执与列表降级。本机官方26.903.9818.0/PID30692对用户问题任务只读确认：官方列表idle、本次owner快照idle且身份一致，只有list_threads与owner发现/订阅，没有read_thread或任务写入。未做真实发送往返；当前版本仍0.10.33，未构建、发布或安装。

## 0.10.33 已发布（2026-09-11）

下述超长历史修复已随GitHub同次双端构建34506575435正式发布至[v0.10.33](https://github.com/Zmrn/RemoteCodex/releases/tag/v0.10.33)，源码2c3fd27238ce4413b4216677b60779270c020ed3。请同时更新目标Windows接入端和使用的Windows/Android控制端；只更新手机不能修复旧接入端的读取失败。

这次云包内源码与运行时在官方26.903.9818.0上只读遍历问题任务32页820项、无重复，独立2041041字节PNG加载成功；首次连接及降级约9.1秒，最大响应143690字节，刷新一致。原签名、包内容、隔离旧包升级/强制重启及匿名GitHub下载核验通过。未运行APK或向官方任务写入，发送/停止/已读同步仍受官方实时接口约束。完整发布记录见GITHUB-UPDATES.md；下面“源码修复”的未发布描述保留开发阶段事实。

## 2026-09-11：单轮超限时读取官方原始历史（源码修复）

0.10.32之后的源码增加`src/rollout-history.mjs`。官方工具读取缩至一轮仍返回已识别错误时，共享内容页从当前已验证官方进程的home读取该任务原始历史，按消息分页，图片单独按需读取。不是扩大我们自己的帧上限，也不修改官方程序或复制会话到另一套数据库。版本保持0.10.32，本轮未构建、发布或安装；已安装0.10.32不含该修复。

- 来源必须是当前官方连接、实时list_threads返回的本机Codex任务及官方home内唯一rollout文件。核对session_meta.id、item_completed的thread_id/turn_id，拒绝跨设备、Chat/Work、路径别名/符号链接、重复文件及不明格式。现阶段依赖任务出现在官方最近50项列表或固定任务中。
- 首次有界流式扫描官方文件，只记内存中的消息ID、偏移、长度和记录摘要，不存正文/图片副本或运行/已读状态。忽略界面原本不显示的原始模型输出、推理等记录；投影官方UserMessage、AgentMessage、CommandExecution、FileChange、FunctionCallOutput及image_gen.generation完成项。每段最多40项、通常128KiB正文，超长单项沿用原分页上限保护。
- 图片保留当前记录引用，实际请求时重新只读该记录、核对摘要并验图片格式/25MiB上限；使用共享加载中、失败和手动重试界面。旧图片文件已删除时，有内嵌生成结果的记录仍可读取。生成图片没有在索引中长期缓存base64。
- 现有官方游标不猜测解码：仅使用本连接已读页记录的边界轮次衔接；无法对齐时保留内容并要求重新打开。官方文件的身份、大小或完整精度时间改变后重建索引，旧游标、缓存页和图片引用不再放行。官方重连也重建索引和图片引用，避免使用已失效的旧连接。官方回退记录移除对应轮次；不完整末行等写入完成，不跳过损坏的完整记录。
- 历史变化后共享页面丢弃旧版本显示，重新加载，不保留被删除的消息；失败则保留已显示内容和草稿。偏移索引最多4个任务、游标1024项、图片引用4096项，仅内存；文件4GiB、单条记录64MiB、索引10万项、扫描20秒等边界由中央清单维护，超过边界明确报错。
- 只为内容页启用此降级。实时状态继续来自官方列表/已确认owner；文件中的task_complete不授权发送/停止、不签发已读回执。写操作仍按原官方实时核验，不能保证这类超限任务的全部写操作也恢复；本轮解决历史显示，不把文件内容冒充活动owner。Chat/Work适配未扩大。

本机官方Windows x64 26.903.9818.0，用户指定「继续 Godot UI 设计与图集归档」实际只读验证通过：原文件561103795字节，完整遍历32页、820项当前界面支持的消息/记录、无重复；一张2041041字节PNG从官方记录单独加载成功，最大响应143690字节，刷新内容一致。首次连接+失败降级+索引约11.1秒，后续复用未变化文件的偏移索引，不承诺固定延迟。此前另一个任务的0.10.16证据不能替代本次结果。

268项Node22.19.0、接口清单和新共享UI6组通过；原历史读取/分页/切设备/已读/图片与快捷调整/逐功能兼容回归通过。覆盖跨任务/主机和路径拒绝、文件替换/截断/完整损坏、末行写入、官方回退、游标边界、旧页缓存失效和不签发回执。没有运行APK或模拟器、升级现有客户端、重启官方应用或向真实任务写入。真实证据在会话`work/large-history/work/live-final.log`及对应rollout-live目录，未保存私人正文；新UI在`work/large-history/work/ui-final.log`。

复测：`node --test test/rollout-history.test.mjs test/history-read.test.mjs test/conversation-pages.test.mjs`、`node scripts/verify-rollout-history-ui.mjs`。后者已加入Checks；真实只读脚本`node scripts/verify-rollout-history-live.mjs TASK_ID`仅用于用户明确指定且能够复现超限的本机任务。下面0.10.16为历史实现和发布记录，其中“不读取磁盘历史”的描述已被本节取代。

2026-09-09，用户报告一个大型 Codex 任务在 Remote Codex 中整页内容无法读取。旧版在本地分页前向官方一次读取两轮；官方发送端的 8 MiB 帧限制导致整次调用失败。只读复现中，最近一轮可读，紧邻的较早一轮仍失败。官方日志明确记录帧超限，不能通过扩大我们自己的接收上限解决。

## 行为

- `src/history-read.mjs` 在官方批量调用返回已识别的读取失败时，用相同任务、相同官方游标尝试一轮；连接失效、超时、权限和游标错误不按大小问题重试。成功后为当前官方连接记住这个任务的逐轮读取方式，最多记住 128 个任务。
- 返回可读部分和提示后，沿用现有媒体处理、官方状态来源与本地消息分页。没有新增磁盘历史解析，不写官方数据，不把已结束的历史轮次当成实时状态。
- 若单轮仍失败，返回明确错误。前端保留已经显示的消息、草稿和失败位置，提供手动重试；较早消息和中间回填缺失段均适用。不能跳过未知历史或返回空成功页。
- 刷新失败保留消息，并注明状态未知。任务、设备或模式切换清除旧读取提示；失败段不自动循环读取。正常最新消息刷新继续工作。
- Windows 与 Android 复用同一份界面。自动降级需要目标 Windows 接入端也更新至 0.10.16；新客户端无法修复旧接入端已返回的整页错误。

## 本轮验证

| 验证 | 结果与范围 |
|---|---|
| 135 项 Node、13 项窗口检查、中央兼容清单 | 通过 |
| 新增 5 项读取测试 | 同任务/原游标降级、单轮错误不为空页、非大小错误不重试、连接替换隔离、失败游标可重试 |
| Edge 1300px / 390px | 通过：真实 Bridge/HTTP 隔离故障、消息与草稿保留、重试去重、刷新失败、任务切换；另外覆盖旧游标为空的中间缺失段 |
| 原有分页、设备切换回归 | 通过：滚动定位、回填去重、服务重启、迟到响应、只读重连 |
| 用户问题任务的真实官方只读调用 | 官方 Windows x64 26.903.8094.0；可显示最近 1 轮、3 项可见消息；较早超限段明确失败，刷新仍可读；任务写入 0 次 |
| 最终 Windows EXE | 隔离包内自检通过；内置运行时、DPAPI、资源及真实官方只读连接通过；包内修改文件与源码一致，不含用户配置 |
| 旧包→新包设备保存与强制重启 | 通过：设备 ID、地址、名称、加密密钥、选择保留，显式删除不复活；安装版配置字节未变 |
| Android API 35 x86_64 隔离模拟器 | `stage=history-read` 横竖屏 PASS：失败回填保留两端内容、提示、原游标重试、消息去重、草稿、切任务隔离和系统安全区域；未安装用户物理手机 |
| Android 兼容元数据 | `stage=compatibility` PASS：安装包版本、清单签名、发布说明哈希及中央接口常量一致 |
| 双端正式发布 | 同为 0.10.16；线上签名、完整哈希、发布说明、兼容清单一致；服务器各保留一份正式资源 |
| 笔记本内置更新 | 0.10.15→0.10.16，通过线上验证后的本地产物缓存交给内置更新器；2 项现有设备、选择、加密密钥、接入/更新设置保留；官方 PID 未变、连接正常 |
| 安装版真实页面 | 先显示问题任务的 3 项消息，较早段失败和刷新均保留相同正文，重试入口可见；任务写入与持久化选择改动均为 0 |

正式产物使用原 Windows 更新签名身份和 Android 安装证书。现场证据留在忽略目录，不提交私人正文、密钥或任务历史。

## 复测

```powershell
node --test test/history-read.test.mjs test/conversation-pages.test.mjs
node scripts/verify-history-read-ui.mjs
node scripts/verify-pagination-ui.mjs
node scripts/verify-device-switch-ui.mjs
# 仅对已明确指定、可复现“最近可读/较早超限”的真实任务做只读验证
node scripts/verify-history-read-live.mjs TASK_ID
python scripts/build-release.py
python scripts/build_android_test.py
adb -s emulator-5580 install -r dist/RemoteCodex.apk
adb -s emulator-5580 install -r work/RemoteCodex-tests.apk
# 仅在隔离模拟器预授通知权限，避免系统权限弹窗阻塞 instrumentation 启动
adb -s emulator-5580 shell pm grant com.anso.remotecodex android.permission.POST_NOTIFICATIONS
adb -s emulator-5580 shell am instrument -w -e stage history-read com.anso.remotecodex.tests/.Probe
adb -s emulator-5580 shell am instrument -w -e stage compatibility com.anso.remotecodex.tests/.Probe
# 安装版真实页面验证，仍不发送任务消息或改变持久化设备选择
node scripts/verify-history-read-installed.mjs TASK_ID
```

浏览器测试可用 `REMOTE_BRIDGE_PLAYWRIGHT` 指定本机 Playwright 模块。Android 只用 `work/android-avd/RemoteCodexTest` 隔离设备，不能安装到未指定的物理手机。只读脚本对明确的复现任务断言最近成功、较早失败，不要拿普通任务的断言失败判定软件退化。

## 支持范围

支持官方 Windows x64 **26.901.6511.0、26.903.8094.0** 的已验证 Codex 核心读写范围；本轮真实超限复现仅在后者。Chat 列表与历史可读，文字续写仍待专用真实验证，新建、模型和图片未支持；Work 没有独立验证。VS Code 共存的精确版本组合与原设备证据继续见 `VSCODE-COEXISTENCE.md`，本机是官方独占 broker。

单轮官方响应仍可能超过其通道上限，因此此更新不能承诺恢复完整历史，也不能解决官方任务本身无法继续执行的问题。

## 0.10.16 正式产物

| 文件 | 大小（字节） | SHA-256 |
|---|---:|---|
| RemoteCodex.exe | 44,061,184 | `ca88141b576009b6668ee40827109352a555e6c9fc77b7e01c4e7d1694c4fcb5` |
| RemoteCodex.apk | 203,541 | `55bab4268e532fb236400dec5d4c9c8c3580e6cfe9cf8125051235940cb01e0b` |

兼容清单 SHA-256：`a79a15704fc35c1243d38187c0317761a76cc85c30ea8d3a54cf0435acab12bb`。Android 安装证书 SHA-256：`3c0a98ec3c9f37318525f5d0e4afb3417812215d625e48a9013b5ee649acb2b1`。
