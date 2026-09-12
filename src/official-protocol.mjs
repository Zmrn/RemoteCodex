// Single catalog for the installed official desktop's private protocol.
// This is not a standalone app-server client.
import fs from "node:fs";
import { createHash } from "node:crypto";
const raw = fs.readFileSync(new URL("./official-desktop.json", import.meta.url), "utf8");
const freeze = value => {
  if (value && typeof value === "object") {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
};
export const OFFICIAL = freeze(JSON.parse(raw));
export const CATALOG_SHA256 = createHash("sha256").update(raw).digest("hex");
export const TOOLS = freeze(Object.fromEntries(Object.entries(OFFICIAL.tools).map(([key, value]) => [key, value.name])));
export const EVENTS = freeze(Object.fromEntries(Object.entries(OFFICIAL.events).map(([key, value]) => [key, value.method])));
export function supportedBuild(image) {
  const { packagePrefix, packageSuffix, verifiedVersions } = OFFICIAL.support;
  return typeof image === "string" && verifiedVersions.some(version => image.includes(packagePrefix + version + packageSuffix));
}
export function supportManifest() {
  const { officialProduct, platform, verifiedVersions, unknownVersionPolicy, codex, chat, work } = OFFICIAL.support;
  return { catalogSha256: CATALOG_SHA256, officialProduct, platform, verifiedVersions: [...verifiedVersions], unknownVersionPolicy, modes: { codex, chat, work } };
}
export function desktopCompatibility(image) {
  const prefix = OFFICIAL.support.packagePrefix;
  const at = typeof image === "string" ? image.indexOf(prefix) : -1;
  const version = at >= 0 ? /^(\d+\.\d+\.\d+\.\d+)_/.exec(image.slice(at + prefix.length))?.[1] ?? null : null;
  return { ...supportManifest(), detectedVersion: version, behaviorVerified: supportedBuild(image) };
}
const unknown = detail => ({ status: 'unknown', detail });
export function protocolObservation(records, spec) {
  if (!records?.length) return unknown('无法读取此版本的协议表');
  if (records.some(r => Object.hasOwn(r.methods, spec.method) && !Number.isInteger(r.methods[spec.method])))
    return unknown('无法识别此指令的协议版本声明');
  const versions = [...new Set(records.map(r => r.methods[spec.method]).filter(Number.isInteger))];
  if (!versions.length) return { status: 'missing', detail: '官方协议表中未找到此指令' };
  if (versions.length !== 1) return unknown('协议表存在多个版本，需运行验证');
  return { status: versions[0] === spec.version ? 'matched' : 'mismatch', version: versions[0],
    detail: versions[0] === spec.version ? '协议版本一致；来自包内静态声明' : `预期 v${spec.version}，官方为 v${versions[0]}` };
}
export function interfaceObservations({ connected = false, ipcConnected = connected, catalog = [], protocols = [] } = {}) {
  const rows = Object.entries(OFFICIAL.tools).map(([id, spec]) => {
    const tool = catalog.find(t => t.namespace === OFFICIAL.discovery.toolsNamespace && t.name === spec.name);
    const fields = Object.keys(tool?.inputSchema?.properties ?? {}), missingFields = spec.request.filter(f => !fields.includes(f));
    const value = !connected ? unknown('官方桌面未连接') : !tool ? { status: 'missing', detail: '官方工具目录未提供此指令' }
      : !tool.inputSchema?.properties ? unknown('工具参数声明无法读取')
      : missingFields.length ? { status: 'mismatch', missingFields, detail: '缺少参数：' + missingFields.join('、') }
      : { status: 'matched', fields, detail: '指令及所用顶层参数存在；来自实时 tools/list' };
    return [id, value];
  });
  for (const [id, spec] of Object.entries(OFFICIAL.ipc)) rows.push([id, id === 'initialize'
    ? ipcConnected ? { status: 'matched', version: spec.version, detail: '当前连接握手成功' } : unknown('所有者 IPC 握手未确认')
    : protocolObservation(protocols, spec)]);
  return Object.fromEntries(rows);
}
export function featurePolicy(observations = {}) {
  return Object.fromEntries(Object.entries(OFFICIAL.features).map(([id, spec]) => {
    const blocked = spec.requires.filter(key => observations[key]?.status !== 'matched');
    return [id, { label: spec.label, supported: !blocked.length, requires: spec.requires, blocked,
      reason: blocked.length ? spec.label + '暂不可用：' + blocked.map(key =>
        (OFFICIAL.tools[key]?.name ?? OFFICIAL.ipc[key]?.method ?? key) + '（' + (observations[key]?.detail ?? '尚无当前连接证据') + '）').join('；') : '' }];
  }));
}
// Evidence belongs to one locally verified connection, never a client report or version string.
const observations = new WeakMap();
export function observeDesktop(desktop, protocols) {
  observations.set(desktop, { identity: desktop.identity, image: desktop.identity?.appToolsPipe?.image,
    tools: desktop.tools, ipc: desktop.ipc, catalog: desktop.catalog,
    rows: freeze(interfaceObservations({ connected: true, ipcConnected: !!desktop.ipc && !desktop.ipc.socket?.destroyed, catalog: desktop.catalog, protocols })) });
}
export function forgetDesktop(desktop) { observations.delete(desktop); }
export function desktopPolicy(desktop) {
  const proof = desktop && observations.get(desktop);
  const valid = !!proof && !!desktop.identity && proof.identity === desktop.identity && proof.image === desktop.identity.appToolsPipe?.image &&
    proof.tools === desktop.tools && proof.catalog === desktop.catalog && !desktop.tools?.socket?.destroyed;
  const interfaces = valid ? { ...proof.rows } : {};
  if (valid && (proof.ipc !== desktop.ipc || desktop.ipc?.socket?.destroyed)) interfaces.initialize = unknown('所有者连接已变化，请重新连接');
  const features = featurePolicy(interfaces);
  return { ...desktopCompatibility(desktop?.identity?.appToolsPipe?.image), policy: 'per-feature-interfaces', interfaces, features,
    writeSupported: ['send', 'resume', 'create', 'steer', 'queue', 'settings', 'rename', 'browserApproval', 'commandApproval', 'chatSend'].some(k => features[k].supported) };
}
export function requireFeature(desktop, key) {
  const feature = desktopPolicy(desktop).features[key];
  if (!feature?.supported) throw Error((feature?.reason ?? '未知功能：' + key) + '。请求未发送，草稿和图片已保留。(Unavailable official feature)');
}
export function requireInterface(desktop, key) {
  const rows = desktopPolicy(desktop).interfaces;
  const value = OFFICIAL.ipc[key] && rows.initialize?.status !== "matched" ? rows.initialize : rows[key];
  if (value?.status !== 'matched') throw Error('官方接口 ' + (OFFICIAL.tools[key]?.name ?? OFFICIAL.ipc[key]?.method ?? key) +
    ' 暂不可用：' + (value?.detail ?? '尚无当前连接证据') + '。请求未发送。(Unavailable official interface)');
}
export function protocolRequest(pipe, key, params, options = {}) {
  const spec = OFFICIAL.ipc[key];
  if (!spec || key === "following" || key === "readStateChanged") throw Error("Unknown official request: " + key);
  if (Object.hasOwn(options, "version")) throw Error("Official protocol versions must come from the catalog");
  pipe?.assertInterface?.(key);
  return pipe.request(spec.method, params, { ...options, version: spec.version });
}
export function protocolBroadcast(pipe, key, params, targets) {
  const spec = OFFICIAL.ipc[key];
  if (key !== "following" && key !== "readStateChanged") throw Error("Unknown official broadcast: " + key);
  if (key === "readStateChanged" && params.hasUnreadTurn !== false) throw Error("Read synchronization can only clear the unread flag");
  pipe?.assertInterface?.(key);
  return pipe.broadcast(spec.method, params, spec.version, targets);
}
