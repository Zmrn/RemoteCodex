# Remote Codex 开发与发布约定

本项目通过 Windows 上已运行的官方 ChatGPT/Codex 会话所有者转发操作。Android 是控制端，共用 `public/` 界面；不得启动独立 Codex 后端并将其称为桌面桥接。Chat 模式已实现列表与历史读取；文字续写通过官方 app-tools 的 Chat 分支，尚待专用真实会话验证，见 `CHAT-MODE.md`。

## Chat 与 Codex 的区别

- `kind=chatgpt` 列表包含普通 Chat 与 Work，现有接口没有分类字段，界面必须说明，不能将 Work 新建当作 Chat 新建。
- Chat 不使用 Codex owner/follow、队列、模型/权限或中断接口；文字请求显式携带 `mode=chat`，目标端核对同一个真实 Chat ID，再经官方 `send_message_to_thread` 转发。
- 普通 Chat 新建、模型目录/切换、图片暂无已验证的入口，不能补造模型目录或回退到 Codex/独立 API。旧设备未上报 Chat 能力时只读。
- Chat 状态来自官方 renderer 定时查询，历史可能经过官方缓存；历史 `completed` 是适配器合成的记录标记，不是实时完成证据。断线、读取失败显示未知。
- 模式切换必须隔离列表、草稿、导航与异步读取，保持真实会话 ID；Windows 和 Android 共用此行为。

## 操作边界

- Codex 新建项目由当前目标设备的官方 `list_projects` 读取；用户在输入框上方选择项目和“本地”后，以真实 `projectId` 和 `environment.type=local` 传给官方 `create_thread`。本轮没有实现工作树或分支切换，不得用显示文字冒充已切换。
- 不接收自填工作路径，也不把不存在、其他主机或 Chat 项目退化为无项目任务；旧设备没有 `projectCreation.local` 能力时阻止项目创建。新建选择按设备保存，Chat 不复用 Codex 的项目选择。
- 官方列表可能暂缺新任务。创建回执保存的项目归属只能作为桥接器创建记录补入侧栏，运行状态仍需官方实时读取；不能把创建记录当运行状态。复测见 `PROJECT-CREATION.md`。

- 不改写官方历史数据库、安装文件、凭据或网络配置；不重启官方应用。
- 不向承载开发工作的任务发送测试消息或中断。写入验证只使用明确命名的专用测试任务。
- 上一条限制针对自动测试，不得将用户界面里的停止功能限制为 Probe 会话。已支持版本的 Codex 会话由用户主动停止时，必须核对官方实时 activeTurnId、expectedTurnId 和相同 owner 回执；回执不等于已中断，以实时状态为准，断线不自动重发。Chat 未验证中断入口，不得套用 Codex 方法。复测见 INTERRUPT.md。
- 队列首屏与历史读取并行；新客户端请求 images=multi-v1&previews=refs-v1，只在元数据中携带图片引用，不能把 Base64 原图重新塞进队列列表。预览独立加载，切设备/任务取消读取并释放图片 URL；取回与恢复编辑必须保留全部原图和持久化恢复记录。旧端兼容及复测见 QUEUE-PREVIEW.md。
- 会话状态注明来源；断线或证据不足显示未知，不把磁盘记录当实时状态。
- 额度按目标设备官方返回的 `windowDurationMins` 区分 300 分钟与 10080 分钟，左下角仅显示普通 `codex` 额度：存在 5h 窗口时优先，否则显示周额度。Spark 等独立额度只进详情，不能替代主显示；Plus/Pro 名称不能用来补造或隐藏真实窗口。保留旧 `weekly` 字段兼容，缺失/断线显示未知，见 `USAGE.md`。
- 本机控制端仅绑定回环地址。电脑远程接入只使用用户已配置的 Tailscale 地址与密钥。
- 带图新建须完整转交文字和全部图片，不能只传文字并丢图。当前官方 create_thread 只有文字入口，桥接器在同一官方任务完成准备轮后发送原生图片；请求去重和失败草稿保留不得破坏，见 CREATE-IMAGES.md。固定兼容性 Probe 接口仅可测试清单候选版本和其自身新建任务，不得扩展为任意任务/代码的版本校验绕过接口。
- 手机访问密钥使用 Android Keystore；Windows 密钥使用 DPAPI。日志、报告、APK、EXE、Git 均不得包含用户密钥或私人消息。
- Windows 设备配置以数据目录中的有效持久化副本为准，不得用启动时的旧内存列表整份覆盖；读取失败不能当作首次启动。修改设备存储须验证旧实例覆盖、保存中断、备份恢复、显式删除和密钥不泄露，见 `DEVICE-STORAGE.md`。
- 物理手机必须确认目标后才能安装测试；默认使用项目 `work/` 下的隔离模拟器，不修改用户现有 AVD。

