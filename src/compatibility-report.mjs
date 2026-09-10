import fs from 'node:fs';
import path from 'node:path';
import { Desktop } from './desktop.mjs';
import { OFFICIAL, CATALOG_SHA256, desktopCompatibility } from './official-protocol.mjs';
import { sourceProtocols } from './compatibility-probe.mjs';
import { INSTANCE } from './runtime.mjs';

export async function latestOfficialVersion(fetcher = fetch) {
  const response = await fetcher(OFFICIAL.updateDiscovery.manifestUrl, {
    redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(8000),
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) throw Error('manifest-unavailable');
  const chunks = []; let size = 0;
  for await (const bytes of response.body) {
    size += bytes.byteLength;
    if (size > 16000) throw Error('manifest-invalid');
    chunks.push(Buffer.from(bytes));
  }
  const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  if (value.schemaVersion !== OFFICIAL.updateDiscovery.schemaVersion || value.packageIdentity !== OFFICIAL.updateDiscovery.packageIdentity ||
      !/^\d+\.\d+\.\d+\.\d+$/.test(value.buildVersion)) throw Error('manifest-invalid');
  return value.buildVersion;
}

export function candidateImage(image, version) {
  if (!/^\d+\.\d+\.\d+\.\d+$/.test(version)) return null;
  const packageDir = path.win32.dirname(path.win32.dirname(image));
  const match = /^OpenAI\.Codex_\d+\.\d+\.\d+\.\d+_x64__([a-z0-9]+)$/.exec(path.win32.basename(packageDir));
  if (!match || path.win32.basename(path.win32.dirname(packageDir)).toLowerCase() !== 'windowsapps') return null;
  return path.win32.join(path.win32.dirname(packageDir), `OpenAI.Codex_${version}_x64__${match[1]}`, 'app', 'ChatGPT.exe');
}

const unknown = detail => ({ status: 'unknown', detail });
function protocolObservation(records, spec) {
  if (!records?.length) return unknown('无法读取此版本的协议表');
  if (records.some(r => Object.hasOwn(r.methods, spec.method) && !Number.isInteger(r.methods[spec.method])))
    return unknown('无法识别此指令的协议版本声明');
  const versions = [...new Set(records.map(r => r.methods[spec.method]).filter(Number.isInteger))];
  if (!versions.length) return { status: 'missing', detail: '官方协议表中未找到此指令' };
  if (versions.length !== 1) return unknown('协议表存在多个版本，需运行验证');
  return { status: versions[0] === spec.version ? 'matched' : 'mismatch', version: versions[0],
    detail: versions[0] === spec.version ? '协议版本一致；来自包内静态声明' : `预期 v${spec.version}，官方为 v${versions[0]}` };
}

export function buildCompatibilityReport({ activeVersion = null, connected = false, catalog = [], activeProtocols = [],
  latestVersion = null, latestProtocols = [], latestSource = 'unavailable', activeError = null, latestError = null } = {}) {
  const same = !!latestVersion && activeVersion === latestVersion;
  const rows = Object.entries(OFFICIAL.tools).map(([id, spec]) => {
    const tool = catalog.find(t => t.namespace === OFFICIAL.discovery.toolsNamespace && t.name === spec.name);
    const fields = Object.keys(tool?.inputSchema?.properties ?? {});
    const missingFields = spec.request.filter(f => !fields.includes(f));
    const running = !connected ? unknown('官方桌面未连接') : !tool ? { status: 'missing', detail: '官方工具目录未提供此指令' }
      : missingFields.length ? { status: 'mismatch', missingFields, detail: '缺少参数：' + missingFields.join('、') }
      : { status: 'matched', fields, detail: '指令及所用顶层参数存在；来自实时 tools/list' };
    return { id, kind: 'tool', name: spec.name, purpose: spec.purpose, expected: { request: spec.request }, running,
      latest: same ? running : unknown(latestVersion ? '需新版运行后读取工具参数' : '尚未取得官方最新版') };
  });
  for (const [id, spec] of Object.entries(OFFICIAL.ipc)) {
    const running = id === 'initialize' ? connected ? { status: 'matched', version: spec.version, detail: '当前连接握手成功' } : unknown('官方桌面未连接')
      : protocolObservation(activeProtocols, spec);
    const latest = same ? running : !latestVersion ? unknown('尚未取得官方最新版') : id === 'initialize' ? unknown('需新版运行后验证握手') : protocolObservation(latestProtocols, spec);
    rows.push({ id, kind: 'ipc', name: spec.method, purpose: spec.purpose, expected: { version: spec.version, request: spec.request }, running, latest });
  }
  return { schemaVersion: 1, checkedAt: new Date().toISOString(), remoteVersion: INSTANCE.version, catalogSha256: CATALOG_SHA256,
    active: { version: activeVersion, connected, writeSupported: OFFICIAL.support.verifiedVersions.includes(activeVersion),
      readStateSupported: OFFICIAL.storage.readState.verifiedVersions.includes(activeVersion), error: activeError },
    latest: { version: latestVersion, source: same ? 'running' : latestSource, error: latestError,
      writeSupported: OFFICIAL.support.verifiedVersions.includes(latestVersion),
      readStateSupported: OFFICIAL.storage.readState.verifiedVersions.includes(latestVersion) },
    supportedVersions: OFFICIAL.support.verifiedVersions, rows, taskWrites: 0,
    checkScope: 'used-interfaces-only',
    limits: '只检查 Remote Codex 使用的接口名单：指令、所用顶层参数及协议版本。名单外的新增或变动不报异常。检查只读，不发送测试消息；声明一致不代表实际操作已验证。' };
}

export async function collectCompatibilityReport({ createDesktop = () => new Desktop(), getLatest = latestOfficialVersion,
  readProtocols = sourceProtocols, exists = fs.existsSync } = {}) {
  const desktop = createDesktop();
  const latestPromise = Promise.resolve().then(getLatest).then(version => ({ version }), () => ({ error: '无法取得官方更新清单，请稍后重试' }));
  let activeVersion = null, activeImage = null, connected = false, activeProtocols = [], catalog = [], activeError = null;
  try {
    try {
      await desktop.connect({ inspectCatalog: true }); connected = true; catalog = desktop.catalog;
      activeImage = desktop.identity.appToolsPipe.image;
      activeVersion = desktopCompatibility(activeImage).detectedVersion;
      try { activeProtocols = readProtocols(activeImage); } catch { activeError = '当前包协议表读取失败'; }
    } catch { activeError = '无法连接官方桌面，请先打开并登录官方应用'; }
    const latest = await latestPromise;
    let latestProtocols = [], latestSource = 'unavailable', latestError = latest.error || null;
    if (activeImage && latest.version && latest.version !== activeVersion) {
      const image = candidateImage(activeImage, latest.version);
      if (image && exists(image)) {
        try { latestProtocols = readProtocols(image); latestSource = 'downloaded-package'; }
        catch { latestError = '新版包协议表读取失败'; }
      } else latestError = '此电脑尚无最新版安装包，需包下载完成或新版运行后检查';
    }
    return buildCompatibilityReport({ activeVersion, connected, catalog, activeProtocols,
      latestVersion: latest.version || null, latestProtocols, latestSource, activeError, latestError });
  } finally { desktop.close(); }
}
