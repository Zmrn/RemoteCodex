import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { Desktop } from '../src/desktop.mjs';
import { Bridge } from '../src/bridge.mjs';
import { startServer } from '../src/server.mjs';
import { OFFICIAL, TOOLS, desktopPolicy, requireFeature, protocolRequest } from '../src/official-protocol.mjs';
import { buildCompatibilityReport } from '../src/compatibility-report.mjs';
import { fixtureCatalog, fixtureProtocols } from './fixtures/interface-evidence.mjs';

const id = '11111111-2222-4333-8444-555555555555', owner = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
async function fixture(t, { missing = [], changed = [], handshakeFails = false, version = '26.903.9818.0' } = {}) {
  const catalog = fixtureCatalog().filter(s => !missing.some(k => OFFICIAL.tools[k]?.name === s.name)), protocols = fixtureProtocols();
  for (const key of changed) protocols[0].methods[OFFICIAL.ipc[key].method]++;
  const image = `C:\\Program Files\\WindowsApps\\OpenAI.Codex_${version}_x64__fixture\\app\\ChatGPT.exe`;
  const pipes = [{ path: '\\\\.\\pipe\\codex-browser-use-fixture', pid: 100, image }, { path: '\\\\.\\pipe\\codex-ipc', pid: 100, image }];
  const calls = [], state = { type: 'idle' };
  const desktop = new Desktop('fixture-context', {
    discoverPipes: async () => ({ pipes }), readProtocols: () => protocols,
    pipeFactory: (_path, kind) => {
      const pipe = new EventEmitter();
      pipe.connect = async () => { pipe.socket = { destroyed: false }; if (kind === 'desktop' && handshakeFails) throw Error('handshake fixture'); };
      pipe.close = () => { if (pipe.socket) pipe.socket.destroyed = true; };
      pipe.broadcast = () => {};
      pipe.request = async (method, params) => {
        if (method === OFFICIAL.transport.toolsList) return { result: { tools: structuredClone(catalog) } };
        if (method === OFFICIAL.transport.toolsCall) {
          calls.push(params.tool);
          const value = params.tool === TOOLS.readThread ? { thread: { id, kind: 'codex', title: '原名', cwd: 'C:/fixture', status: { type: state.type } }, turns: [] }
            : params.tool === TOOLS.listThreads ? { threads: [] } : { threadId: id };
          return { result: { success: true, contentItems: [{ type: 'inputText', text: JSON.stringify(value) }] } };
        }
        calls.push(method);
        return { handledByClientId: owner, result: { result: { turn: { id: 'turn' }, turnId: 'turn' } } };
      };
      return pipe;
    },
  });
  await desktop.connect();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'feature-policy-')), b = new Bridge(dir);
  b.desktop = desktop; b.connected = true;
  b.follow = async () => { b.live.set(id, { owner, state: { id, turns: [{ turnId: 'turn', status: 'inProgress' }], threadRuntimeStatus: { type: state.type } } }); return { handledByClientId: owner }; };
  t.after(() => { clearInterval(b.subscriptionTimer); desktop.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  return { b, desktop, calls, state, catalog, protocols, version, dir };
}

test('new unlisted version with matching interfaces enables implemented features; report and live status agree', async t => {
  const f = await fixture(t), policy = desktopPolicy(f.desktop);
  assert.equal(policy.behaviorVerified, false);
  assert.ok(Object.values(policy.features).every(f => f.supported));
  const report = buildCompatibilityReport({ activeVersion: f.version, latestVersion: f.version, connected: true, catalog: f.catalog, activeProtocols: f.protocols });
  assert.deepEqual(report.features, f.b.status().capabilities);
  assert.ok(report.rows.every(r => r.running.status === 'matched'));
  await f.b.nativeSend(id, 'feature-send-001', 'synthetic');
  await f.b.create('feature-create-001', 'synthetic');
  assert.equal(f.calls.filter(k => k === OFFICIAL.ipc.start.method).length, 1);
  assert.equal(f.calls.filter(k => k === TOOLS.createThread).length, 1);
});

test('rename failure disables only dependent features even on a historically verified version', async t => {
  const f = await fixture(t, { missing: ['setTitle'], version: OFFICIAL.support.verifiedVersions.at(-1) });
  assert.equal(f.b.status().threadTitles.rename, false);
  assert.equal(f.b.status().capabilities.send.supported, true);
  const result = await f.b.renameThread(id, { requestId: 'rename-missing-01', title: '新名', expectedTitle: '原名' });
  assert.equal(result.status, 'not-sent'); assert.equal(f.calls.length, 0);
  await f.b.nativeSend(id, 'healthy-send-001', 'synthetic');
  await f.b.create('healthy-create-01', 'synthetic');
  assert.ok(!f.calls.includes(TOOLS.setTitle));
});

test('missing queue protocol rejects before withdrawal but direct steering and idle sending still work', async t => {
  const f = await fixture(t, { changed: ['queueWrite'] }); f.state.type = 'active';
  for (const action of ['enqueue', 'take', 'delete', 'steer']) await assert.rejects(
    f.b.queue.mutate(id, 'bad-queue-' + action, { action }), /queue|queued/);
  assert.equal(f.calls.length, 0); assert.deepEqual(f.b.db.queueRecoveries ?? {}, {});
  await f.b.nativeSteer(id, 'healthy-steer-01', 'synthetic', [], 'turn');
  f.state.type = 'idle'; await f.b.nativeSend(id, 'healthy-idle-001', 'synthetic');
  assert.ok(!f.calls.includes(OFFICIAL.ipc.queueWrite.method));
});

test('missing native start preserves resume, create, stop and readable content', async t => {
  const f = await fixture(t, { changed: ['start'] });
  assert.equal(f.b.status().capabilities.send.supported, false);
  assert.equal(f.b.status().interrupt.supported, true);
  await assert.rejects(f.b.nativeSend(id, 'blocked-native-1', 'synthetic'), /start-turn/);
  assert.ok(!f.calls.includes(OFFICIAL.ipc.start.method));
  f.state.type = 'notLoaded'; await f.b.nativeSend(id, 'working-resume-1', 'synthetic');
  await f.b.create('working-create-1', 'synthetic');
  await f.b.read(id);
});

test('missing list or project tool does not prevent connection, read, send or projectless creation', async t => {
  const f = await fixture(t, { missing: ['listThreads', 'listProjects'] });
  assert.equal(f.b.status().connected, true); assert.equal(f.b.status().projectCreation.local, false);
  await assert.rejects(f.b.threads(), /list_threads/); await assert.rejects(f.b.projects(), /list_projects/);
  await f.b.read(id); await f.b.nativeSend(id, 'listless-send-01', 'synthetic'); await f.b.create('listless-create1', 'synthetic');
});

test('owner handshake failure leaves official app-tools usable without using unconfirmed owner protocols', async t => {
  const f = await fixture(t, { handshakeFails: true });
  assert.equal(f.desktop.ipc, null);
  assert.equal(f.b.status().capabilities.send.supported, false);
  assert.equal(f.b.status().capabilities.create.supported, true);
  assert.equal(f.b.status().capabilities.read.supported, true);
  await f.b.threads(); await f.b.read(id); await f.b.create('tools-only-new01', 'synthetic');
  assert.ok(!f.calls.includes(OFFICIAL.ipc.start.method));
});

test('missing send-message schema blocks resume and Chat but default native send and create remain usable', async t => {
  const f = await fixture(t, { missing: ['sendMessage'] });
  assert.equal(f.b.status().capabilities.resume.supported, false);
  assert.equal(f.b.status().chat.sendText, false);
  await f.b.nativeSend(id, 'no-model-send-01', 'synthetic');
  await f.b.create('no-model-new-001', 'synthetic');
  assert.ok(!f.calls.includes(TOOLS.sendMessage));
});

test('missing required request field and mismatched IPC are enforced at transport boundaries', async t => {
  const f = await fixture(t, { changed: ['interrupt'] });
  delete f.catalog.find(t => t.name === TOOLS.readThread).inputSchema.properties.threadId;
  await f.desktop.refreshCatalog();
  await assert.rejects(f.b.read(id), /threadId/);
  assert.throws(() => protocolRequest(f.desktop.ipc, 'interrupt', { conversationId: id }), /预期 v4/);
  assert.equal(f.calls.length, 0);
  await f.b.create('readless-new-001', 'synthetic');
});

test('unread synchronization and website approvals have independent dependency failures', async t => {
  const f = await fixture(t, { changed: ['readStateChanged', 'mcpElicitation'] }), status = f.b.status();
  assert.equal(status.taskSummary.readReceipts, false); assert.equal(status.browserApprovals.supported, false);
  assert.equal(status.capabilities.taskState.supported, true); assert.equal(status.capabilities.questions.supported, true);
  assert.equal(status.capabilities.send.supported, true);
});

test('latest package mismatch never controls current running permissions', async t => {
  const f = await fixture(t), future = fixtureProtocols(); future[0].methods[OFFICIAL.ipc.start.method]++;
  const r = buildCompatibilityReport({ activeVersion: f.version, connected: true, catalog: f.catalog, activeProtocols: f.protocols,
    latestVersion: '99.1.2.3', latestProtocols: future });
  assert.equal(r.features.send.supported, true); assert.equal(r.latestFeatures.send.supported, false);
  await f.b.nativeSend(id, 'current-version1', 'synthetic');
});

test('catalog refresh, closed connections and changed identity cannot reuse an older permission observation', async t => {
  const f = await fixture(t), stale = f.desktop.ipc;
  f.catalog.splice(f.catalog.findIndex(t => t.name === TOOLS.setTitle), 1);
  await f.desktop.refreshCatalog();
  assert.throws(() => requireFeature(f.desktop, 'rename'), /set_thread_title/);
  assert.doesNotThrow(() => requireFeature(f.desktop, 'send'));
  f.desktop.identity = { ...f.desktop.identity };
  assert.throws(() => requireFeature(f.desktop, 'send'), /当前连接证据/);
  await f.desktop.connect(); assert.doesNotThrow(() => requireFeature(f.desktop, 'send'));
  assert.throws(() => protocolRequest(stale, 'start', {}), /connection changed/);
  f.desktop.close(); assert.throws(() => requireFeature(f.desktop, 'send'), /当前连接证据/);
});

test('HTTP status and actual mutation routes share feature decisions without side effects from rejected actions', async t => {
  const f = await fixture(t, { missing: ['setTitle'] });
  fs.writeFileSync(path.join(f.dir, 'update-settings.json'), '{"automatic":false}');
  f.b.disconnect = () => {};
  const { server, address: url, secret } = await startServer({ bridge: f.b, port: 0 }); t.after(() => server.close());
  const headers = { 'Content-Type': 'application/json', 'X-Bridge-CSRF': secret };
  const status = await fetch(url + '/api/status', { headers }).then(r => r.json()); assert.equal(status.capabilities.rename.supported, false);
  const response = await fetch(url + '/api/threads/' + id + '/messages', { method: 'POST', headers,
    body: JSON.stringify({ requestId: 'http-good-send01', prompt: 'synthetic' }) });
  assert.equal(response.status, 200); assert.equal((await response.json()).status, 'accepted');
});
