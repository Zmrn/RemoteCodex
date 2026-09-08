# Remote Codex 开发与发布约定

本项目通过 Windows 上已运行的官方 ChatGPT/Codex 会话所有者转发操作。Android 是控制端，共用 `public/` 界面；不得启动独立 Codex 后端并将其称为桌面桥接。Chat 模式已实现列表与历史读取；文字续写通过官方 app-tools 的 Chat 分支，尚待专用真实会话验证，见 `CHAT-MODE.md`。

## Chat 与 Codex 的区别

- `kind=chatgpt` 列表包含普通 Chat 与 Work，现有接口没有分类字段，界面必须说明，不能将 Work 新建当作 Chat 新建。
- Chat 不使用 Codex owner/follow、队列、模型/权限或中断接口；文字请求显式携带 `mode=chat`，目标端核对同一个真实 Chat ID，再经官方 `send_message_to_thread` 转发。
- 普通 Chat 新建、模型目录/切换、图片暂无已验证的入口，不能补造模型目录或回退到 Codex/独立 API。旧设备未上报 Chat 能力时只读。
- Chat 状态来自官方 renderer 定时查询，历史可能经过官方缓存；历史 `completed` 是适配器合成的记录标记，不是实时完成证据。断线、读取失败显示未知。
- 模式切换必须隔离列表、草稿、导航与异步读取，保持真实会话 ID；Windows 和 Android 共用此行为。

## 操作边界

- 不改写官方历史数据库、安装文件、凭据或网络配置；不重启官方应用。
- 不向承载开发工作的任务发送测试消息或中断。写入验证只使用明确命名的专用测试任务。
- 会话状态注明来源；断线或证据不足显示未知，不把磁盘记录当实时状态。
- 本机控制端仅绑定回环地址。电脑远程接入只使用用户已配置的 Tailscale 地址与密钥。
- 手机访问密钥使用 Android Keystore；Windows 密钥使用 DPAPI。日志、报告、APK、EXE、Git 均不得包含用户密钥或私人消息。
- 物理手机必须确认目标后才能安装测试；默认使用项目 `work/` 下的隔离模拟器，不修改用户现有 AVD。

## 同步发布（每次更新必须遵守）

1. `package.json` 是唯一正式版本来源。APK versionCode 为 `major*1000000 + minor*1000 + patch`；minor、patch 必须小于 1000。
2. **每次正式更新同时构建、验证并发布 Android APK 和 Windows EXE，不允许只更新其中一端。** 运行 `python scripts/build-release.py --publish`；该脚本先构建双端，再发布。
3. 固定文件名为 `RemoteCodex.exe`、`RemoteCodex.apk`，版本显示在程序左下角；不要在文件名中加版本。
4. 实际远端 SSH 地址、目标目录和更新资源 URL 统一配置在 **被 Git 忽略的 `release.local.json`**。从 `release.example.json` 复制；禁止在发布脚本中硬编码真实地址。构建产物只注入公共资源 URL，不注入 SSH 设置或签名私钥。
5. 发布到该配置的 `remoteDirectory`，同时覆盖两个程序及 `latest.json`、`android-latest.json`。远端只保留各平台一份正式资源。发布器必须验证双端版本、大小、哈希与签名；上传完成并校验后才替换正式资源。
6. 保留 `data/release-signing-key.json`、`data/android-signing.p12`、`data/android-signing-password.json`。不得重新生成已有身份。它们被忽略，密码绑定当前 Windows 用户；迁移构建机需安全迁移签名身份，不能提交 Git。
7. Android 自动检查和下载更新，系统仍要求确认安装；不得宣称普通 APK 能静默安装。验证清单 RSA 签名、SHA-256、包名、版本和 APK 安装证书。
8. 发布前运行 Node 回归与 Android 构建验证；Android 行为改动在隔离模拟器验证。记录具体通过项和未测试项，不把模拟器结果称作真机验证。
9. 更新 `ANDROID.md` 或相关复测说明。交付 APK/EXE 链接并提交推送源码、文档（包括本文件）。不提交 `dist/`、`work/`、`data/`、本机配置或原始私人证据。
