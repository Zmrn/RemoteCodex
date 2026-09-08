# 调查与许可证

原型运行代码使用 Node.js/Python 标准库，无第三方运行时包。调查时参考了 Farfield 的桌面 IPC 分帧、客户端发现和所有者转发机制；相关 MIT 声明完整保留在 `FARFIELD-LICENSE.txt`。

Farfield：Copyright (c) 2026 Anshu Chimala，MIT，commit `a479046dfa2f13b3942d9ec3e56f56a0b84e8bee`。

OpenCodex（AGPL-3.0）与 Dexgram（MIT）仅用于只读调查，未把其实现代码复制到原型；调查 checkout 不随本仓库分发。

当前官方安装包被只读检查以核实私有协议，未修改或分发官方二进制/应用 bundle。原型不是 OpenAI 官方产品，也不声明这些私有接口有长期兼容保证。

Prettier 3.6.2 与 Playwright Core 1.56.1 仅用于格式化和本地浏览器测试，不是运行原型所必需的依赖，也未随源码分发。

图标按用户要求使用 ChatGPT 结形标志，并叠加本项目的蓝色网络徽标。结形 SVG 来源：<https://upload.wikimedia.org/wikipedia/commons/0/04/ChatGPT_logo.svg>，原始文件信息页：<https://commons.wikimedia.org/wiki/File:ChatGPT_logo.svg>。ChatGPT/OpenAI 标志和商标属于 OpenAI；本项目不主张该标志的原创权，也不表示官方出品或背书。可编辑图标为 `public/app-icon.svg`，生成的 PNG/ICO 仅用于本原型界面及启动入口。
