# 新建会话与图片（0.10.14）

修复新建时粘贴/选图被禁用，以及新建输入框允许向未验证的官方版本发送、提交后才报英文错误的问题。新草稿可以先输入和添加多张图片；目标设备连接、支持版本和带图创建能力确认后才允许发送。创建失败保留文本和全部图片，界面回到草稿，不把失败的预览消息当成已发送。

## 官方调用链与限制

本机读取的 26.901.6511.0 官方 renderer 中，create_thread 的 schema 只有 title/prompt/target/model/thinking；DXi 调用 QLi，委托创建只转交字符串 prompt。它没有可传入图片的参数。本轮没有向这个工具添加编造的附件字段。

因此带图新建采用一次提交、两阶段处理：先通过官方 create_thread 创建同一个桌面所有者管理的准备会话，请模型只回复 READY；随后向该会话的真实 owner 发送用户的文字和原生 image 输入。不会先让模型执行缺图的用户要求，用户不必手动先发文字。官方历史会多一轮准备消息；它也会有少量额外耗时及模型用量。本功能不代表首次原生 create_thread 就接收了图片，也不代表原生生图工具已验证。

支持最多 20 张、单张 5 MB、总计 10 MB，沿用既有原图链路。只发图片时附带“请查看这些图片。”。项目选择仍在目标电脑重新读取官方 list_projects，使用实际 projectId/local；不改项目归属。

请求记录只保存输入哈希、子请求 ID 和创建回执，不保存正文或图片。创建与图片发送各有稳定请求 ID：并发/重试不重复创建或发送；丢失发送回执保持未知。准备会话等待超时后重试继续同一个会话。需要更新目标 Windows 接入端；旧端无法接收带图新建时禁用发送，不能静默丢图。

## 兼容性检查

GET /api/compatibility 读取当前官方进程、实时工具 schema 和同一安装包 app.asar 的静态协议版本/哈希；不返回源码、凭据或私人任务内容。

POST /api/compatibility/probe 仅接受固定 create-vision-owner-v1 场景、requestId 和清单列出的 expectedVersion，不接收目标任务 ID、prompt 或代码。场景使用独立 Bridge 查看连接，仍将操作转交已运行官方桌面，固定创建两条专用任务并检查文字、两张图片识别、设置、队列、重连、中断与同会话续写。

候选版本只在这个固定测试的私有 Bridge 实例中可验证；正常 API 仍拒绝候选版本写入。每次 ID 写入必须是本次创建的任务，继续排除开发任务。任务日志跨重启不会重放；查看失败/中断的检查任务不会自动继续写入。通过后仍须人工审阅证据、更新中央版本清单并双端发布；不会自行放行新版本。接口沿用本机 CSRF 和已有 Tailscale 访问密钥，未增加监听范围。

## 实测

2026-09-09，本机 26.901.6511.0：

- 文字任务 01a084ea-aead-7611-a222-4d4e504a6187，带图任务 01a084ea-d599-7e23-89a8-d3f1c983c960。
- 一次提交后，模型识别两张图片的红/蓝/白/黄颜色及圆形、方形。随后同一 owner 的设置、队列加入/删除、查看断开重连、停止、续写全部通过。
- 脱敏证据在 work/create-compatibility-Er6Noc/compatibility-probes/。并未操作已有私人任务。

2026-09-09，笔记本 26.903.8094.0：已通过固定场景的全部 12 项检查，再将版本加入 verifiedVersions。未直接删除版本保护。中间版本 0.10.13 仅用于部署固定检查，正式修复为 0.10.14。

- 文字任务 01a084fe-f87f-7ec0-b0d6-02e53e69ab6d，带图任务 01a084ff-16e8-7f70-903f-ceabd6785b3b。
- 安装包 .vite/build/src-J2PvP4xj.js，SHA-256 为 4cc980cd737b02f999b9fe8d9757c37d2ce86c928043f19f46d56cc52bce8f66；全部 9 个工具所用字段匹配，8 个所有者方法版本匹配。
- 文字创建读回、同一任务两图识别、模型/推理/只读权限设置、队列加入删除、查看连接重连保留原运行轮次、相同 owner 停止、停止后同会话续写：已通过。
- 脱敏证据：work/laptop-create-compatibility-inspect.json、work/laptop-create-compatibility-status.json。调用经认证的 Tailscale 接入端，进入笔记本现有官方桌面管道和真实任务 owner，未启动独立 Codex 后端。
- 本轮未测试笔记本新版的项目创建、问题/审批提交、原生生图、Chat 文字写入或 Work；未进行笔记本可见窗口的人工观察，不能把协议成功称为界面点击实测。

界面测试：Windows 浏览器隔离生产界面在 1440×960、390×844、844×390 全部通过 9 项检查。Android API 35 隔离 emulator-5580 横竖屏同样通过，且输入框未被系统区域遮挡；未操作物理手机。模拟的粘贴事件验证多图处理和请求内容，不等于验证每种安卓输入法的真实系统剪贴板。

新增 HTTP 集成回归验证多图从 /api/threads 一直进入同一官方 owner 的原生图片输入；非法图片在新建前拒绝。重启/丢失回执、并发重复请求、草稿保留和未验证版本拦截也有回归覆盖。

正式 0.10.14：115 项 Node 回归、13 项 Windows 窗口检查已通过；单 EXE 在 PATH 不含 Node/Python 时完成内置运行环境、DPAPI 和官方只读连接自检。重新安装正式 APK 后横竖屏复测及签名兼容性清单校验已通过。EXE/APK 的版本、文件哈希、兼容清单和签名发布说明全部一致，已同步覆盖固定资源文件。证据在 work/create-images-build-014.txt、work/create-images-portable-014/data/self-test.json、work/create-images-android-014.txt、work/create-images-android-compatibility-014.txt、work/create-images-publish-014.txt。

此前主机重启打断的 EXE 为无效全零文件，未发布；已重新构建并完成上述自检和哈希校验。

安装后，本机与笔记本均已运行 0.10.14，官方连接正常，writeSupported、imageCreation.supported、interrupt.supported 均为 true，兼容清单哈希与源码一致。本机保存的两台设备仍在；桌面 RemoteCodex.exe 与正式产物哈希一致。本机实际提供的 app.js、APK 内嵌 app.js 均与修复源码逐字节一致。

另经正式日常路径实测：已安装的本机控制端 → 设备转发 → 已认证的笔记本接入端 → 现有官方 owner，新建任务 01a0850e-93e9-7820-ad8e-a4462f239481，图片轮次 01a0850e-b643-7bc1-aafd-bf2062116b49。一次提交两图，模型正确识别两图颜色和形状，回读同一任务 ID，已通过。此请求走正常版本校验和 /api/threads，未使用兼容性 Probe 的候选放行。脱敏证据：work/installed-normal-image-create.json、work/compatibility-installed-local.json、work/compatibility-installed-laptop.json。

## 复测

- node --test test/create-images.test.mjs
- node scripts/verify-create-images-ui.mjs：隔离生产界面，验证多图粘贴、纯图片创建、失败保留、旧端和未知版本拦截、相同请求重试、成功后进入同一任务。
- node scripts/verify-create-compatibility.mjs --create-probe --version=26.901.6511.0：本机固定真实场景。
- Android 隔离模拟器：构建测试 APK 后运行 adb -s emulator-5580 shell am instrument -w -e stage create-images com.anso.remotecodex.tests/.Probe。
