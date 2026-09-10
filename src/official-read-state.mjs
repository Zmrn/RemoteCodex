import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { OFFICIAL, desktopCompatibility, supportedBuild } from './official-protocol.mjs';
import { PYTHON } from './runtime.mjs';

const object = value => !!value && typeof value === 'object' && !Array.isArray(value);
const unavailable = () => ({ status: 'unavailable', excludes: () => false });

// No account is guessed. Only absence from EVERY stored account/host partition
// excludes a task. A mark in another partition can retain a false positive, but
// can never clear the active account's unread task. This is a display snapshot,
// never a durable acknowledgement of any report token.
export function parseOfficialReadState(global) {
  const spec = OFFICIAL.storage.readState, state = global?.[spec.key];
  if (!object(state) || state.version !== spec.version || !object(state.unreadByIdentity)) return unavailable();
  const unread = new Set(); let hasLocalPartition = false;
  const addHosts = (hosts, include = true) => {
    if (!object(hosts)) throw Error('Invalid host map');
    for (const [host, ids] of Object.entries(hosts)) {
      if (!host || !Array.isArray(ids) || ids.some(id => typeof id !== 'string' || !id)) throw Error('Invalid unread IDs');
      if (include) for (const id of ids) unread.add(id);
    }
  };
  try {
    for (const [identity, hosts] of Object.entries(state.unreadByIdentity)) {
      if (!/^[a-f0-9]{64}$/.test(identity)) return unavailable();
      addHosts(hosts);
      if (Object.keys(hosts).some(host => host.startsWith(OFFICIAL.discovery.hostId + ':') && /^[a-f0-9]{64}$/.test(host.slice(OFFICIAL.discovery.hostId.length + 1)))) hasLocalPartition = true;
    }
    // Pending/old migration data can only keep a task unread, never clear it.
    if (state.legacyMigration !== undefined) {
      const legacy = state.legacyMigration;
      if (!object(legacy) || typeof legacy.identityKey !== 'string' || !object(legacy.adoptedHostIds)) return unavailable();
      if (!object(legacy.unreadThreadIdsByHostId) || Object.values(legacy.adoptedHostIds).some(v => typeof v !== 'string' || !v)) return unavailable();
      addHosts(legacy.unreadThreadIdsByHostId, false);
      if (legacy.cleared !== true) addHosts(Object.fromEntries(Object.entries(legacy.unreadThreadIdsByHostId).filter(([host]) => !Object.hasOwn(legacy.adoptedHostIds, host))));
    }
    const legacy = global?.[spec.atomKey]?.[spec.legacyKey];
    if (legacy !== undefined) addHosts(legacy, state.legacyMigration === undefined);
  } catch { return unavailable(); }
  if (!hasLocalPartition) return unavailable();
  return { status: 'available', excludes: id => typeof id === 'string' && !unread.has(id) };
}

function processMetadata(identity, includeIdentity = false) {
  if (!identity?.officialPid || !identity.appToolsPipe?.image) return Promise.resolve(null);
  return new Promise(resolve => {
    const child = execFile(PYTHON, [fileURLToPath(new URL('./official_home.py', import.meta.url))],
      { windowsHide: true, timeout: 2500, maxBuffer: 65536 }, (error, stdout) => {
        if (error) return resolve(null);
        try { const value = JSON.parse(stdout); resolve(typeof value.home === 'string' && path.isAbsolute(value.home) ? value : null); }
        catch { resolve(null); }
      });
    child.stdin.on('error', () => {});
    child.stdin.end(JSON.stringify({ pid: identity.officialPid, image: identity.appToolsPipe.image, identity: includeIdentity }));
  });
}
export const resolveOfficialHome = async identity => (await processMetadata(identity))?.home ?? null;

export class OfficialReadState {
  constructor(desktop, { homeResolver = resolveOfficialHome, now = Date.now } = {}) {
    this.desktop = desktop; this.homeResolver = homeResolver; this.now = now;
  }
  supported() {
    const image = this.desktop.identity?.appToolsPipe?.image;
    return supportedBuild(image) && OFFICIAL.storage.readState.verifiedVersions.includes(desktopCompatibility(image).detectedVersion);
  }
  async context() {
    if (!this.supported()) return null;
    const connection = this.desktop.identity, metadata = await processMetadata(connection, true);
    if (connection !== this.desktop.identity || !metadata?.identity || metadata.identity.kind !== 'chatgpt') return null;
    const identity = metadata.identity;
    if (![identity.accountId, identity.userId].every(v => typeof v === 'string' && v.length > 0 && v.length <= 256)) return null;
    const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
    return { home: metadata.home, identity, identityKey: hash([identity.kind, identity.accountId, identity.userId]),
      executionHostKey: OFFICIAL.discovery.hostId + ':' + hash(['local', OFFICIAL.discovery.hostId, null]) };
  }
  async marked(context, id) {
    if (!this.supported()) return null;
    const value = await this.document(context.home);
    if (parseOfficialReadState(value).status !== 'available') return null;
    const ids = value?.[OFFICIAL.storage.readState.key]?.unreadByIdentity?.[context.identityKey]?.[context.executionHostKey];
    return Array.isArray(ids) ? ids.includes(id) : null;
  }
  async snapshot() {
    const identity = this.desktop.identity, spec = OFFICIAL.storage.readState;
    if (!this.supported()) return { ...unavailable(), status: 'unsupported' };
    if (identity !== this.identity) { this.identity = identity; this.home = null; this.retryAt = 0; }
    if (!this.home && this.now() >= this.retryAt) {
      this.retryAt = this.now() + 60000;
      this.home = await this.homeResolver(identity).catch(() => null);
    }
    if (!this.home || this.desktop.identity !== identity) return unavailable();
    const value = await this.document(this.home);
    return this.desktop.identity === identity ? parseOfficialReadState(value) : unavailable();
  }
  async document(home) {
    const spec = OFFICIAL.storage.readState;
    let file;
    try {
      file = await fs.open(path.join(home, OFFICIAL.storage.globalStateFile), 'r');
      const before = await file.stat();
      if (!before.isFile() || before.size < 2 || before.size > spec.maxBytes) return null;
      const buffer = Buffer.alloc(before.size);
      let offset = 0;
      while (offset < buffer.length) {
        const { bytesRead } = await file.read(buffer, offset, buffer.length - offset, offset);
        if (!bytesRead) return null;
        offset += bytesRead;
      }
      const after = await file.stat();
      if (before.size !== after.size || before.mtimeMs !== after.mtimeMs) return null;
      return JSON.parse(buffer.toString('utf8'));
    } catch { return null; }
    finally { await file?.close().catch(() => {}); }
  }
}
