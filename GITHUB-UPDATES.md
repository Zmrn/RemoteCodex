# GitHub 直接更新

## 2026-09-19：0.10.43 官方设置 v2 与权限恢复已正式发布

[正式版本](https://github.com/Zmrn/RemoteCodex/releases/tag/v0.10.43)。0.10.43从342108ba5a38966498815f54adc4456385bafc16经同SHA Checks35452191067和preflight成功后，由Build35452496774同次生成APK/EXE并正式发布Releases/v0.10.43，包含settings v1/v2按当前连接适配、v2应用回执校验和权限预选本地重置。仅派发一次、云构建首次成功。330 Node22.19.0、权限双尺寸6组/原设置/兼容/离线草稿及设备保护通过；官方Windows x64 26.915.4065.0两个新专用Probe完成工作区权限新建、运行中下一轮模型/推理/权限、后续轮次采用、空闲权限及默认速度读回5组，未操作既有用户任务。原RSA/APK v2-v3证书、双端源码/页面/清单/渠道、EXE隔离运行时/DPAPI/SQLite、0.10.42→0.10.43设备保存/强制重启/删除及匿名完整下载通过。包内官方26.915.4065.0只读连接/列表、settings v2与21/21接口/24/24功能依赖及额度重启读取通过。未执行APK/模拟器、升级现有客户端、重启官方或全功能写入实测；Chat/Work未完成内容未纳入。详情见SETTINGS-V2.md和GITHUB-UPDATES.md。

requestId `c3d7b27a-a1f1-4b62-9b70-dc596734a03f`，构建仅派发一次。首次云构建成功。设置接口仍支持旧 v1，未知新协议不盲试、不失败回退。v2同owner返回applied=true后才接受，读取官方流显示实际设置；未确认不继续发送消息、不重放。权限菜单可离线取消本地权限预选，保留文字、图片、模型和推理选择；新建使用官方默认，已有任务保持官方权限。须同时更新目标Windows接入端及控制端，无需重新配对。

| 产物 | 字节数 | SHA-256 |
| --- | ---: | --- |
| RemoteCodex.exe | 44189696 | `35c47ee1de60489d50e14f2718898ff237cc4b674b0c93f86753d2b444f89053` |
| RemoteCodex.apk | 291056 | `0cd29eb79ffc3c71008cab1fc7529070a1375b2357027b397c1c92b868c6db61` |

原RSA更新签名、APK v2/v3证书、com.anso.remotecodex/versionCode10043、双端源码/页面/支持说明/渠道一致，无用户配置或私钥。证书SHA256 `3c0a98ec3c9f37318525f5d0e4afb3417812215d625e48a9013b5ee649acb2b1`；中央清单 `a3d0fc7a1b2a64b92477bc7ae13888ae2d79d9dbbb92c9618844a5c0d75fa200`。

实际云EXE隔离home、仅System32 PATH自检内嵌Node/Python/DPAPI；包内官方Windows x64 **26.915.4065.0**只读读取32项列表，21/21接口及24/24功能依赖满足，settings采用v2。包内真实额度入SQLite、新进程及官方断开后1/7/30天读回通过。0.10.42→0.10.43设备保存、强制重启、删除通过；现有6项设备/接入/更新/通知配置及通知草稿字节保持。

当前官方版本仅上述设置/创建/续写链路有本轮专用任务实测；其他接口匹配不等于全部行为验证，不扩大历史verifiedVersions。Chat普通新建/图片、未完成Work未纳入。未运行APK/模拟器、升级现有客户端或重启官方；未改写既有用户任务。原8份未完成Chat独立保留。

标准发布器八项资源草稿上传、逐项读回后公开；匿名latest双签名清单、固定版本完整双包和说明一致。证据在会话work/settings-v2/work/；发布记录提交不再次构建，产物固定于上述SHA。

## 0.10.42 正式发布（2026-09-18）

[GitHub Release v0.10.42](https://github.com/Zmrn/RemoteCodex/releases/tag/v0.10.42) 已公开。Windows解压逐文件请求落盘，完整校验后同卷发布并复核；缓存缺失、截断或哈希不符时，从同一EXE内置资源重建到独立目录，保留原缓存和data。启动、自检、更新预检共用跨进程锁，孤立临时目录永不执行，文件占用/权限问题不当损坏。Windows接入端和控制端均可更新获得保护；Android同次发布保持版本一致。无需重新配对。

最终版本323项Node22.19.0、兼容清单、缓存生产C#测试DLL15组和更新界面8组通过。[Checks 35340743746](https://github.com/Zmrn/RemoteCodex/actions/runs/35340743746)与构建SHA `9f8169e87c17640cd98c8f28ebd436bf1ce98523`一致，preflight后仅派发一次[Build 35341106342](https://github.com/Zmrn/RemoteCodex/actions/runs/35341106342)，requestId `82828793-cfdd-408c-946d-a589f5ca4f7f`，签名前门禁和云构建首次成功。没有本地构建。

| 产物 | 字节数 | SHA-256 |
| --- | ---: | --- |
| RemoteCodex.exe | 44188672 | `b68f783560f90f337b316dadf8aa8d8b5865f02a69354098901f608ecd965f44` |
| RemoteCodex.apk | 291056 | `f498734b8a4ad638f7825ec6226814a2b560ba0b62d9065bcc290fff4f2aff7a` |

双端原RSA更新签名、APK v2/v3原证书、包名com.anso.remotecodex/versionCode10042、包内源码/共享页面/说明/渠道/兼容清单一致，无用户配置或私钥。APK证书SHA256 `3c0a98ec3c9f37318525f5d0e4afb3417812215d625e48a9013b5ee649acb2b1`；中央清单SHA256 `7df1101ddd4a3b422e6026a42fe1aeee318d846234283e234bc5e8f7d75cd392`。

正式云EXE在独立home通过5组实际进程验收：首次解压及重复启动；两个文件全零后4进程并发恢复且只产生一份恢复目录；恢复缓存再次损坏后重建；文件缺失恢复；解压中途强杀自己启动的EXE后重新完整恢复。每次按同包全部155个文件哈希比对，旧缓存、合成设备和草稿哨兵原字节保持。没有人为断电，不声称物理存储绝对可靠。原目录和中断临时目录保留。

EXE在隔离home及仅System32 PATH下通过内嵌运行时/DPAPI/资源自检。包内源码连接当前官方Windows x64 **26.911.7940.0**，只读列表25项，20/21接口匹配、22/24功能条件满足。未满足：settings, createPermissions。接口匹配不等于全部写操作实测，不扩大既有行为验证版本26.901.6511.0/26.903.8094.0。

包内Node22.19.0的SQLite、真实官方额度保存、新进程及官方断开后的服务重启1/7/30天读回通过。隔离0.10.41云包→0.10.42云包设备保存、强制重启和显式删除通过；现有设备、接入、更新、通知配置与通知草稿字节保持。八项资源草稿上传、逐项读回核验后公开，匿名latest双签名清单、固定版本完整双包和说明一致。

settings v2仍待适配，修改会话设置和新建指定权限暂不可用。Chat只包含已完成范围，普通Chat新建/图片及未完成Work不在包中；原8份未完成Chat独立保全。未运行APK/模拟器、升级现有客户端、重启官方或写真实任务。EXE自身损坏仍需重新下载。

证据：会话work/release-042/work/，包括all-tests-node22.log、cache-test.log、checks-watch.log、preflight.json、build-dispatch.log、build-watch.log、package-verification.json、packaged-cache.json、packaged-official.json、packaged-usage.json、agent-restart.log、installed-data-after.json、publish.log和online-verification.json。发布记录不再触发构建，产物仍对应上述SHA。

## 0.10.41 正式发布（2026-09-18）

[GitHub Release v0.10.41](https://github.com/Zmrn/RemoteCodex/releases/tag/v0.10.41) 已公开。修复官方Markdown `/C:/...` 图片及文件链接在Windows被解析为重复盘符而立即失败的问题。会话附件图片显示实际下载百分比、已接收量/总大小和具体错误；没有总量时不伪造百分比，Android转发保留未编码响应长度。刷新保留正在下载的请求和已加载图片，失败后显式重试。目标Windows接入端与使用中的Windows/Android控制端需同时更新。

最终版本323项Node22.19.0、接口清单、双尺寸进度6组/原稳定6组/GIF2组、Chat与按功能兼容UI通过。源码`198d2f4a9209e19fa6789f306a24940b5b3647e4`的[Checks 35314888628](https://github.com/Zmrn/RemoteCodex/actions/runs/35314888628)成功后preflight放行，[Build 35315332244](https://github.com/Zmrn/RemoteCodex/actions/runs/35315332244)仅派发一次，requestId `f3d12d88-7c3b-442e-9c41-435d197a8e1e`。云端签名前门禁与构建首次成功，没有本地构建。

| 产物 | 字节数 | SHA-256 |
| --- | ---: | --- |
| RemoteCodex.exe | 44184576 | `c5f540fe8759869da4e43d58676d89edd04a1ae44e145b781327441a28195405` |
| RemoteCodex.apk | 291056 | `a632e5e6c015d8b3258ef2c0cf0ecc89636334927e2b25b3ad0c31a19b071ec7` |

双端原RSA更新签名、APK v2/v3原证书、包名com.anso.remotecodex/versionCode10041、包内源码/共享页面/说明/GitHub渠道一致；无用户配置或私钥。APK证书SHA256 `3c0a98ec3c9f37318525f5d0e4afb3417812215d625e48a9013b5ee649acb2b1`；中央清单SHA256 `7df1101ddd4a3b422e6026a42fe1aeee318d846234283e234bc5e8f7d75cd392`。未执行APK或模拟器。

EXE隔离home和仅System32的PATH下，包内运行时/DPAPI/资源自检通过。同次包内源码对当前官方Windows x64 **26.908.9136.0** 只读连接及列表读取通过，共24项；20/21接口匹配，22/24功能条件满足。未满足功能：settings, createPermissions。不将接口匹配视为写操作往返实测，不扩大既有行为验证版本26.901.6511.0/26.903.8094.0。

同次包内源码对用户问题任务获取当前官方owner只读快照，再读取原图：HTTP200、image/jpeg、335737字节，SHA256 `6fc56dc52245df58339f092939c4cbf424fb973308a2735b7fb5c4e5b2d171c7`与原文件一致，浏览器解码1322×1368。私人图片和消息未上传至仓库；任务/已读写入0。共享进度用真实分块HTTP隔离回归验证，未宣称Android真机行为实测。

包内Node22.19.0的SQLite可用，真实官方额度保存后，新进程及官方断开后的重启服务均能完整读回1/7/30天记录。隔离0.10.40云包→0.10.41云包的设备保存、强制重启和显式删除通过；现有设备、接入、更新、通知设置及通知草稿字节保持。八项资源先上传草稿、逐项读回后公开；匿名latest双签名清单、固定版本完整APK/EXE及说明下载一致。

第三方HTTPS图片仍由浏览器直接读取，不新增带凭据代理，数值进度仅用于可读取响应字节的附件图片。settings v2仍待适配，修改会话设置和新建指定权限暂不可用。Chat只含已完成范围，普通Chat新建/图片及未完成Work适配未纳入；原8份未完成Chat独立保全。未安装升级现有客户端、重启官方或执行真实任务写入。

证据在会话work/release-041/work/，关键文件：all-tests-node22.log、checks-watch.log、preflight.json、build-dispatch.log、build-watch.log、package-verification.json、packaged-official.json、packaged-image.json、packaged-usage.json、agent-restart.log、installed-data-after.json、publish.log、online-verification.json。发布记录提交不再触发构建，产物仍对应上述构建SHA。

## 0.10.40 正式发布（2026-09-18）

[GitHub Release v0.10.40](https://github.com/Zmrn/RemoteCodex/releases/tag/v0.10.40) 已公开。额度旁新增历史入口，按目标设备查看1/7/30天及已有记录的额度窗口；目标Windows服务每5分钟保存官方实际采样，仅保留365天，控制端按需拉取。逐条AI回复优先使用官方逐条“开始接收”时间，缺失则保留官方“记录于”或显示未知。目标Windows接入端与使用中的Windows/Android控制端需一同更新；历史从更新运行后开始积累，不补造旧数据。

最终版本319项Node22.19.0、接口清单、双尺寸额度历史8组/逐条时间8组、Chat与按功能兼容UI通过。源码`c6e00883ede61a71abb051f46d4329d0d0cd0236`的[Checks 35242523620](https://github.com/Zmrn/RemoteCodex/actions/runs/35242523620)成功后preflight放行，[Build 35243098074](https://github.com/Zmrn/RemoteCodex/actions/runs/35243098074)使用requestId `6bc997b2-3162-4ddc-a429-6a51d02817e3`。仅派发一次，云端签名前门禁及构建首次成功；只使用这次云产物，没有本地构建。

| 产物 | 字节数 | SHA-256 |
| --- | ---: | --- |
| RemoteCodex.exe | 44181504 | `97f7f092b5e03872a908a203f7d531a8796e4bef951a1a34b4f7c7ee14cced8a` |
| RemoteCodex.apk | 286885 | `2587bbdb2dd1f6c7527d4d77241816d1c0b9030b992d2dba1caa92a0bab279b5` |

双端原RSA更新签名、APK v2/v3原证书、包名com.anso.remotecodex/versionCode10040、包内源码/共享页面/说明/GitHub渠道一致；无用户配置或私钥。APK证书SHA-256为`3c0a98ec3c9f37318525f5d0e4afb3417812215d625e48a9013b5ee649acb2b1`，中央清单SHA-256为`7df1101ddd4a3b422e6026a42fe1aeee318d846234283e234bc5e8f7d75cd392`，按构建提交及包内字节核对。未执行APK或模拟器。

EXE隔离home、PATH仅System32下的内嵌运行时、DPAPI与资源自检通过；同次包内源码对当前官方Windows x64 **26.908.9136.0** 只读连接及列表读取通过，共24项。20/21接口匹配，22/24功能条件满足；未满足功能：settings, createPermissions。接口匹配不代表真实写入往返验证，不扩大历史行为版本名单26.901.6511.0/26.903.8094.0。

包内Node 22.19.0 的SQLite实际可用，独立目标服务读取官方额度并持久保存，与官方实际采样原值一致；重启服务并令官方连接离线后，1/7/30天读取均保留原记录。未把实际额度值上传或写入此文档。开发阶段已验证一年清理、强杀未提交事务恢复、多实例、损坏及未来schema保留，见USAGE.md；本轮包内读取验证分别记于packaged-usage.json。

隔离0.10.39云包→0.10.40云包的设备保存、强制重启与显式删除通过；现有客户端设备、接入、更新、通知设置及通知草稿字节保持。标准发布器八项资源先上传草稿并逐项读回再公开；匿名latest双签名清单、固定版本完整APK/EXE及说明均核验一致。没有升级现有客户端、重启官方软件或写真实任务/已读状态。

官方settings v2仍待适配，修改会话设置、新建指定权限暂不可用。Chat只含已完成范围，普通Chat新建/图片和未完成Work适配未纳入；8份未完成Chat修改独立保全。未执行Android真机行为测试，由用户更新后验证。

证据在会话work/release-040/work/：all-tests-node22.log、checks-watch.log、preflight.json、build-dispatch.log、build-watch.log、package-verification.json、packaged-official.json、packaged-usage.json、agent-restart.log、installed-data-after.json、publish.log、release-state.json、online-verification.json。发布记录提交不再次构建，已发布产物仍对应构建SHA。

## 0.10.39 正式发布（2026-09-16）

[GitHub Release v0.10.39](https://github.com/Zmrn/RemoteCodex/releases/tag/v0.10.39) 已公开。已有Codex/Chat会话在离线、历史未读入或刷新失败时继续编辑和保存本地草稿；Codex图片支持离线添加、粘贴和移除，只添加图片也会触发备份。重连不覆盖新输入，不自动补发。更新使用中的Windows/Android控制端后生效。

最终版本302项Node22.19.0、接口清单、共享离线UI12组、Chat与功能独立兼容UI通过；源码`7811a4be94c17e27c1c613b3db55578b1b0b74ef`的[Checks 35093965107](https://github.com/Zmrn/RemoteCodex/actions/runs/35093965107)成功后preflight放行，[Build 35094374884](https://github.com/Zmrn/RemoteCodex/actions/runs/35094374884)仅派发一次，requestId为`26da6d8f-a482-4c2b-8c56-1bde0fde734f`。云端签名前门禁及构建首次成功，没有本地构建。

| 产物 | 字节数 | SHA-256 |
| --- | ---: | --- |
| RemoteCodex.exe | 44172288 | `245df69f76bc7c87e651be2e960c17e2b35894e9c86162967e26940c678b9876` |
| RemoteCodex.apk | 282710 | `c4672c31d65a82eba1d1963ba1b40a1941087990b26132b88989e78e217bf6db` |

双端原RSA更新签名、APK v2/v3原证书、包名com.anso.remotecodex/versionCode10039、包内源码/共享页面/发布说明/GitHub渠道一致；包内无用户配置或私钥。APK证书SHA-256为`3c0a98ec3c9f37318525f5d0e4afb3417812215d625e48a9013b5ee649acb2b1`，中央清单SHA-256为`7df1101ddd4a3b422e6026a42fe1aeee318d846234283e234bc5e8f7d75cd392`，按构建提交及包内字节核对。未执行APK或模拟器。

EXE隔离home、PATH仅System32下的内嵌运行时、DPAPI与资源自检通过；同次包内源码对当前官方Windows x64 **26.908.9136.0** 只读连接与列表读取通过，返回22项。20/21接口匹配，22/24功能条件满足；未满足功能：settings, createPermissions。接口匹配不代表真实写入往返验证，不扩大历史行为版本名单。

本地编辑不授权发送或更改官方状态。受保护任务Ctrl+Enter仍受限，队列和调整方向按各自能力判断；官方notLoaded任务的图片只能留草稿，文字续接沿用原流程。初始恢复/正在提交的防覆盖保护保持。Chat新建/图片和未完成Work适配不在本版中，未完成Chat工作独立保全。

隔离0.10.38云包→0.10.39云包的设备保存、强制重启与显式删除通过；现有客户端设备、接入、更新、通知设置及通知草稿字节保持。标准发布器八项资源先上传草稿并逐项读回再公开；匿名latest双签名清单、固定版本完整APK/EXE及说明均核验一致。没有升级现有客户端、重启官方软件、重新测试RDP断开或写真实任务/已读状态。

证据在会话`work/release-039/work/`：all-tests-node22.log、checks-watch.log、preflight.json、build-dispatch.log、build-watch.log、package-verification.json、packaged-official.json、agent-restart.log、installed-data-after.json、publish.log、release-state.json、online-verification.json。发布记录提交不再次构建，已发布产物仍对应构建SHA；不修改已验签资源中的GITHUB-BUILD.json。

## 0.10.38 正式发布（2026-09-16）

[GitHub Release v0.10.38](https://github.com/Zmrn/RemoteCodex/releases/tag/v0.10.38) 已公开。包含GIF87a/GIF89a原动画接收、消息/放大预览、原文件名下载，GIF接收和二进制原图保存上限64MiB，其他图片25MiB与发送限制保持；Windows页面可读取自身Blob以保留独立预览引用。请同时更新目标Windows接入端与Windows/Android控制端。

最终版本302项Node22.19.0、接口清单、GIF UI双尺寸与图片稳定UI6组通过；源码`1a21668f4e16114ebfda076e74d55fcf9b267b21`的[Checks 35088701633](https://github.com/Zmrn/RemoteCodex/actions/runs/35088701633)成功后preflight放行，[Build 35089145952](https://github.com/Zmrn/RemoteCodex/actions/runs/35089145952)仅派发一次，requestId为`cd7bc990-edb4-4802-b2bc-a5b85defe898`。云端签名前门禁和构建首次成功，无本地构建。

| 产物 | 字节数 | SHA-256 |
| --- | ---: | --- |
| RemoteCodex.exe | 44172288 | `011cc7e15f890d4e1bd419ac62e2f3e034da2e2547206f08c8459e9264a8dc4d` |
| RemoteCodex.apk | 282710 | `b9ff7bc6439ac649f0a3f0d5b28371649d391f7fb09b9d56a7e110aab234e714` |

双端原RSA更新签名、APK v2/v3原证书、包名com.anso.remotecodex/versionCode10038、包内源码/共享页面/发布说明/GitHub渠道一致；包内无用户配置或私钥。APK证书SHA-256为`3c0a98ec3c9f37318525f5d0e4afb3417812215d625e48a9013b5ee649acb2b1`，中央清单SHA-256为`7df1101ddd4a3b422e6026a42fe1aeee318d846234283e234bc5e8f7d75cd392`，按构建提交及包内原字节核对。APK内ReceivedImage类及GIF MIME已核对，未执行APK或模拟器。

EXE隔离home、PATH仅System32下的内嵌运行时、DPAPI与资源自检通过。包内源码对当前官方Windows x64 **26.908.9136.0** 只读连接，列表读取22项，20/21接口匹配，22/24功能条件满足。未满足功能：settings, createPermissions。settings v2仍待适配；接口匹配不等于真实写入往返验证，不扩大历史行为版本名单。

包内代码经当前官方工具读取和owner合并后，目标GIF对应1张可读取图片（当前回复另有其他图片），原图28560590字节、SHA256 `af18bf2016e9e8978dfd86857c2663bcf9c8371ad62653a6f87ac63453d6fdfa`与媒体读取一致；没有发送消息、清除已读或修改任务。私人图片/正文未上传仓库，CI使用合成动画。未重新进行RDP断开试验。

隔离0.10.37云包→0.10.38云包的设备保存、强制重启与显式删除通过；现有客户端设备、接入、更新、通知设置与通知草稿字节保持。标准发布器八项资源先上传草稿并逐项读回再公开；匿名latest双签名清单、固定版本完整APK/EXE和说明均核验一致。没有升级现有客户端、重启官方软件或使用旧服务器。

Chat列表与文字历史保持，续写待专用真实验证；普通Chat新建、模型、生成图片与Work的未完成适配未纳入。原8份Chat工作独立保全。

证据在会话`work/release-038/work/`：all-tests-node22.log、checks-watch.log、preflight.json、build-dispatch.log、build-watch.log、package-verification.json、packaged-official.json、official-gif-packaged.json、agent-restart.log、installed-data-after.json、publish.log、release-state.json、online-verification.json。发布记录提交不再次构建，已发布产物仍对应构建SHA；不修改已验签资源的云端GITHUB-BUILD.json。

## 0.10.37 正式发布（2026-09-15）

[GitHub Release v0.10.37](https://github.com/Zmrn/RemoteCodex/releases/tag/v0.10.37) 已公开，包含图片内双指缩放/拖动、官方总列表超时后的部分读取、草稿保留及实际列表诊断。请同时更新目标Windows接入端和Windows/Android控制端；未完成Chat改动未纳入。

最终版本298项Node22.19.0、图片手势4组、列表UI11组、诊断UI9组及接口清单通过。源码`56f22d19900f4dddd9a08f54fbe3aba367518a41`的[Checks34926631879](https://github.com/Zmrn/RemoteCodex/actions/runs/34926631879)全部成功后preflight放行，[Build34926865877](https://github.com/Zmrn/RemoteCodex/actions/runs/34926865877)仅派发一次，requestId为`5ef41f65-bf46-4560-8903-5ad09d767eb6`。同SHA云端签名前门禁及构建首次成功，没有本地构建或重复派发。

| 产物 | 字节数 | SHA-256 |
| --- | ---: | --- |
| RemoteCodex.exe | 44171776 | `06d2fe7708e0210b60f5a8b699ecbb9b934419e536e757fab7d857133845e4ee` |
| RemoteCodex.apk | 282710 | `f26eb799ed7d1d113fe93358a9bae9e9be9a2c0f18ca4e63982cfcf0252ad623` |

双端原RSA更新签名、APK v2/v3及原证书、包名com.anso.remotecodex/versionCode10037、包内源码/共享UI/发布说明/兼容清单和GitHub更新渠道均核验一致。APK证书SHA-256为`3c0a98ec3c9f37318525f5d0e4afb3417812215d625e48a9013b5ee649acb2b1`；中央清单SHA-256为`7df1101ddd4a3b422e6026a42fe1aeee318d846234283e234bc5e8f7d75cd392`，与构建提交及包内字节一致。包内没有用户配置或签名私钥。

EXE在隔离home、PATH仅System32下的内嵌Node/Python、DPAPI、资源与官方只读项目/列表自检通过。包内实际连接官方Windows x64 **26.908.4834.0 / PID9088**；21项接口20项匹配、24项功能条件22项满足。官方settings v2仍未适配，**修改会话设置、新建时指定权限暂不可用**；其他功能独立判断。本次只读列表22项、补齐5项，约343ms返回；不是实际发送或审批往返验证，也未在最终包上重新断开公司电脑RDP实测。

官方总列表异常时只从核对过的官方本机索引读取可确认Codex任务，不保存另一份目录、推断蓝点/运行状态或授权写入。Chat完整列表、实时状态和发送仍依赖对应官方接口，不修补官方后台调度。Chat文字续写待专用真实验证，普通Chat新建/模型/生成图片与Work未完成适配未纳入。

隔离0.10.36云包→0.10.37云包的设备保存、强制重启、显式删除通过；现有设备、接入、更新、通知设置及通知草稿字节保持。标准发布器八项资源先上传草稿并逐项读回再公开；随后匿名使用生产更新函数读取latest双签名清单，按固定v0.10.37完整下载APK/EXE与发布说明，全部核验一致。没有执行APK/模拟器、升级现有客户端、重启官方应用或写真实任务。

证据在会话`work/release-037/work/`：all-tests-node22.log、checks-watch.log、preflight.json、build-dispatch.log、build-watch.log、build-jobs.json、package-verification.json、packaged-official.json、agent-restart.log、installed-data-after.json、publish.log、release-state.json、online-verification.json。发布记录提交不再次构建，资源仍对应构建SHA；GITHUB-BUILD.json的published/liveDesktopTested保留云端产出时的值，不改写已验签资源。

## 0.10.36 正式发布（2026-09-14）

[GitHub Release v0.10.36](https://github.com/Zmrn/RemoteCodex/releases/tag/v0.10.36) 已公开，包含官方自建任务漏列、创建任务卡片和长历史已读同步修复。请同时更新Windows接入端及Windows/Android控制端；未完成Chat改动未纳入。

最终版本290项Node22.19.0、新共享UI3组、原已读UI7组与兼容清单通过，源码`067079f167dea3e4d74447831bc040ba90a23437`的[Checks34832593399](https://github.com/Zmrn/RemoteCodex/actions/runs/34832593399)成功后preflight放行。[Build34832989160](https://github.com/Zmrn/RemoteCodex/actions/runs/34832989160)仅实际派发一次，requestId为`f628bfdc-5c2a-4f23-9271-daba2f331661`。首次入口联网检查报fetch failed，发生在输出requestId和派发前；只读status确认没有新Build，再preflight恢复。云端签名前门禁及构建首次成功，没有重复构建或本地重建。

| 产物 | 字节数 | SHA-256 |
| --- | ---: | --- |
| RemoteCodex.exe | 44167168 | `c6db6ad70c436a02f7ea56065986aeae40049ee06b780813806513f46e647f83` |
| RemoteCodex.apk | 278539 | `fdec467324e55614f5f1560c1e3c43b4d1a7b161baf77812ea24c178809bb14e` |

双端原RSA更新签名、APK v2/v3与原证书、包名com.anso.remotecodex/versionCode10036、源码/共享页面/兼容清单/发布说明/GitHub更新渠道均核验一致。APK证书SHA-256为`3c0a98ec3c9f37318525f5d0e4afb3417812215d625e48a9013b5ee649acb2b1`；中央清单SHA-256为`7df1101ddd4a3b422e6026a42fe1aeee318d846234283e234bc5e8f7d75cd392`，按构建提交及包内实际字节核对。包内无用户配置或私钥。

EXE隔离home、PATH仅System32下的内嵌运行时、DPAPI、资源及官方项目/任务只读自检通过。当前官方为Windows x64 **26.908.4834.0 / PID9088**：20/21接口匹配，22/24功能条件满足；官方`thread-follower-update-thread-settings`已从v1升至v2，因此**修改会话设置、新建时指定权限暂不可用**。该接口待后续适配，其余功能按自身依赖判断，不应全局禁用。旧“全部接口匹配”的验收断言失败日志保留，不把本轮标为完全兼容或真实写入实测。

新包的列表读取22项，其中从官方只读索引补5项，包含此前反馈的漏列任务；没有向真实任务发送消息或已读通知。历史26.901.6511.0/26.903.8094.0仍只是既有行为验证记录，其他版本按当前接口判断。Chat列表与文字历史保持，续写待专用真实验证；新建/模型/生成图片和Work的未完成适配未纳入。

隔离0.10.35云包→0.10.36云包的设备保存、强制重启和显式删除通过，现有客户端设备、接入、更新、通知设置及通知草稿字节保持。标准发布器八项资源上传逐项读回后公开，再匿名使用生产更新函数读取latest双签名清单及固定版本完整APK/EXE和说明，全部核验一致。没有执行APK/模拟器、升级现有客户端、重启官方应用或写真实任务。

证据在会话`work/release-036/work/`：checks-watch.log、preflight.json、build-pre-dispatch-network-error.log、dispatch-recovery-status.json、preflight-recovered.json、build-dispatch.log、build-watch.log、package-verification.json、packaged-policy.json、packaged-index.json、agent-restart.log、installed-data-after.json、release-state.json、online-verification.json。发布记录提交不再次构建，已发布资源仍对应上述构建SHA；GITHUB-BUILD.json保留云端产出时的published/liveDesktopTested值，不修改已验签资源。

## 0.10.35 正式发布（2026-09-12）

[GitHub Release v0.10.35](https://github.com/Zmrn/RemoteCodex/releases/tag/v0.10.35) 已公开。最终版本286项Node22.19.0、接口清单、命令审批UI8组与图片稳定UI6组通过；源码`513b610634112a328d5f7d964d814a62cc562f31`的[Checks34674570785](https://github.com/Zmrn/RemoteCodex/actions/runs/34674570785)成功后，preflight放行，仅派发一次[Build34674760437](https://github.com/Zmrn/RemoteCodex/actions/runs/34674760437)，requestId为`d1056989-3687-4d10-a618-b227dcaa0510`。云端签名前门禁及全部构建步骤首次通过。

本版包含普通终端命令审批和消息日期时间。审批支持一次、拒绝及官方提供的类似前缀规则，显示完整命令和授权范围；以官方待请求为准，ACK不清卡、未知结果不重放。消息时间只取官方字段，按控制端时区显示，时间更新保留正文与图片。请同时更新目标Windows接入端与Windows/Android控制端。未完成Chat工作未纳入。

同次八项产物由标准发布器草稿上传并逐项读回后公开；匿名生产latest双签名清单及固定版本完整EXE/APK、说明下载均核验一致，没有混用或重建。

| 产物 | 字节数 | SHA-256 |
| --- | ---: | --- |
| RemoteCodex.exe | 44162560 | `96c5d226794535cf84944e5ad236aeb1e6befd9cee569279cf1140a0dca8cd1c` |
| RemoteCodex.apk | 278539 | `0c6aec63ff339be3559d5aa54f9603c7eafa7d0e5e4f61057998f99267ff552e` |

双端RSA更新签名、APK包名`com.anso.remotecodex`/versionCode10035/v2-v3及原证书通过。原APK证书SHA-256仍为`3c0a98ec3c9f37318525f5d0e4afb3417812215d625e48a9013b5ee649acb2b1`。中央清单SHA-256按提交原始字节及包内核对为`64841e597475442c94e7aa907aee564463ceee84d04e486e671d4cbce60b801b`；双端源码/共享页面/兼容清单/说明/更新渠道一致，包内无本地用户配置或签名私钥。

EXE隔离home、仅System32 PATH下的内嵌运行时、DPAPI和资源检查通过；当前本机官方app-tools管道不可用，包内官方连接验收为未完成，不能用之前官方26.903.9818.0源码只读匹配代替本次包内联通。隔离0.10.34云包源码→0.10.35云包源码的设备保存、强制重启和显式删除检查通过；现有客户端设备、接入、更新、通知设置及通知草稿字节保持。

官方平台为Windows x64；26.901.6511.0/26.903.8094.0是历史行为实测版本，其他版本按运行中实际接口逐功能判断。命令审批在26.903.9818.0开发阶段做过静态协议及真实只读21项接口/24项功能条件匹配，未实际批准请求。普通终端命令外的专用网络策略、文件修改、额外权限与未知选择结构仍交官方处理。Codex核心按接口开放；Chat列表与文字历史保持，续写待专用真实验证，新建/模型/生成图片未完成；Work未独立验证。

本轮未执行APK/模拟器、升级现有客户端、重启官方应用、写真实任务或本地构建，未访问旧服务器。GITHUB-BUILD.json中的published/liveDesktopTested保留云端产出时的值，发布后不改写已验签资源。

## 0.10.34 正式发布（2026-09-11）

[GitHub Release v0.10.34](https://github.com/Zmrn/RemoteCodex/releases/tag/v0.10.34) 已公开。最终版本277项Node22.19.0、接口清单和共享图片/历史UI通过，源码`6fd6b7c681d2120371cc15f65692a15ba9a39e7c`的[Checks34550592172](https://github.com/Zmrn/RemoteCodex/actions/runs/34550592172)成功后，只读preflight放行，仅派发一次[Build34550835116](https://github.com/Zmrn/RemoteCodex/actions/runs/34550835116)。requestId为`0bf21bdd-5ed3-4b50-b863-f10f5d1d6d82`，云端签名前门禁及全部构建步骤首次通过。

本版修复长会话发送准备读取整轮正文超限，以及Windows/Android图片随刷新反复进入loading导致抖动。发送使用官方实时元数据并核对新的owner/idle/连接；图片保留当前官方消息中的同图节点与解码状态，支持断线取消后恢复、失败手动重试和官方删除。历史扫描提前退出等待文件关闭，避免Windows文件句柄滞留。未使用磁盘历史完成标记授权写入，未知派发不重放。

| 产物 | 字节数 | SHA-256 |
| --- | ---: | --- |
| RemoteCodex.exe | 44160000 | `7b38fb1f12eb2afdbce695dee8aa41533c1f640be8154430f703497b94d1ca5b` |
| RemoteCodex.apk | 274443 | `5dc0f02c0ac1c2d1cf48f9942636da0feef3ce2829db9ce2863b30646334dd62` |

原RSA双清单签名、APK v2/v3原证书、包名com.anso.remotecodex/versionCode10034、双端源码/共享界面/发布说明/更新渠道均一致；无用户配置或私钥。APK原证书SHA-256仍为`3c0a98ec3c9f37318525f5d0e4afb3417812215d625e48a9013b5ee649acb2b1`；正式中央清单SHA-256为`1e94b3e63a91519572d3856b1390ee6281a994a856593a5d98d8a29a57ba2e17`，按构建提交Git blob和包内实际字节核对。

EXE使用隔离home、PATH仅Windows System32，通过内嵌Node22.19.0/Python3.13.2、DPAPI、界面资源及真实官方项目/任务只读自检。包内源码在官方Windows x64 26.903.9818.0/PID30692对用户问题长任务取得官方列表idle及新的匹配owner idle，只有list_threads与owner发现/订阅，没有read_thread或真实发送；20/20接口、23/23功能条件匹配，不等于真实写入往返验证。

隔离0.10.33云包→0.10.34云包的设备保存、升级、强制重启和显式删除通过；现有客户端设备/接入/更新/通知设置及通知草稿文件字节保持。标准发布器八项资源上传逐项读回后公开，再匿名用生产下载函数读取latest双签名清单，按固定v0.10.34完整下载双包及说明，验签、大小和哈希全部一致。构建、下载、上传及匿名核验均首次成功，没有重复派发或重建。

未执行APK/模拟器、升级现有客户端、重启官方应用或向真实任务写入。Chat/Work未完成适配未纳入，官方兼容继续按当前实际接口判断。GITHUB-BUILD.json中的published/liveDesktopTested保留云端产出时的false，不改写已验签资源。

证据在会话`work/release-034/work/`：checks-watch.log、preflight.json、build-dispatch.log、build-watch.log、package-verification.json、packaged-metadata.json、packaged-policy.json、agent-restart.log、installed-data-after.json、release-state.json、online-verification.json。发布记录提交不再次构建。

## 0.10.33 正式发布（2026-09-11）

[GitHub Release v0.10.33](https://github.com/Zmrn/RemoteCodex/releases/tag/v0.10.33)已公开，包含超长Codex历史只读分页、独立图片加载及重连后引用刷新。目标Windows接入端与使用的控制端都需更新。8份未完成Chat修改独立保留，未纳入安装包。

最终版本268项Node22.19.0、接口清单和新/旧历史UI通过后，提交`2c3fd27238ce4413b4216677b60779270c020ed3`推送GitHub；同提交[Checks34506235201](https://github.com/Zmrn/RemoteCodex/actions/runs/34506235201)全部成功，preflight通过，仅派发一次[Build34506575435](https://github.com/Zmrn/RemoteCodex/actions/runs/34506575435)。requestId为`4af34969-8b13-40b3-a8c3-8dc29e3e2958`，云端签名前同SHA门禁及构建全部成功，没有本地构建或重复派发。

| 产物 | 字节数 | SHA-256 |
| --- | ---: | --- |
| RemoteCodex.exe | 44156928 | `e7269803328ab79fdada9e9333d99f7478159a42a80fe427c534f6451b4388c6` |
| RemoteCodex.apk | 274371 | `1a887b8e2cda37409addd1be051454de2fa39d7fe9c6eeb6b4f24c8a3cc55fb5` |

两个更新清单原RSA签名、APK v2/v3原证书、包名com.anso.remotecodex与versionCode10033通过。APK证书SHA-256仍为`3c0a98ec3c9f37318525f5d0e4afb3417812215d625e48a9013b5ee649acb2b1`；中央清单SHA-256为`281138712486a95963d29897793c0a9a57c62d64ea2db9f4ff704f56a4c55dcf`，对应构建提交和包内实际字节。双端源码/界面、发布说明、兼容元数据和GitHub更新源一致，包内无用户配置或签名私钥。

EXE在隔离home、PATH仅含System32的环境完成内嵌Node22.19.0/Python3.13.2、DPAPI、资源及官方项目/任务只读自检；确认官方26.903.9818.0/PID30692。包内源码再次只读验证实际问题任务：32页820项、无重复、独立2041041字节PNG成功，最大响应143690字节，刷新一致，首次连接+失败降级+索引约9.1秒。另确认20/20接口、23/23功能条件匹配，不等同于真实任务写入往返。

隔离0.10.32云包到0.10.33云包完成设备保存、升级、强制重启及显式删除检查；现有客户端设备/接入/更新/通知设置和草稿文件字节未改变。标准发布器八项资源上传并逐项读回后公开；随后不携带GitHub登录凭据，通过生产更新函数读取latest双清单，再按v0.10.33完整下载APK/EXE和说明，签名、长度、哈希均一致。上传、读回、公开和匿名下载均首次成功。

本版降级仅处理官方当前列表可确认的本机Codex内容显示；发送、停止与已读同步仍使用官方实时核验，不能声称超限任务的全部操作已恢复。官方接口兼容按功能判断；Chat/Work未完成适配不扩大。没有运行APK/模拟器、升级现有客户端、重启官方应用或向真实任务写入。GITHUB-BUILD.json保留云端产出时published/liveDesktopTested=false，不改写已验签产物。

证据在会话`work/release-033/work/`：checks-watch.log、preflight.json、build-dispatch.log、build-watch.log、package-verification.json、packaged-history.log、packaged-policy.json、agent-restart.log、installed-data-after.json、release-state.json、online-verification.json。发布记录提交不再次构建。

## 0.10.32 正式发布（2026-09-10）

[GitHub Release v0.10.32](https://github.com/Zmrn/RemoteCodex/releases/tag/v0.10.32) 已公开。用户明确要求发布后，先在最终 0.10.32 工作树通过 Node22.19.0 的 259 项测试、接口清单及 5 组功能独立/7 组兼容报告/7 组已读 UI 检查；提交 `9b7dfa03f3056f7a686a0aaec8065b951e585c39` 的 [Checks34497736006](https://github.com/Zmrn/RemoteCodex/actions/runs/34497736006) 全部成功后，通过只读 preflight，仅派发一次 [Build34498105728](https://github.com/Zmrn/RemoteCodex/actions/runs/34498105728)。requestId 为 `5142fd0f-0e84-4e44-bdb3-e494f8ff9e49`，云端签名前同 SHA Checks 门禁实际通过，所有构建步骤首次成功。

本版包含逐功能兼容策略：官方版本号变化不再全局禁用，20 项实际接口按 23 项功能依赖判断；运行时、状态和兼容页面统一。缺少列表/项目/模型目录不再导致整机断线或阻止默认发送，队列/调整方向/停止分别判断。保留官方身份、owner、轮次、回执和未知结果不重放保护，任务和已读状态仍来自官方。

| 产物 | 字节数 | SHA-256 |
| --- | ---: | --- |
| RemoteCodex.exe | 44149760 | `c0b0e35b3376ee340dd6d55725670c461207b91e8c0ba8f1fd0509965b555e48` |
| RemoteCodex.apk | 274371 | `5b17e3ca14f2f37c65072054dc8ddd6c3a896396d74b6c865c60f3c3e5008d03` |

两个更新清单原 RSA 签名、APK v2/v3 原证书、包名 com.anso.remotecodex、versionCode10032、双端版本/源码 SHA/运行 ID/发布说明和 GitHub 更新渠道核验通过。APK 证书 SHA-256 仍为 `3c0a98ec3c9f37318525f5d0e4afb3417812215d625e48a9013b5ee649acb2b1`。正式中央清单 SHA-256 为 `d87d2cf363159c5ae95939c900b4886b5b4fabfd1cc5b14ee00b3299b4d4a3f2`，与构建提交的 Git blob 及包内实际字节一致；旧开发现场报告中的哈希不能代替最终提交。包内源码和共享界面与发布源码一致，无用户配置或签名私钥。

EXE 在隔离 home、PATH 仅含 Windows System32 的条件下通过内嵌 Node22.19.0/Python3.13.2、DPAPI、资源和真实官方项目/任务只读自检。确认官方 26.903.9818.0/PID30692 为官方独占 broker；使用包内源码重新连接确认 20/20 接口匹配、23/23 功能条件满足。隔离 0.10.31 云包到 0.10.32 云包的 UI 保存、升级、强制重启及显式删除通过；现有设备、接入、更新、通知设置及通知草稿文件字节未改。

标准发布器用同次八项资源建立草稿、逐项上传并读回后公开。发布后，不携带 GitHub 登录凭据，通过生产下载函数读取 latest 双签名清单，再按 v0.10.32 完整下载 APK/EXE 和说明，验签/长度/哈希全部一致。未重复派发、重建或覆盖已发布资源。

Windows x64 官方 26.903.9818.0 本轮仅有接口条件与只读行为验证，没有真实任务写入往返；历史行为实测仍是 26.901.6511.0、26.903.8094.0，其他版本按当前接口判断。Chat 列表/文字历史保持，续写待专用真实验证，新建/模型/生成图片和 Work 未完成；8 份未完成 Chat 修改未纳入包。本轮未运行 APK/模拟器、升级现有客户端、重启官方应用或写真实任务，未使用旧服务器或本地构建。GITHUB-BUILD.json 的 published/liveDesktopTested 保留云端产出时的 false，不改写已发布资源。

证据位于会话 `work/release-032/work/`：checks-watch.log、preflight.json、build-dispatch.log、build-watch.log、package-verification.json、packaged-policy.json、agent-restart.log、installed-data-after.json、release-state.json、online-verification.json。发布记录提交仅记录结果，不再次构建。

## 0.10.31 正式发布（2026-09-10）

[GitHub Release v0.10.31](https://github.com/Zmrn/RemoteCodex/releases/tag/v0.10.31) 已公开，同次八项资源均由标准发布器上传并读回核验。构建为 [34483037972](https://github.com/Zmrn/RemoteCodex/actions/runs/34483037972)，源码 `9bdd09d03bbbeec6337d60331d3c245cdd988dbb`；同提交 [Checks34483033637](https://github.com/Zmrn/RemoteCodex/actions/runs/34483033637) 成功，包含243项Node和相关共享UI、Windows窗口/通知、主机JVM检查。

首次构建34482830222及Checks34482813790因更新测试将0.10.31写死为“新版”失败，未产出安装包。9bdd09d只将该测试候选版本改为相对当前版本生成，产品代码未因此改变；随后重新在GitHub构建成功。首次发布请求遇网络失败，只读确认已建立同运行空草稿后恢复标准发布器，未创建重复版本或重建安装包。

| 产物 | 字节数 | SHA-256 |
| --- | ---: | --- |
| RemoteCodex.exe | 44145664 | `b95a8b376419e729e76578e296db9a329e02ee68a84c2f69cc9d07497cbbeb28` |
| RemoteCodex.apk | 274371 | `3adbae4489f07025db2c30868f1189e4eada5010d2a901646c7a2884119b703e` |

原RSA签名、APK v2/v3签名/原证书、包名及版本10031通过；APK证书SHA-256仍为 `3c0a98ec3c9f37318525f5d0e4afb3417812215d625e48a9013b5ee649acb2b1`。双端兼容清单SHA-256为 `5dec8b5911151268db501c43a75220ac95274fb28403e91a55675261f37fe771`。包内源码/界面、GitHub更新源和发布说明与本次提交一致，无用户配置或签名私钥。发布后匿名生产下载函数读取latest双清单、按v0.10.31下载完整双端包及说明，签名/长度/哈希与云产物一致。

EXE隔离home的Node22.19.0、Python3.13.2、DPAPI和界面资源检查通过；官方只读自检报 `Official app-tools pipe unavailable`，没有完成真实项目/任务读取，不能标作完整自检通过。系统安装包登记仍为官方26.903.8094.0，但未由成功连接确认当前owner。隔离0.10.30云包到0.10.31云包的设备保存、升级、强制重启和显式删除通过；已安装客户端设备与接入配置未改动。

支持范围仍为Windows x64官方26.901.6511.0、26.903.8094.0的既有Codex核心；网站授权、已读与通知仅有后者适配。Chat列表/历史可读，文字续写待专用真实验证，新建/模型/生成图片未完成；Work未独立验证。本轮新建/改名/授权行为为既有隔离回归，未做真实写入往返；未执行APK/模拟器、升级现有客户端、重启官方应用、访问旧服务器或本地构建。8份未完成Chat改动未纳入。GITHUB-BUILD.json保留云端产出时的published/liveDesktopTested=false。

现场证据在会话 `work/release-031/work/`：package-verification.json、agent-restart.log、online-verification.json；EXE真实连接未完成的原始自检在cloud-package-self-test-34483037972/data/self-test.json。

更新页版本展示见 [UPDATE-STATUS.md](UPDATE-STATUS.md)：当前安装、远端最新和已校验包分开显示，包含检查时间和旧包提示，已随 0.10.31 发布。

最新发布为 [0.10.31](https://github.com/Zmrn/RemoteCodex/releases/tag/v0.10.31)，新增更新版本展示、接口兼容性页面、网站授权，以及会话自动命名/重命名/列表同步修复；详细验证见本文末尾。0.10.29 是首次迁移到 GitHub 直接更新的版本。

2026-09-10 用户要求不再经原远端服务器分发更新。Windows 和 Android 更新入口改为 GitHub Releases，公开配置统一在 `src/update-source.json`。客户端不需要 GitHub 登录或访问密钥；设备互连仍沿用原连接方式。

2026-09-10 用户明确要求最新版云端构建后，0.10.29 已由 GitHub Actions 同次生成 APK/EXE 并正式发布到 GitHub Releases。下载后的原签名、双端哈希、EXE 包内只读自检及匿名 GitHub 更新下载均通过；未安装更新本机客户端、未执行 APK、未操作旧服务器。具体运行和产物见本文末尾。

## 更新链路

- Windows 查询 `https://github.com/Zmrn/RemoteCodex/releases/latest/download/latest.json`；Android 查询同目录 `android-latest.json`。
- 清单经过原 RSA 公钥验签后，按其中的版本下载 `/releases/download/v版本/RemoteCodex.exe` 或 `RemoteCodex.apk`。下载不会重新解析 latest，避免新版发布时把旧清单与新安装包混用。
- 两端最多跟随 5 次重定向，只允许 HTTPS 的本仓库 Releases 和 GitHub 的 release-assets/objects 资源域名；不携带设备密钥或 GitHub 凭据。网络失败、404、超限、签名或哈希错误均明确失败，不回退到旧服务器。
- Windows 的 SHA-256、长度、平台与安装保护保持；Android 的清单签名、APK 哈希、包名、版本与原安装证书检查保持，安装仍由 Android 系统确认。设备、密钥、草稿和历史存储格式不变。
- 原 `release.local.json` 与 GitHub 环境中的旧 `REMOTE_CODEX_UPDATE_BASE_URL` 不再决定安装包的更新源。包验收同时检查 EXE/APK 内嵌的 GitHub 入口；本机配置不能把旧服务器重新注入新包。

## 构建和正式发布

只有用户明确要求构建/打包时才运行 `node scripts/github-actions.mjs build`，随后用同一个 runId `watch`、`download`。必须先按AGENTS.md在最终版本工作树验证、提交并等待同SHA的Checks成功，再通过只读`preflight`；CLI和云端准备签名前均复核Checks。日常push/PR只运行Checks；构建工作流仍仅由workflow_dispatch启动，不因为提交而生成APK/EXE。

正式发布使用已经下载并验签的云端产物：

```powershell
node scripts/github-actions.mjs publish <runId>
```

发布器只接受本仓库 main 成功的双端 build，校验运行编号、源码提交、GitHub 更新源、两个签名清单、构建报告、兼容清单、包哈希和发布说明。旧服务器入口的历史云构建因缺少新渠道证明被拒绝，不能直接当作迁移版发布。

发布先建立 `v版本` 的草稿 Release，目标固定到该次构建的完整提交 SHA。上传 APK、EXE、两个构建报告、两个签名清单、RELEASE-NOTES.md 和 GITHUB-BUILD.json，再从 GitHub 读回每个资源校验大小与哈希，全部通过后才公开。读回上限由已验证的产物大小决定。用户更新使用 Releases 的长期资源；Actions 中保留 3 天的临时 artifact 用于构建交付。

同版本/运行的失败重试先检查已有草稿和资源，不盲目删除、覆盖或重新上传；上传或发布结果未知时不自动重复操作。已发布版本不允许改写；发现另一运行占用标签、目标提交不符、资源异常或已有更新版本时停止。旧 SSH 发布入口和本地 `--publish` 入口已明确拒绝，不会再触碰旧服务器。GitHub 发布用现有 Git Credential Manager 授权，只向 GitHub API/上传域名发送凭据，不向资源 CDN 转发。

## 首次迁移

已安装的 0.10.28 及更早版本把旧更新入口写在包内，无法通过未升级的客户端直接获得新的入口。下一次构建并发布迁移版后，需要从 GitHub Releases 手动安装一次：Windows 替换程序时保留原数据目录，Android 使用同证书覆盖安装。此后按现有自动更新设置直接查询 GitHub。不要卸载并清理数据，也不通过旧服务器加跳转或补发迁移包。本次不改正在运行的客户端或用户数据。

下载页：[0.10.29 GitHub Release](https://github.com/Zmrn/RemoteCodex/releases/tag/v0.10.29)。这是首个使用 GitHub 直接更新入口的正式迁移版。

## 验证与范围

204 项 Node 回归和 22 项主机 JVM 更新网络检查通过。覆盖 GitHub/CDN 重定向、不转发凭据、HTTP/其他域名/循环拒绝、下载大小限制、固定版本、双端签名及来源校验、草稿公开顺序、未知上传/发布结果恢复、已发布资源不可覆写、版本回退和标签冲突。更新格式的单文件测试补齐独立 scratch 目录创建，不再依赖其他测试先运行。

上述 Node/Java 回归使用隔离服务替身。后续云构建、真实 Release 上传/读回和匿名下载已通过，见下文；Windows 内置升级、APK 安装或执行仍未在此版验证。官方兼容清单未更改：Windows x64 官方 26.901.6511.0、26.903.8094.0 的 Codex 核心；通知仅 .903 本机 Codex owner。Chat 列表/文字历史与实验性续写保持，新建/模型/生成图片未完成，Work 未独立验证；此次包内自检只读取官方项目与任务，不增加写入或 Chat 功能验证。

## 2026-09-10 正式云构建与发布

- 源码：`9c9080e73061ba48e27549b1c556cabc36136b36`，版本 0.10.29；原工作区 8 份未完成 Chat 修改未纳入构建。
- [Build EXE and APK 34443633443](https://github.com/Zmrn/RemoteCodex/actions/runs/34443633443)：成功，标准 Windows runner；双端构建与回归、Android 主机 JVM 检查、更新网络回归、原身份签名、兼容元数据/包内容校验及签名临时文件清理全部通过。
- 同次八项产物经草稿上传、逐项读回哈希核验后公开：[Remote Codex 0.10.29](https://github.com/Zmrn/RemoteCodex/releases/tag/v0.10.29)。没有本地重建、旧服务器操作或替换已发布资源。
- 本机下载后：两个更新清单 RSA 验签、APK v2/v3 签名和原证书一致、EXE 隔离目录包内运行时/DPAPI/官方只读访问通过（实际官方 26.903.8094.0，PID 108796）。没有安装/执行 APK，也没有升级当前客户端。
- 发布后：使用生产更新下载函数、不带登录凭据，从 latest 取得两个签名清单，再按 v0.10.29 固定版本下载完整 EXE/APK；大小、SHA-256、发布说明与本次云产物一致。最新 Release 含全部八项资源。

| 产物 | 字节数 | SHA-256 |
| --- | ---: | --- |
| RemoteCodex.exe | 44121088 | `3f2fc9c004469f9d321246fb1b2995149a05e62a1ee1eea78f45be7fa7952e3b` |
| RemoteCodex.apk | 257537 | `af1b5cde0d5f9f5c1257a16f7a9808087c914300b910b8be059215356f4f955e` |

原 APK 证书 SHA-256：`3c0a98ec3c9f37318525f5d0e4afb3417812215d625e48a9013b5ee649acb2b1`。中央清单 SHA-256：`1a24252d7c4dbbebf0367feb6325a329f11abc7268d3a6c467ab5ec7da1532b5`。构建包内 GITHUB-BUILD.json 的 `published:false` / `liveDesktopTested:false` 是云端产出当时的状态，发布后不改写已验签资源；后续验证和发布状态以本节为准。

## 0.10.30 正式发布（2026-09-10）

用户明确要求打包发布后，仅派发一次 [Build EXE and APK 34463415359](https://github.com/Zmrn/RemoteCodex/actions/runs/34463415359)，构建提交 `5f1d660a8946ad8fc7e17e2217694a2f864453c7`。同提交 [Checks34463387667](https://github.com/Zmrn/RemoteCodex/actions/runs/34463387667) 成功，包含新增的共享页面→HTTP→生产已读函数→隔离官方IPC测试。功能来自 6a01f4d、f88b318；未完成 Chat 修改未纳入，版本号仅升为0.10.30，没有扩大官方兼容范围。

标准发布器使用同次已下载并验签的八项产物，草稿上传并逐项从GitHub读回哈希核验后公开到 [v0.10.30](https://github.com/Zmrn/RemoteCodex/releases/tag/v0.10.30)。发布后通过不携带登录凭据的生产更新函数取得latest双清单，再按固定版本完整下载EXE/APK及说明；原RSA签名、长度、SHA-256、发布说明哈希与云产物一致。

| 产物 | 字节数 | SHA-256 |
| --- | ---: | --- |
| RemoteCodex.exe | 44124160 | `8669b9f1b44e409df7b60ff95bba98a22fe54ef5b75c3b678d145ebae499a57c` |
| RemoteCodex.apk | 257614 | `8c8d28fda2ec15fcb4095c1e13b1463d9b5b4cfabe1a158a6e66e79cfe6957a5` |

APK包名/版本10030、v2/v3签名和原安装证书通过；原证书指纹不变。中央清单SHA-256为 `84de01df63976cb53cec8df7874236d51520abbd6144f552a6a5a76bf4b32c5d`，双端元数据一致。EXE隔离home自检通过，使用内嵌Node22.19.0/Python3.13.2、DPAPI和实际官方26.903.8094.0/PID108796只读项目/任务列表。双端UI、EXE源码与发布提交核对一致，GitHub更新入口和无用户配置/签名文件检查通过。隔离的0.10.29云包源码→0.10.30云包源码，设备保存/升级/强制重启/显式删除检查通过；现有客户端设备与接入配置保持原样。

支持仍为Windows x64官方26.901.6511.0、26.903.8094.0的Codex核心；官方已读与通知限于后者本机Codex。Chat列表/文字历史，续写待专用真实验证，新建/模型/生成图片未完成；Work未独立验证。新交互仅隔离回归及问题任务只读核对，不是本次真实任务写入验收。本轮没有运行APK或模拟器、升级现有客户端、访问旧服务器或本地构建；安装验证由用户进行。GITHUB-BUILD.json中的published/liveDesktopTested仍保留云端产出时的false，不改写已发布产物。
