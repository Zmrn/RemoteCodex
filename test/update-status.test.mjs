import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { generateKeyPairSync, sign, createHash } from 'node:crypto';
import { Updater } from '../src/updater.mjs';
import { verifyManifest } from '../src/update-format.mjs';
import { updateView } from '../public/update-view.mjs';

const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
function candidate(version, fill = 0) {
  const raw = Buffer.alloc(2048, fill); raw.write('MZ');
  const manifest = { schema: 1, platform: 'windows-x64', file: 'RemoteCodex.exe', version,
    bytes: raw.length, sha256: createHash('sha256').update(raw).digest('hex') };
  const payload = Buffer.from(JSON.stringify(manifest));
  return { raw, manifest, envelope: { payload: payload.toString('base64'), signature: sign('sha256', payload, privateKey).toString('base64') } };
}
function fixture(t) {
  fs.mkdirSync('test/scratch', { recursive: true });
  const dir = fs.mkdtempSync(path.resolve('test/scratch/update-status-'));
  fs.writeFileSync(path.join(dir, 'update-settings.json'), '{"automatic":false}');
  let verifications = 0;
  const create = () => new Updater(dir, () => {}, { verifyUpdateManifest: e => { verifications++; return verifyManifest(e, publicKey); } });
  const updater = create(); updater.supported = true;
  fs.mkdirSync(updater.dir, { recursive: true });
  const file = path.join(updater.dir, 'ready.exe'), metadata = path.join(updater.dir, 'ready-manifest.json');
  const save = c => { fs.writeFileSync(file, c.raw); fs.writeFileSync(metadata, JSON.stringify(c.envelope)); };
  t.after(() => updater.close());
  return { updater, create, save, file, metadata, count: () => verifications };
}

test('downloaded version follows its verified candidate, independently of latest and restart', t => {
  const f = fixture(t), old = candidate('0.10.30'), latest = candidate('0.10.31', 1);
  f.save(old); f.updater.latest = latest.manifest;
  let state = f.updater.status();
  assert.equal(state.latestVersion, '0.10.31'); assert.equal(state.downloadedVersion, '0.10.30');
  assert.equal(state.packageState, 'verified');
  const count = f.count(); f.updater.status(); assert.equal(f.count(), count);
  const restarted = f.create();
  assert.equal(restarted.status().downloadedVersion, '0.10.30');
  assert.equal(restarted.status().latestVersion, null);
  assert.equal(restarted.status().checkedAt, null);
  // Model coarse hosted Windows clocks deterministically, without sleeps.
  const realStat = fs.statSync.bind(fs), frozen = new Map([f.file, f.metadata].map(p => [p, realStat(p, { bigint: true })]));
  t.mock.method(fs, 'statSync', (p, options) => frozen.get(p) || realStat(p, options));
  f.save(latest); assert.equal(f.updater.status().downloadedVersion, '0.10.31');
  restarted.close();
});

test('missing, forged, mismatched and damaged cached candidates never report a verified version', t => {
  const f = fixture(t), c = candidate('0.10.30');
  assert.equal(f.updater.status().packageState, 'none');
  fs.writeFileSync(f.file, c.raw);
  assert.equal(f.updater.status().packageState, 'unverified');
  f.save(c); fs.writeFileSync(f.metadata, JSON.stringify({ ...c.envelope, signature: 'forged' }));
  assert.equal(f.updater.status().downloadedVersion, null);
  const count = f.count(); f.updater.status(); assert.ok(f.count() > count, 'failed verification must not prevent a repair being rechecked');
  f.save(c); fs.writeFileSync(f.file, candidate('0.10.31', 1).raw);
  assert.equal(f.updater.status().downloadedVersion, null);
  f.save(c); assert.equal(f.updater.status().downloadedVersion, '0.10.30');
  fs.appendFileSync(f.file, 'damage');
  assert.equal(f.updater.status().packageState, 'unverified');
  fs.unlinkSync(f.file); assert.equal(f.updater.status().packageState, 'none');
});

