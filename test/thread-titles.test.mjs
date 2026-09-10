import { fixtureEvidence } from "./fixtures/interface-evidence.mjs";
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Bridge } from '../src/bridge.mjs';
import { startServer } from '../src/server.mjs';
import { allowedRoute } from '../src/remote.mjs';
import { TOOLS, OFFICIAL } from '../src/official-protocol.mjs';
const id = '99999999-9999-4999-8999-999999999999';
function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bridge-title-')), b = new Bridge(dir), writes = [];
  const state = { title: '原会话名', kind: 'codex' };
  b.connected = true;
  b.desktop = { identity: { appToolsPipe: { image: 'OpenAI.Codex_26.903.8094.0_x64__fixture' } }, close() {},
    catalog: Object.values(TOOLS).map(name => ({ namespace: OFFICIAL.discovery.toolsNamespace, name,
      inputSchema: { properties: { model: { description: 'fixture (Fixture; supported reasoning efforts: low)' } } } })),
    call: async (name, args) => {
      if (name === TOOLS.readThread) return { thread: { id, kind: state.kind, title: state.title } };
      if (name === TOOLS.listThreads) return { threads: [{ id, kind: state.kind, title: state.title }] };
      if (name === TOOLS.setTitle) { writes.push({ name, args }); assert.equal(Object.values(b.db.requests).at(-1).status, 'outcome-unknown'); return { threadId: id, title: args.title }; }
      if (name === TOOLS.createThread) { writes.push({ name, args }); return { threadId: id, cwd: 'C:/fixture' }; }
      throw Error('Unexpected tool: ' + name);
    },
  };
  fixtureEvidence(b.desktop);
  b.follow = async () => {}; b.connect = async () => b.status(); b.disconnect = () => {};
  fs.writeFileSync(path.join(dir, 'update-settings.json'), '{"automatic":false}');
  t.after(() => { clearInterval(b.subscriptionTimer); fs.rmSync(dir, { recursive: true, force: true }); });
  return { b, dir, state, writes, body: { requestId: 'rename-fixture-001', title: '新会话名', expectedTitle: state.title } };
}
test('normal creation leaves title and projectless directory naming to the official app; no probe registration', async t => {
  const { b, writes } = fixture(t);
  await b.create('normal-create-01', '用户的第一条消息');
  assert.deepEqual(writes[0].args, { prompt: '用户的第一条消息', target: { type: 'projectless' } });
  assert.equal(Object.hasOwn(b.db.tests, id), false);
  await assert.rejects(b.create('missing-prompt-01'), /Invalid message/);
  assert.equal(writes.length, 1);
});
test('dedicated tests must explicitly opt in to probe naming and registration', async t => {
  const { b, writes } = fixture(t); await b.createProbe('explicit-probe-1', '专用测试，只回复 READY');
  assert.match(writes[0].args.title, /^RemoteBridge-Probe-/); assert.equal(writes[0].args.target.directoryName, writes[0].args.title);
  b.guardProbe(id);
});
test('rename forwards one explicit official metadata operation without local title override or task message', async t => {
  const { b, body, writes } = fixture(t);
  const result = await b.renameThread(id, body); assert.equal(result.status, 'accepted');
  assert.deepEqual(writes, [{ name: TOOLS.setTitle, args: { threadId: id, title: body.title } }]);
  assert.equal((await b.threads()).data.threads[0].title, body.expectedTitle, 'ACK must not change the official list');
  assert.equal((await b.renameThread(id, body)).deduplicated, true); assert.equal(writes.length, 1);
  assert.equal(b.status().threadTitles.rename, true);
});
test('changed title, wrong mode, invalid input, unsupported build and swapped desktop reject before rename', async t => {
  for (const change of ['title', 'chat', 'desktop', 'build']) {
    const { b, body, state, writes } = fixture(t), read = b.desktop.call;
    if (change === 'title') state.title = '在另一窗口刚改过';
    if (change === 'chat') state.kind = 'chatgpt';
    if (change === 'build') b.desktop.identity.appToolsPipe.image = 'OpenAI.Codex_99.0.0.0_x64__fixture';
    if (change === 'desktop') b.desktop.call = async (...args) => { const r = await read(...args); b.desktop = { ...b.desktop }; return r; };
    assert.equal((await b.renameThread(id, body)).status, 'not-sent', change); assert.equal(writes.length, 0);
  }
  for (const value of [{ title: '' }, { title: 'x'.repeat(201) }, { title: 'first\nsecond' }, { prompt: 'not a message' }, { expectedTitle: 3 }]) {
    const { b, body, writes } = fixture(t); assert.equal((await b.renameThread(id, { ...body, ...value })).status, 'not-sent'); assert.equal(writes.length, 0);
  }
});
test('lost rename reply remains unknown across restart and concurrent retries never repeat the write', async t => {
  const { b, dir, body } = fixture(t), original = b.desktop.call; let attempts = 0;
  b.desktop.call = async (name, args) => { if (name === TOOLS.setTitle) { attempts++; throw Error('lost acknowledgement'); } return original(name, args); };
  const results = await Promise.all([b.renameThread(id, body), b.renameThread(id, body)]); assert.ok(results.every(r => r.status === 'outcome-unknown'));
  const restart = new Bridge(dir); t.after(() => clearInterval(restart.subscriptionTimer)); restart.connected = true; restart.desktop = b.desktop;
  assert.equal((await restart.renameThread(id, body)).status, 'outcome-unknown'); assert.equal(attempts, 1);
});
test('list response from a replaced desktop connection cannot enter the new view', async t => {
  const { b } = fixture(t), original = b.desktop.call;
  b.desktop.call = async (...args) => { const r = await original(...args); b.desktop = { ...b.desktop }; return r; };
  await assert.rejects(b.threads(), /连接已变化/);
});
test('production rename route is authenticated POST-only for both local and remote use', async t => {
  const { b, body, writes } = fixture(t); const { server, address, secret } = await startServer({ port: 0, bridge: b });
  try {
    const route = '/api/threads/' + id + '/title';
    assert.equal(allowedRoute('POST', route), true); for (const method of ['GET', 'DELETE', 'PUT']) assert.equal(allowedRoute(method, route), false);
    const post = auth => fetch(address + route, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(auth ? { 'X-Bridge-CSRF': secret } : {}) }, body: JSON.stringify(body) });
    assert.equal((await post(false)).status, 403); assert.equal(writes.length, 0);
    assert.equal((await (await post(true)).json()).status, 'accepted'); assert.equal(writes.length, 1);
    assert.equal((await fetch(address + '/thread-menu.mjs')).status, 200);
  } finally { server.closeAllConnections(); await new Promise(r => server.close(r)); }
});
