import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { Bridge, ROOT } from '../src/bridge.mjs';
import { Desktop } from '../src/desktop.mjs';
import { OFFICIAL, TOOLS, desktopPolicy, protocolRequest, protocolObservation } from '../src/official-protocol.mjs';
import { fixtureCatalog, fixtureProtocols } from './fixtures/interface-evidence.mjs';

const id = '55555555-5555-4555-8555-555555555555', owner = 'settings-owner';
async function fixture(t, version, reply = { applied: true }) {
  const protocols = fixtureProtocols(), catalog = fixtureCatalog(), calls = [];
  protocols[0].methods[OFFICIAL.ipc.settings.method] = version;
  const image = 'C:\\Program Files\\WindowsApps\\OpenAI.Codex_26.915.4065.0_x64__fixture\\app\\ChatGPT.exe';
  const pipes = [{ path: '\\\\.\\pipe\\codex-browser-use-fixture', pid: 1, image }, { path: '\\\\.\\pipe\\codex-ipc', pid: 1, image }];
  const desktop = new Desktop('fixture', { discoverPipes: async () => ({ pipes }), readProtocols: () => protocols,
    pipeFactory: (_p, kind) => {
      const pipe = new EventEmitter();
      pipe.connect = async () => { pipe.socket = { destroyed: false }; };
      pipe.close = () => { pipe.socket.destroyed = true; };
      pipe.broadcast = () => {};
      pipe.request = async (method, params, options) => {
        if (method === OFFICIAL.transport.toolsList) return { result: { tools: catalog } };
        calls.push({ method, params, options });
        if (kind === 'tools') return { result: { success: true, contentItems: [{ type: 'inputText', text: JSON.stringify({ threadId: id }) }] } };
        return { handledByClientId: owner, result: reply };
      };
      return pipe;
    } });
  await desktop.connect();
  fs.mkdirSync(path.join(ROOT, 'test/scratch'), { recursive: true });
  const b = new Bridge(fs.mkdtempSync(path.join(ROOT, 'test/scratch/settings-versions-')));
  b.desktop = desktop; b.connected = true;
  const state = { latestThreadSettings: { model: 'fixture-model' }, threadRuntimeStatus: { type: 'idle' }, id };
  b.codexThread = async () => ({ thread: { id, kind: 'codex', status: state.threadRuntimeStatus } });
  b.follow = async () => { b.live.set(id, { owner, state }); return { handledByClientId: owner }; };
  t.after(() => { clearInterval(b.subscriptionTimer); desktop.close(); });
  return { b, desktop, state, calls, protocols };
}

for (const version of [1, 2]) test(`settings v${version} uses the observed wire version and preserves next-turn semantics`, async t => {
  const f = await fixture(t, version, version === 2 ? { applied: true } : { ok: true });
  for (const kind of ['idle', 'active']) {
    f.state.threadRuntimeStatus.type = kind;
    const key = 'settings-' + kind;
    assert.equal((await f.b.updateSettings(id, key, { permissionMode: 'workspace' })).status, 'accepted');
    await f.b.updateSettings(id, key, { permissionMode: 'workspace' });
  }
  assert.equal(f.calls.length, 2);
  for (const call of f.calls) {
    assert.equal(call.options.version, version);
    assert.equal(call.options.targetClientId, owner);
    assert.deepEqual(call.params, { conversationId: id, threadSettings: { permissions: ':workspace' } });
  }
  assert.equal(f.state.latestThreadSettings.permissions, undefined, 'ACK must not manufacture live settings');
  assert.equal(desktopPolicy(f.desktop).features.createPermissions.supported, true);
  f.b.permissionContext = async mode => { assert.equal(mode, 'workspace'); return 'registered-settings-context'; };
  await f.b.create('create-workspace-01', 'synthetic', { permissionMode: 'workspace' });
  assert.equal(f.calls.at(-1).params.tool, TOOLS.createThread);
});

for (const reply of [{ applied: false }, {}, { applied: 'true' }]) test(`v2 rejects unconfirmed application ${JSON.stringify(reply)} and never starts or retries a message`, async t => {
  const f = await fixture(t, 2, reply);
  await assert.rejects(f.b.nativeSend(id, 'send-rejected-settings', 'synthetic', [], { permissionMode: 'workspace' }), /未应用|缺少应用确认/);
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].method, OFFICIAL.ipc.settings.method);
  await assert.rejects(f.b.nativeSend(id, 'send-rejected-settings', 'synthetic', [], { permissionMode: 'workspace' }), /设置结果未知/);
  assert.equal(f.calls.length, 1, 'uncertain setting write must not replay');
});

test('unknown or ambiguous settings versions block only dependent operations', async t => {
  const f = await fixture(t, 3);
  const p = desktopPolicy(f.desktop);
  assert.equal(p.features.settings.supported, false); assert.equal(p.features.createPermissions.supported, false);
  assert.equal(p.features.send.supported, true); assert.equal(p.features.create.supported, true);
  await assert.rejects(f.b.updateSettings(id, 'future-settings-01', { permissionMode: 'workspace' }), /v1 \/ v2/);
  assert.equal(f.calls.length, 0);
  assert.equal(protocolObservation([{ methods: { [OFFICIAL.ipc.settings.method]: 1 } }, { methods: { [OFFICIAL.ipc.settings.method]: 2 } }], OFFICIAL.ipc.settings).status, 'unknown');
});

test('reconnect reselects the protocol and rejects a stale owner connection', async t => {
  const f = await fixture(t, 2), stale = f.desktop.ipc;
  f.protocols[0].methods[OFFICIAL.ipc.settings.method] = 1;
  await f.desktop.connect();
  assert.throws(() => protocolRequest(stale, 'settings', {}), /connection changed/);
  await f.b.updateSettings(id, 'reconnected-settings', { permissionMode: 'read-only' });
  assert.equal(f.calls[0].options.version, 1);
  const follow = f.b.follow;
  f.b.follow = async () => { const result = await follow(); f.desktop.identity = { ...f.desktop.identity }; return result; };
  await assert.rejects(f.b.updateSettings(id, 'changed-settings-01', { permissionMode: 'workspace' }), /连接已变化/);
  assert.equal(f.calls.length, 1);
});
