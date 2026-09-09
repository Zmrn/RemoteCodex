# 账户额度显示（0.10.9）

左下角只展示所选电脑上普通 Codex 的主额度：存在 5 小时窗口时，显示 `5h 额度剩余 …%`；没有 5 小时窗口时，显示周额度。点开设备菜单，可看各窗口剩余比例和各自的重置时间，普通 Codex 排最前，Spark 等独立模型额度放在后面。Plus/Pro 标识显示在详情的账号共享额度说明中。

以当前官方返回为准，不按订阅名称补造或删除窗口。当前实测本机 Pro 的 `codex.primary` 是 10080 分钟周窗口、没有普通 Codex 5h 窗口；Spark 有自己的 300 分钟窗口，不能占用左下角主显示。Plus 的普通 Codex 5h 窗口是本次优先展示的对象。

## 协议与兼容

- `/usage` → 已运行官方桌面的 `get_usage_limits`。优先读取 `rateLimitsByLimitId`，仅在缺少有效分桶结构时使用 `rateLimits`。
- `windowDurationMins=300` 为 5h，`10080` 为周；不根据 primary/secondary 位置或重置时间推测窗口。
- `schemaVersion=2` 增加 `fiveHour` 和公开的 `planType`，保留原 `weekly` 字段兼容旧客户端。不给外部返回账号 ID、credits、重置额度券或完整原始响应。
- 剩余比例为 `100-usedPercent`，限制在 0–100。`null`、缺失、字符串或非有限数字显示未知，不变为 100%。5h 未知时不偷偷用周额度顶替。
- 新客户端连接旧目标时，仍展示已知周额度，并说明需更新目标后才能读取 5h；不能据此推断账号没有 5h。
- 设备切换保留请求代次检查，迟到的旧设备数据不会覆盖新设备。断线、过期、读取失败清除旧百分比；不将 Spark 当普通 Codex 的替代值。

## 复测

```powershell
node --test test/usage.test.mjs
node scripts/verify-usage-ui.mjs
python scripts/build-release.py
python scripts/build_android_test.py
adb -s emulator-5580 install -r dist/RemoteCodex.apk
adb -s emulator-5580 install -r work/RemoteCodex-tests.apk
adb -s emulator-5580 shell am instrument -w -e stage usage com.anso.remotecodex.tests/.Probe
```

浏览器测试使用 `REMOTE_BRIDGE_PLAYWRIGHT` 指定模块路径。模拟器测试使用独立测试数据和界面节点，不发送真实任务消息、不修改设备账户。发布后需在本机与已授权远端读取真实 `/usage`，分别核对主窗口与副窗口，记录脱敏结果。

## 验证记录（2026-09-09）

- 已通过：Node 99/99，包含 Plus 5h 优先、Pro 普通 Codex 周额度、Spark 不替代主显示、窗口位置变化、零值、未知值、断线和旧协议兼容。
- 已通过：生产界面浏览器测试，验证普通 Codex 5h/周排序、Spark 明确标注、各自的重置时间、切换设备后的迟到响应隔离，以及手机菜单边界；项目选择回归通过。
- 已通过：API 35 Android 隔离模拟器的 `stage=usage`，10 项原生 WebView 检查；未安装到物理手机。
- 已通过：Windows 单 EXE 在 PATH 仅含 System32 时完成内置运行库与官方桌面只读自检。
- 已通过：同步构建并签名发布 0.10.9 APK/EXE，更新服务器每个平台保留一份固定名称资源。真实 Plus/Pro 设备升级后的读取结果另附于完成验证后。
