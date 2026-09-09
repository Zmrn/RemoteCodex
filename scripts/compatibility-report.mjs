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
    "- 所有者管道：" + OFFICIAL.discovery.ownerPipe + "；工具管道前缀：" + OFFICIAL.discovery.toolsPipePrefix + "。",
    "- 先通过 Win32 验证管道 PID 和官方进程映像，再获取 tools/list；全部写入转交现有桌面所有者。",
    "- 传输：4 字节小端长度 + JSON；app-tools 使用 JSON-RPC 2.0，桌面 IPC 使用 requestId/sourceClientId/version/targetClientId 信封，两者不能混用。",
    "- 实时流只接受当前订阅任务的已发现所有者，patch 基线不匹配时标记未知并重读。",
    "- 磁盘队列：" + OFFICIAL.storage.globalStateFile + " / " + OFFICIAL.storage.queueKey + "；仅只读，不能证明实时状态。",
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
  return [
    "# Remote Codex " + version, "",
    ...(fs.existsSync(path.join(root, "releases", version + ".md"))
      ? [fs.readFileSync(path.join(root, "releases", version + ".md"), "utf8").trim().replaceAll("\r\n", "\n"), ""] : []),
    "支持的官方桌面版本：" + OFFICIAL.support.verifiedVersions.join("、") + "（Windows x64，OpenAI.Codex 包）。",
    "这里的版本指目标电脑上运行的官方应用；Android APK 是控制端，也依赖目标电脑的同一兼容范围。", "",
    "- Codex：" + OFFICIAL.support.codex + "。",
    "- Chat：" + OFFICIAL.support.chat + "。",
    "- Work：" + OFFICIAL.support.work + "。",
    "- 未列出的版本不视为已支持；可以尝试只读发现，写入仍拒绝，必须完成协议复测后再放行。",
    "- EXE/APK 同步发布；安装路径自动发现和自动重连不代表协议自动兼容。", "",
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
