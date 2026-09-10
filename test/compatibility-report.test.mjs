import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { buildCompatibilityReport, collectCompatibilityReport, candidateImage, latestOfficialVersion } from '../src/compatibility-report.mjs';
import { OFFICIAL } from '../src/official-protocol.mjs';
import { compatibilityExport, rowStatus } from '../public/compatibility-view.mjs';
import { allowedRoute } from '../src/remote.mjs';
import { startServer } from '../src/server.mjs';

const version = OFFICIAL.support.verifiedVersions.at(-1), latest = '99.1.2.3';
const image = `C:\\Program Files\\WindowsApps\\OpenAI.Codex_${version}_x64__fixture\\app\\ChatGPT.exe`;
const catalog = () => Object.values(OFFICIAL.tools).map(s => ({ name: s.name, namespace: OFFICIAL.discovery.toolsNamespace,
  inputSchema: { properties: Object.fromEntries(s.request.map(k => [k, {}])) } }));
const protocols = () => [{ methods: Object.fromEntries(Object.values(OFFICIAL.ipc).filter(s => s.method !== 'initialize').map(s => [s.method, s.version])) }];
const fixture = () => ({ activeVersion: version, connected: true, catalog: catalog(), activeProtocols: protocols(), latestVersion: version });

test('report checks only used interfaces and ignores unrelated official additions', () => {
  const input = fixture(), baseline = buildCompatibilityReport(input);
  input.catalog.push({ namespace: 'codex_app', name: 'new_unrelated_tool', inputSchema: { properties: {} } });
  input.activeProtocols[0].methods['unused-changed-protocol'] = 500;
  input.catalog[0].inputSchema.properties.unusedOptionalField = {};
  const report = buildCompatibilityReport(input);
  assert.equal(report.rows.length, Object.keys(OFFICIAL.tools).length + Object.keys(OFFICIAL.ipc).length);
  assert.deepEqual(report.rows.map(r => [r.name, rowStatus(r)]), baseline.rows.map(r => [r.name, rowStatus(r)]));
  assert.ok(report.rows.every(r => rowStatus(r) === 'ok'));
  assert.equal(report.checkScope, 'used-interfaces-only');
});

test('missing command, missing used parameter and changed protocol are precise red rows', () => {
  const input = fixture();
  input.catalog = input.catalog.filter(t => t.name !== OFFICIAL.tools.usage.name);
  delete input.catalog.find(t => t.name === OFFICIAL.tools.readThread.name).inputSchema.properties.threadId;
  input.activeProtocols[0].methods[OFFICIAL.ipc.interrupt.method] = 10;
  const report = buildCompatibilityReport(input), bad = report.rows.filter(r => rowStatus(r) === 'error');
  assert.deepEqual(new Set(bad.map(r => r.id)), new Set(['usage', 'readThread', 'interrupt']));
  assert.deepEqual(bad.find(r => r.id === 'readThread').running.missingFields, ['threadId']);
  assert.equal(bad.find(r => r.id === 'interrupt').running.version, 10);
});

test('unavailable, unreadable and ambiguous protocol evidence stays unknown', () => {
  const input = { ...fixture(), latestVersion: latest, latestProtocols: [] };
  let report = buildCompatibilityReport(input);
  assert.ok(report.rows.every(r => rowStatus(r) === 'warning'));
  assert.equal(report.latest.writeSupported, false);
  input.latestProtocols = protocols();
  delete input.latestProtocols[0].methods[OFFICIAL.ipc.interrupt.method];
  report = buildCompatibilityReport(input);
  assert.equal(report.rows.find(r => r.id === 'interrupt').latest.status, 'missing');
  input.latestProtocols[0].methods[OFFICIAL.ipc.interrupt.method] = NaN;
  assert.equal(buildCompatibilityReport(input).rows.find(r => r.id === 'interrupt').latest.status, 'unknown');
  input.latestProtocols = [...protocols(), { methods: { [OFFICIAL.ipc.interrupt.method]: 99 } }];
  assert.equal(buildCompatibilityReport(input).rows.find(r => r.id === 'interrupt').latest.status, 'unknown');
});

test('downloaded latest compares IPC only; live tools are never attributed to a different version', () => {
  const report = buildCompatibilityReport({ ...fixture(), latestVersion: latest, latestSource: 'downloaded-package', latestProtocols: protocols() });
  assert.ok(report.rows.filter(r => r.kind === 'tool' || r.id === 'initialize').every(r => r.latest.status === 'unknown'));
  assert.ok(report.rows.filter(r => r.kind === 'ipc' && r.id !== 'initialize').every(r => r.latest.status === 'matched'));
  assert.equal(report.latest.source, 'downloaded-package');
  assert.equal(report.taskWrites, 0);
});