## 同步发布（每次更新必须遵守）

- **每次发布必须在发布说明和最终交付中明确列出支持的官方 ChatGPT/Codex 桌面包版本、平台、Codex/Chat/Work 支持范围及未验证项。不能只写 Remote Codex 自身版本，也不能把“可以连接/读历史”当作新版完整兼容。**
- 官方接口和已验证版本统一在 src/official-desktop.json 管理；运行代码使用 src/official-protocol.mjs，不得重新散落硬编码版本、IPC 方法及版本号。升级处理遵循 COMPATIBILITY.md；接口字段/适配位置和回归入口见自动生成的 COMPATIBILITY-INTERFACES.md。
- 新官方版本必须先取得实际验证证据，再更新清单中的 verifiedVersions 和 validation；不得仅扩大版本范围、删除校验或自动放行。更新清单后执行 node scripts/compatibility-report.mjs --write 和 npm run compatibility。
- 双端构建报告、签名更新清单及 release-notes.md 必须来自同一份兼容性清单。发布器必须拒绝缺失/过期元数据和混用旧产物；发布时同时覆盖固定 release-notes.md，其哈希受更新签名保护。

1. `package.json` 是唯一正式版本来源。APK versionCode 为 `major*1000000 + minor*1000 + patch`；minor、patch 必须小于 1000。
2. **每次正式更新同时构建、验证并发布 Android APK 和 Windows EXE，不允许只更新其中一端。** 运行 `python scripts/build-release.py --publish`；该脚本先构建双端，再发布。
3. 固定文件名为 `RemoteCodex.exe`、`RemoteCodex.apk`，版本显示在程序左下角；不要在文件名中加版本。
4. 实际远端 SSH 地址、目标目录和更新资源 URL 统一配置在 **被 Git 忽略的 `release.local.json`**。从 `release.example.json` 复制；禁止在发布脚本中硬编码真实地址。构建产物只注入公共资源 URL，不注入 SSH 设置或签名私钥。
5. 发布到该配置的 `remoteDirectory`，同时覆盖两个程序及 `latest.json`、`android-latest.json`。远端只保留各平台一份正式资源。发布器必须验证双端版本、大小、哈希与签名；上传完成并校验后才替换正式资源。
6. 保留 `data/release-signing-key.json`、`data/android-signing.p12`、`data/android-signing-password.json`。不得重新生成已有身份。它们被忽略，密码绑定当前 Windows 用户；迁移构建机需安全迁移签名身份，不能提交 Git。
7. Android 自动检查和下载更新，系统仍要求确认安装；不得宣称普通 APK 能静默安装。验证清单 RSA 签名、SHA-256、包名、版本和 APK 安装证书。
8. 发布前运行 Node 回归与 Android 构建验证；Android 行为改动在隔离模拟器验证。记录具体通过项和未测试项，不把模拟器结果称作真机验证。
9. 更新 `ANDROID.md` 或相关复测说明。交付 APK/EXE 链接并提交推送源码、文档（包括本文件）。不提交 `dist/`、`work/`、`data/`、本机配置或原始私人证据。
