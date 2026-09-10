import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { OFFICIAL, EVENTS, supportManifest } from "../src/official-protocol.mjs";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export function validateCatalog() {
  const versions = OFFICIAL.support.verifiedVersions;
  if (OFFICIAL.schemaVersion !== 1 || !versions.length || new Set(versions).size !== versions.length ||
      versions.some(v => !/^\d+\.\d+\.\d+\.\d+$/.test(v))) throw Error("Explicit verified desktop versions required");
  if (OFFICIAL.transport.headerBytes !== 4 || OFFICIAL.transport.byteOrder !== "uint32-le")
    throw Error("Transport decoder must be revalidated before changing framing");
  for (const version of versions) {
    const row = OFFICIAL.validation.find(v => v.version === version);
    if (!row?.date || !row.scope || !row.evidence?.length || row.evidence.some(p => !fs.existsSync(path.join(root, p))))
      throw Error("Version validation evidence required: " + version);
  }
  for (const [kind, entries] of Object.entries({ tools: OFFICIAL.tools, ipc: OFFICIAL.ipc })) {
    for (const [key, row] of Object.entries(entries)) {
      if (!(row.method || row.name) || !row.purpose || !row.consumer || !Array.isArray(row.request) || !row.response ||
          !fs.existsSync(path.join(root, row.test)) || (kind === "ipc" && !Number.isInteger(row.version)))
        throw Error("Incomplete desktop interface entry: " + key);
    }
  }
  const interfaces = new Set([...Object.keys(OFFICIAL.tools), ...Object.keys(OFFICIAL.ipc)]);
  if (!Object.keys(OFFICIAL.features ?? {}).length) throw Error("Feature dependencies required");
  for (const [key, feature] of Object.entries(OFFICIAL.features)) {
    if (!feature.label || !feature.requires?.length || feature.requires.some(k => !interfaces.has(k))) throw Error("Invalid feature dependencies: " + key);
  }
  return supportManifest();
}
export function eventModule() {
  return '// Generated from src/official-desktop.json; checked by test/compatibility.test.mjs.\nexport const USER_INPUT_REQUEST = ' + JSON.stringify(EVENTS.userInput) + ';\n';
}
export function interfaceMarkdown() {
  const list = x => Array.isArray(x) ? x.join(", ") : x;
  const cell = x => String(list(x)).replaceAll("|", "\\|").replaceAll("\n", " ");
  const lines = [
    "# 官方桌面接口清单",
    "",
    "由 src/official-desktop.json 生成；修改源清单后运行 node scripts/compatibility-report.mjs --write。",
    "此清单描述桥接器实际使用的桌面内部接口，不代表 OpenAI 对第三方的稳定性承诺。字段为已使用字段摘要，不是完整官方 schema。",
    "",
    "已验证官方版本：" + OFFICIAL.support.verifiedVersions.join("、") + "（" + OFFICIAL.support.platform + "）。",
    "Chat：" + OFFICIAL.support.chat + "。Work：" + OFFICIAL.support.work + "。",
    "",
    "## 连接和数据来源",
    "",
    "- 共享转发管道：" + OFFICIAL.discovery.ownerPipe + "；官方工具管道前缀：" + OFFICIAL.discovery.toolsPipePrefix + "。",
    "- 官方 app-tools 必须属于 WindowsApps 中的 ChatGPT.exe，并提供真实 tools/list。转发管道可由官方进程或签名有效、发布者/公司/产品均匹配中央清单的 Microsoft VS Code 持有；两者不要求同一 PID。握手后再次验证 PID/映像，身份变化时关闭并重新发现。",
    "- 管道 PID 不等于任务 owner；按真实 conversationId 发现 handledByClientId，再定向转发，核对相同 owner 回执及事件。协议没有 owner UUID 到 Windows PID 的查询字段，能力标志不是官方进程证明。共存验证见 VSCODE-COEXISTENCE.md。",
    "- 传输：4 字节小端长度 + JSON；app-tools 使用 JSON-RPC 2.0，桌面 IPC 使用 requestId/sourceClientId/version/targetClientId 信封，两者不能混用。",
    "- 实时流只接受当前订阅任务的已发现所有者，patch 基线不匹配时标记未知并重读。",
    "- 磁盘队列：" + OFFICIAL.storage.globalStateFile + " / " + OFFICIAL.storage.queueKey + "；仅只读，不能证明实时状态。",
    "- 大历史降级：当前官方 home 的 " + OFFICIAL.storage.rolloutHistory.directories.join(' / ') + "；核对本机任务和 session_meta 身份，只读 item_completed 并按消息分页、图片按需读取。历史结束记录不控制实时状态、写入或已读。",
    "- 全部未知写入回执不得自动重发；安全限制、原始上下文和当前任务 ID 必须保留。",
    "",
    "## 桌面 app-tools",
    "",
    "| 方法 | 用途 | 请求字段 | 返回字段 | 调用/适配位置 | 回归 |",
    "| --- | --- | --- | --- | --- | --- |",
    ...Object.values(OFFICIAL.tools).map(r => "| " + [r.name, r.purpose, r.request, r.response, r.consumer, r.test].map(cell).join(" | ") + " |"),
    "",
    "## 所有者 IPC",
    "",
    "| 方法 | 协议版本 | 用途 | 请求字段 | 返回字段 | 调用位置 | 回归 |",
    "| --- | --- | --- | --- | --- | --- | --- |",
    ...Object.values(OFFICIAL.ipc).map(r => "| " + [r.method, r.version, r.purpose, r.request, r.response, r.consumer, r.test].map(cell).join(" | ") + " |"),
    "",
    "## 功能与所需接口",
    "",
    "当前连接按这些依赖逐功能判断；历史已验证版本不作为运行白名单。异常/未知只影响依赖它的功能。任务身份、内容结构和回执仍在操作时核验。",
    "",
    "| 功能 | 所需接口 ID |",
    "| --- | --- |",
    ...Object.values(OFFICIAL.features).map(r => "| " + [r.label, r.requires].map(cell).join(" | ") + " |"),
    "",
    "## 事件和依赖结构",
    "",
    "| 事件 | 字段 | 消费位置 |",
    "| --- | --- | --- |",
    ...Object.values(OFFICIAL.events).map(r => "| " + [r.method, r.fields, r.consumer].map(cell).join(" | ") + " |"),
    "",
    "| 结构 | 字段 | 适配位置 | 约束 |",
    "| --- | --- | --- | --- |",
    ...Object.entries(OFFICIAL.structures).map(([k, r]) => "| " + [k, r.fields, r.consumer, r.rule].map(cell).join(" | ") + " |"),
    "",
  ];
  return lines.join("\n");
}
export function releaseNotes(version) {
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw Error("Invalid release version");
  validateCatalog();
  const shared = OFFICIAL.discovery.sharedBroker.validation;
  return [
    "# Remote Codex " + version, "",
    ...(fs.existsSync(path.join(root, "releases", version + ".md"))
      ? [fs.readFileSync(path.join(root, "releases", version + ".md"), "utf8").trim().replaceAll("\r\n", "\n"), ""] : []),
    "支持的官方桌面版本：" + OFFICIAL.support.verifiedVersions.join("、") + "（Windows x64，OpenAI.Codex 包）。",
    "这里的版本指目标电脑上运行的官方应用；Android APK 是控制端，也依赖目标电脑的同一兼容范围。", "",
    "- Codex：" + OFFICIAL.support.codex + "。",
    "- Chat：" + OFFICIAL.support.chat + "。",
    "- Work：" + OFFICIAL.support.work + "。",
    "- 上述为历史行为实测版本；其他版本按当前运行接口逐功能判断，缺失/不匹配/未知只停用依赖功能。接口声明匹配不等于真实操作已验证。",
    "- EXE/APK 同步发布；安装路径自动发现和自动重连不代表协议自动兼容。", "",
    "- VS Code 共存：共享 IPC 转发已在官方 " + shared.officialVersion + "、Microsoft VS Code " + shared.brokerVersion + " 和 Codex 扩展 " + shared.extensionVersion + " 实测；其他组合没有由此验证。未重启官方应用或关闭 VS Code。", "",
    "接口清单 SHA-256：" + supportManifest().catalogSha256, "",
  ].join("\n");
}
export function checkGenerated(write = false) {
  validateCatalog();
  for (const [file, expected] of [["public/official-events.mjs", eventModule()], ["COMPATIBILITY-INTERFACES.md", interfaceMarkdown()]]) {
    const target = path.join(root, file);
    if (write) fs.writeFileSync(target, expected);
    else if (fs.readFileSync(target, "utf8").replaceAll("\r\n", "\n") !== expected)
      throw Error(file + " is stale; run node scripts/compatibility-report.mjs --write");
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const arg = process.argv[2];
  checkGenerated(arg === "--write");
  if (arg === "--json") console.log(JSON.stringify(supportManifest()));
  else if (arg === "--release-notes") process.stdout.write(releaseNotes(process.argv[3]));
  else console.log("Official desktop compatibility catalog verified: " + OFFICIAL.support.verifiedVersions.join(", "));
}