test('candidate package path comes only from a WindowsApps sibling of the identified product', () => {
  assert.match(candidateImage(image, latest), /OpenAI\.Codex_99\.1\.2\.3_x64__fixture\\app\\ChatGPT.exe$/);
  for (const invalid of ['../1.2.3.4', '1.2.3.4/other', '', '1.2.3']) assert.equal(candidateImage(image, invalid), null);
  for (const invalid of ['C:/temp/app/ChatGPT.exe', image.replace('OpenAI.Codex_', 'Other_'), image.replace('WindowsApps', 'temp')])
    assert.equal(candidateImage(invalid, latest), null);
});

test('latest version uses fixed public manifest and rejects invalid identity, version and oversized bodies', async () => {
  const manifest = { schemaVersion: 1, packageIdentity: 'OpenAI.Codex', buildVersion: latest };
  const fetcher = async (url, opts) => {
    assert.equal(url, OFFICIAL.updateDiscovery.manifestUrl); assert.equal(opts.redirect, 'error');
    assert.deepEqual(opts.headers, { Accept: 'application/json' });
    return new Response(JSON.stringify(manifest));
  };
  assert.equal(await latestOfficialVersion(fetcher), latest);
  for (const body of [JSON.stringify({ ...manifest, packageIdentity: 'Other' }), JSON.stringify({ ...manifest, buildVersion: '../bad' }), 'x'.repeat(16001)])
    await assert.rejects(latestOfficialVersion(async () => new Response(body)));
  await assert.rejects(latestOfficialVersion(async () => new Response('', { status: 503 })));
});

test('collector opens and closes an independent connection, performs no task calls and projects safe metadata', async () => {
  let closed = 0; const read = [];
  const desktop = { catalog: catalog(), identity: { appToolsPipe: { image } }, connect: async options => { assert.equal(options.inspectCatalog, true); }, close: () => closed++,
    call: () => { throw Error('task calls forbidden'); } };
  const report = await collectCompatibilityReport({ createDesktop: () => desktop, getLatest: async () => latest,
    readProtocols: file => { read.push(file); return protocols(); }, exists: () => true });
  assert.equal(closed, 1); assert.equal(read.length, 2);
  assert.equal(report.latest.source, 'downloaded-package');
  const text = compatibilityExport({ ...report, secret: 'secret-fixture', path: image, taskContent: 'private-fixture' });
  assert.doesNotMatch(text, /secret-fixture|private-fixture|Program Files|WindowsApps/);
  assert.equal(JSON.parse(text).taskWrites, 0);
});

test('connection or network failures retain partial results without raw errors or persistence', async () => {
  let closed = 0;
  const report = await collectCompatibilityReport({ createDesktop: () => ({ connect: async () => { throw Error('private-path'); }, close: () => closed++ }),
    getLatest: async () => { throw Error('private-url'); } });
  assert.equal(closed, 1); assert.equal(report.active.connected, false); assert.equal(report.latest.version, null);
  assert.ok(report.rows.every(r => rowStatus(r) === 'warning'));
  assert.doesNotMatch(JSON.stringify(report), /private-path|private-url/);
});

test('production server serves the shared module and coalesces only authenticated GET reports', async () => {
  fs.mkdirSync('test/scratch', { recursive: true });
  const dir = fs.mkdtempSync(path.resolve('test/scratch/compatibility-http-'));
  fs.writeFileSync(path.join(dir, 'update-settings.json'), '{"automatic":false}');
  let count = 0, finish;
  const { server, address, secret } = await startServer({ port: 0,
    bridge: { dataDir: dir, on() {}, off() {}, connect: async () => {}, disconnect() {} },
    compatibilityReport: () => { count++; return new Promise(resolve => { finish = resolve; }); } });
  try {
    const asset = await fetch(address + '/compatibility-view.mjs');
    assert.match(asset.headers.get('content-type'), /javascript/); assert.match(await asset.text(), /class CompatibilityView/);
    const denied = await fetch(address + '/api/compatibility/report'); assert.equal(denied.status, 403);
    const headers = { 'X-Bridge-CSRF': secret };
    const a = fetch(address + '/api/compatibility/report', { headers });
    const b = fetch(address + '/api/compatibility/report', { headers });
    for (let i = 0; i < 100 && !finish; i++) await new Promise(r => setTimeout(r, 5));
    await new Promise(r => setTimeout(r, 30));
    assert.equal(count, 1); finish(buildCompatibilityReport(fixture()));
    for (const response of await Promise.all([a,b])) assert.equal((await response.json()).rows.length, Object.keys(OFFICIAL.tools).length + Object.keys(OFFICIAL.ipc).length);
    assert.equal((await fetch(address + '/api/compatibility/report', { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: '{}' })).status, 404);
    assert.equal(allowedRoute('GET', '/api/compatibility/report'), true);
    assert.equal(allowedRoute('POST', '/api/compatibility/report'), false);
  } finally { finish?.(buildCompatibilityReport()); server.closeAllConnections(); await new Promise(r => server.close(r)); }
});
