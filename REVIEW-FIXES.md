# 七项 review 问题修复 · 0.10.6

本轮覆盖原 review 清单的全部七项。Windows 与 Android 共用交互实现；只修改桥接程序自己的源码与数据，不改写官方历史、安装包或登录信息。

| 原问题 | 修复结果 | 验证 |
| --- | --- | --- |
| 发送中切走再返回，已发送草稿残留并可能重复提交 | 已通过。发送确认只清理来源任务中未被修改的草稿，保留其他任务/新草稿，并立即保存清理结果。先前多图迭代已覆盖主要修正，本轮补齐回归和持久化 | 浏览器切走、返回、延迟确认；发送按钮禁用，实际只发一次。多图回归保留图片顺序 |
| 尚未发送即被拒绝，却永久记录为结果未知 | 已通过。Chat/Codex 日志区分 preparing、rejected、outcome-unknown、accepted；并发相同请求合并。在调用官方发送入口前同步持久化不确定状态，新建任务权限准备失败也可重试 | 两种模式的拒绝后原请求重试各只发一次；确认丢失及重载日志后不重发；新建前准备失败没有重复创建 |
| 实时刷新抢走问题回答焦点 | 已通过。复用未变化的问答 DOM，更新其周围消息；不销毁再重新聚焦 textarea | 保留同一个元素、焦点、选区和中文输入法组合事件的目标 |
| 未提交问答草稿更新/重开后丢失 | 已通过。输入后自动保存到现有 IndexedDB 恢复记录；后台/更新时也保存，按设备、任务、问题隔离。完成状态一同保存，未提交回答计入更新忙碌状态 | 无手动备份的自动保存、连续两次重载、切换任务恢复 |
| 空闲任务内容读取暂时失败，不自动恢复 | 已通过。按 1/2/4/8/15/30 秒间隔重试；成功重置退避，切换任务/设备取消旧请求。400/401/403/404 不循环重试 | 假 API 返回一次 502，之后没有新 owner 事件也恢复输入；失败期间显示未知 |
| Android 超过 6 MB 的结果图片不能保存 | 已通过。优先通过来源任务鉴权媒体地址读取原图；blob/data 使用本机二进制接口，移除 6 MB 门槛及误导性的附件提示 | 7 MiB 图片经过真实 APK 保存回调，长度及 SHA-256 完全一致；图片预览保留来源地址 |
| 浏览任务后不释放订阅，快照持续累积 | 已通过。每个查看窗口独立订阅租约，切走/关闭明确释放，30 秒续期，90 秒未续期回收；不同窗口共享同一官方订阅。旧客户端/临时操作最多保留 16 项，最多 64 个显式查看租约。回收 live/queue/page 快照，媒体索引限定最近 64 个任务 | 连续 60 个临时任务保留 16 个，发出 44 次取消跟随；多查看者互不释放，过期回收，迟到 owner/事件不能恢复已释放快照 |

结果未知的请求继续禁止自动重发。旧版已经持久化且无法证实是否发送的未知记录不会根据错误文本擅自改成“未发送”。恢复连接与内容重试只读取状态，不重放用户消息。

租约仅管理桥接器的观看连接；释放时发送已使用的 `thread-stream-following-changed` 协议的 `following:false`，不调用中断接口。旧设备未上报 `viewerLeases` 时不发送取消请求，以兼容旧版实现；完整回收需要被控电脑也更新。操作或旧客户端的临时租约可能让最近任务额外保留约 90 秒，定时清理间隔为 15 秒。

## 真实官方任务验证

- 专用任务 ID：`01a08426-7724-7111-be05-e7dc87882371`；不是开发任务。
- 官方 `ChatGPT.exe` PID：`6096`；发送 owner：`0f86277b-a44f-47bf-9adf-3e9a55cc9c64`。
- 原生轮次 ID：`01a08426-aa71-7230-bf2e-b5cd0b001987`，回读 `REMOTE_REVIEW_SEND_OK`。
- 同请求 ID 重试返回已接受结果，没有新发指令。两个查看租约只释放最后一个时才取消官方跟随；释放后官方仍报告此专用任务为 idle。
- 调用链：当前桥接源码 → 已运行官方桌面 app-tools 创建专用任务 → 同一官方 owner 的原生发送接口 → 回读同一 task/turn。
- `scripts/verify-send-lifecycle-live.mjs` 使用持久化请求 ID，复测不重复创建或发送已接受的探针。原始记录在被忽略的 `work/send-lifecycle-official-probe/`。

Chat 的拒绝/去重使用隔离官方接口替身验证；没有为本轮临时开放普通 Chat 新建、模型或图片能力，也未宣称完成普通 Chat 真实写入认证。Android 使用 Android 15/API 35 隔离模拟器，未操作物理手机。

## 复测

最终构建通过 80 项 Node 测试和 13 项 Windows 窗口检查；单 EXE 自检通过内置运行时、DPAPI、资源和官方项目/任务只读访问。浏览器通过本次七项回归以及图片、附件、队列、多图、Markdown、Chat 界面的相关检查。Android 最终保存验证记录在被忽略的 `work/final-android-review.txt`；可分享的格式化验证结果由 UI 脚本写入 `evidence/review-fixes-ui.json` 与 `evidence/review-image-download-ui.json`。

```powershell
node --test test/*.test.mjs
node scripts/verify-review-fixes-ui.mjs
node scripts/verify-image-download-ui.mjs
node scripts/verify-multi-images-ui.mjs
node scripts/verify-send-lifecycle-live.mjs
python scripts/build-release.py
python scripts/build_android_test.py
adb -s emulator-5580 install -r dist/RemoteCodex.apk
adb -s emulator-5580 install -r work/RemoteCodex-tests.apk
adb -s emulator-5580 shell am instrument -w -e stage review-fixes com.anso.remotecodex.tests/.Probe
```

浏览器脚本需要 Playwright Core 与 Edge，可通过 `REMOTE_BRIDGE_PLAYWRIGHT` 指向现有运行时。专用真实探针之外的 UI/协议检查全部使用非敏感假数据，不操作用户真实任务。发布沿用已有 EXE/APK 签名和被忽略的 `release.local.json`，通过同一更新服务覆盖双端固定文件名。