test('production download records its signed version only after validation and preserves old package on failure', async t => {
  const f = fixture(t), old = candidate('0.10.30'), next = candidate('0.10.31', 1), later = candidate('0.10.32', 2);
  f.save(old); f.updater.latest = next.manifest; f.updater.envelope = next.envelope;
  const original = globalThis.fetch; t.after(() => { globalThis.fetch = original; });
  let release;
  globalThis.fetch = async url => {
    assert.match(String(url), /\/v0\.10\.31\/RemoteCodex\.exe$/);
    await new Promise(resolve => { release = resolve; });
    return new Response(next.raw);
  };
  let state = f.updater.install();
  assert.equal(state.downloadVersion, '0.10.31'); assert.equal(state.downloadedVersion, '0.10.30');
  release();
  for (let i=0; f.updater.installing && i<100; i++) await new Promise(r => setTimeout(r, 10));
  assert.equal(f.updater.installing, false);
  assert.equal(f.updater.status().downloadedVersion, '0.10.31');
  assert.equal(f.updater.status().downloadVersion, null);
  assert.equal(f.create().status().downloadedVersion, '0.10.31');
  f.updater.latest = later.manifest; f.updater.envelope = later.envelope;
  globalThis.fetch = async () => new Response('incomplete');
  f.updater.install();
  for (let i=0; f.updater.installing && i<100; i++) await new Promise(r => setTimeout(r, 10));
  state = f.updater.status();
  assert.equal(state.phase, 'error'); assert.equal(state.downloadVersion, null);
  assert.equal(state.latestVersion, '0.10.32'); assert.equal(state.downloadedVersion, '0.10.31');
  assert.match(updateView(state).relation, /较旧/);
});

test('failed remote check retains only the previously confirmed manifest and timestamp', async t => {
  const f = fixture(t), c = candidate('0.10.31');
  const original = globalThis.fetch; t.after(() => { globalThis.fetch = original; });
  globalThis.fetch = async () => Response.json(c.envelope);
  const state = await f.updater.check(); assert.equal(state.latestVersion, '0.10.31');
  assert.ok(Date.parse(state.checkedAt));
  globalThis.fetch = async () => Response.json({ ...c.envelope, signature: 'invalid' });
  await assert.rejects(f.updater.check(), /签名/);
  assert.equal(f.updater.status().checkedAt, state.checkedAt);
  assert.equal(f.updater.status().latestVersion, state.latestVersion);
  assert.equal(f.updater.status().phase, 'error');
});

test('shared update presentation distinguishes current, latest, downloading, ready and legacy unknown states', () => {
  const state = { currentVersion: '0.10.29', latestVersion: '0.10.30', downloadedVersion: '0.10.30',
    checkedAt: '2026-09-10T08:00:00Z', packageState: 'verified', platform: 'android', phase: 'waiting', available: true, supported: true };
  let view = updateView(state);
  assert.deepEqual(view.rows, [['当前安装','0.10.29'],['远端最新','0.10.30'],['已下载','0.10.30 · 已校验']]);
  assert.equal(view.installLabel, '安装 0.10.30'); assert.match(view.relation, /一致/);
  assert.match(view.checked, /上次确认/); assert.match(view.label, /Android/);
  view = updateView({ ...state, latestVersion: '0.10.31', phase: 'downloading', downloadVersion: '0.10.31', progress: 23 });
  assert.match(view.label, /0.10.31.*23%/); assert.equal(view.installDisabled, true);
  assert.deepEqual(view.rows[2], ['正在下载', '0.10.31']); assert.match(view.relation, /较旧/);
  assert.equal(view.installLabel, '下载并安装 0.10.31');
  view = updateView({ ...state, downloadedVersion: undefined, packageState: undefined, checkedAt: undefined });
  assert.deepEqual(view.rows.at(-1), ['已下载', '版本未确认']); assert.equal(view.relation, '');
  assert.match(view.checked, /尚无/);
  assert.equal(updateView({ ...state, phase: 'checking' }).installDisabled, true);
  assert.equal(updateView({ ...state, phase: 'verifying' }).active, true);
  assert.equal(updateView({ ...state, checkedAt: Date.parse(state.checkedAt) }).checked, updateView(state).checked);
  assert.equal(updateView({ ...state, phase: 'error', error: '检查失败' }).label, '检查失败');
  assert.match(updateView({ ...state, currentVersion: '0.10.31', phase: 'current' }).label, /高于/);
  assert.deepEqual(updateView({ packageState: 'none' }).rows, [['当前安装','未知'],['远端最新','尚未确认'],['已下载','暂无安装包']]);
});
