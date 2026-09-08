# 0.9.2 问答、图片、权限与单实例验证

验证环境：Windows 本机，官方 `OpenAI.Codex_26.901.6511.0`。测试只操作桥接器创建的专用任务。

| 功能 | 结果 | 证据与限制 |
| --- | --- | --- |
| 异步问题卡片与回答 | 已通过 | 官方 `agentMessage.delivery=async` → 选择回答 → `thread-follower-steer-turn` → 同一个所有者和 turnId；UI 展示选项、自由输入和已回答状态，不显示协议包装 JSON。 |
| 同步阻塞式问题 | 部分通过 | 接入 `thread-follower-submit-user-input`，校验当前待回答请求；通过模拟协议和过期请求拒绝测试，未触发真实同步提问。 |
| 图片正文和预览 | 已通过 | 解析官方文件包装、localImage 与内嵌图片。保留正文，显示图片预览及文件名；包含首条委托消息包装。 |
| 图片上传与原图下载 | 已通过 | 同一真实任务收到测试图并回答红色正方形、蓝色圆形、绿色三角形及 BRIDGE 7314；原文件与下载字节相同。原生生图本次未测试。 |
| 新建前权限 | 已通过 | 在输入前选择只读，通过官方专用配置任务的有效权限传递；真实任务第一轮记录确认 `permissions=:read-only`、`sandboxPolicy.type=readOnly`，审批仍为 on-request。完全访问模式本次未实测。 |
| 闪电速度开关 | 已通过 | 所有者实时流确认 `serviceTier=priority`，再确认 `default`。未在加速状态发送额外付费测试指令。首轮速度预选因官方新建接口缺字段而不可用。 |
| 不同副本重复启动 | 已通过 | 0.9.2 桌面已运行时，同时启动两个不同 EXE 副本并指定不同 `--home`；两个重复启动均以 0 退出，额外服务为 0，原窗口保持同一个 PID。冷启动竞争和跨 Windows 登录会话尚未实测。 |

本机证据保存在 `evidence/features-live.json`、`evidence/features-ui.json`、`evidence/first-permission.json` 与 UI 截图中，不上传会话数据。

最终单 EXE 再验证：内置页面显示 0.9.2；真实任务读取正常；经过 CSRF 和设备代理的图片 HTTP 入口返回与原文件完全相同的字节。见 `evidence/packaged-features.json`。34 项自动测试通过。旧的 `outputs/remote-bridge` 源码预览服务已停止，当前保留桌面的单 EXE 应用。

复测：`npm test`；设置 `REMOTE_BRIDGE_PLAYWRIGHT` 为本机 playwright-core 模块路径后运行 `node scripts/verify-features-ui.mjs`。真实复测脚本 `scripts/verify-features-live.mjs` 读取 `work/feature-probe-home.txt` 指向的专用测试数据目录；会创建专用任务并消费少量额度。

曾失败的调查：仅更新配置任务的“下一轮权限”不足以让新建任务继承权限；现改为在专用配置任务内执行无副作用确认轮，核对有效权限后再新建真实任务。较小模型的初始委托没有异步提问工具；真实问答使用支持该工具的 GPT-6 Astra low 完成。未将这两次失败当作验证通过。
