import fs from 'node:fs';
import path from 'node:path';
import { Desktop } from './desktop.mjs';
import { OFFICIAL, CATALOG_SHA256, desktopCompatibility } from './official-protocol.mjs';
import { sourceProtocols } from './source-protocols.mjs';
import { interfaceObservations, protocolObservation, featurePolicy } from './official-protocol.mjs';
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
export function buildCompatibilityReport({ activeVersion = null, connected = false, ipcConnected = connected, catalog = [], activeProtocols = [],
  latestVersion = null, latestProtocols = [], latestSource = 'unavailable', activeError = null, latestError = null } = {}) {
  const same = !!latestVersion && activeVersion === latestVersion;
  const observations = interfaceObservations({ connected, ipcConnected, catalog, protocols: activeProtocols });
  const rows = Object.entries(OFFICIAL.tools).map(([id, spec]) => {
    const running = observations[id];
    return { id, kind: 'tool', name: spec.name, purpose: spec.purpose, expected: { request: spec.request }, running,
      latest: same ? running : unknown(latestVersion ? '需新版运行后读取工具参数' : '尚未取得官方最新版') };
  });
  for (const [id, spec] of Object.entries(OFFICIAL.ipc)) {
    const running = observations[id];
    const latest = same ? running : !latestVersion ? unknown('尚未取得官方最新版') : id === 'initialize' ? unknown('需新版运行后验证握手') : protocolObservation(latestProtocols, spec);
    rows.push({ id, kind: 'ipc', name: spec.method, purpose: spec.purpose, expected: { version: spec.version, request: spec.request }, running, latest });
  }
  const features = featurePolicy(observations), latestFeatures = featurePolicy(Object.fromEntries(rows.map(r => [r.id, r.latest])));
  const writable = f => ['send', 'resume', 'create', 'steer', 'queue', 'settings', 'rename', 'browserApproval', 'chatSend'].some(k => f[k].supported);
  return { policy: 'per-feature-interfaces', features, latestFeatures, schemaVersion: 1, checkedAt: new Date().toISOString(), remoteVersion: INSTANCE.version, catalogSha256: CATALOG_SHA256,
    active: { version: activeVersion, connected, writeSupported: writable(features), behaviorVerified: OFFICIAL.support.verifiedVersions.includes(activeVersion),
      readStateSupported: features.readReceipt.supported, error: activeError },
    latest: { version: latestVersion, source: same ? 'running' : latestSource, error: latestError,
      writeSupported: writable(latestFeatures), behaviorVerified: OFFICIAL.support.verifiedVersions.includes(latestVersion),
      readStateSupported: latestFeatures.readReceipt.supported },
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
    return buildCompatibilityReport({ activeVersion, connected, ipcConnected: desktop.ipc !== null, catalog, activeProtocols,
      latestVersion: latest.version || null, latestProtocols, latestSource, activeError, latestError });
  } finally { desktop.close(); }
}
