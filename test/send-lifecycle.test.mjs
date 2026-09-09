import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Bridge } from '../src/bridge.mjs';
const id = '11111111-1111-4111-8111-111111111111';
function fixture(t, kind) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bridge-dispatch-'));
  const bridge = new Bridge(dir), state = { type: 'active' }, calls = [];
  bridge.connected = true;
  bridge.desktop = {
    close() {},
    identity: { officialPid: 123, appToolsPipe: { image: 'OpenAI.Codex_26.901.6511.0_x64__fixture' } },
    catalog: ['read_thread', 'list_threads', 'send_message_to_thread'].map(name => ({ namespace: 'codex_app', name, inputSchema: { properties: { model: { description: 'fixture-model (Fixture; supported reasoning efforts: low)' } } } })),
    call: async (name, args) => {
      calls.push(name);
      if (name === 'read_thread') return { thread: { id, kind, status: { ...state } } };
      assert.equal(bridge.db.requests['send-once-001'].status, 'outcome-unknown');
      if (state.failDispatch) throw Error('pipe lost after dispatch');
      return { threadId: args.threadId };
    },
    owner: async () => ({ handledByClientId: 'fixture-owner' }),
    ipc: { broadcast() {}, request: async () => {
      calls.push('native-start');
      assert.equal(bridge.db.requests['send-once-001'].status, 'outcome-unknown');
      if (state.failDispatch) throw Error('pipe lost after dispatch');
      return { handledByClientId: 'fixture-owner' };
    } },
  };
  t.after(() => { bridge.connected = false; bridge.disconnect(); fs.rmSync(dir, { recursive: true }); });
  return { bridge, state, calls, send: () => kind === 'chatgpt' ? bridge.chatSend(id, 'send-once-001', 'synthetic prompt') : bridge.nativeSend(id, 'send-once-001', 'synthetic prompt') };
}
for (const kind of ['chatgpt', 'codex']) {
  test(kind + ': pre-dispatch rejection can retry the same request and accepted retries never dispatch again', async t => {
    const { bridge, state, calls, send } = fixture(t, kind);
    await assert.rejects(send());
    assert.equal(bridge.db.requests['send-once-001'].status, 'rejected');
    state.type = 'idle';
    const results = await Promise.all([send(), send()]);
    assert.ok(results.every(x => x.status === 'accepted'));
    state.type = 'active';
    assert.equal((await send()).status, 'accepted');
    assert.equal(calls.filter(x => ['native-start', 'send_message_to_thread'].includes(x)).length, 1);
    assert.ok(!fs.readFileSync(bridge.stateFile, 'utf8').includes('synthetic prompt'));
  });
  test(kind + ': a lost dispatch acknowledgement is never retried, including after restart', async t => {
    const { bridge, state, calls, send } = fixture(t, kind);
    state.type = 'idle'; state.failDispatch = true;
    await assert.rejects(send(), /pipe lost/);
    bridge.db = JSON.parse(fs.readFileSync(bridge.stateFile));
    assert.equal((await send()).status, 'outcome-unknown');
    assert.equal(calls.filter(x => ['native-start', 'send_message_to_thread'].includes(x)).length, 1);
  });
}
test('new-task permission preparation failure remains retryable without duplicating creation', async t => {
  const { bridge } = fixture(t, 'codex'); let ready = false, creates = 0;
  bridge.permissionContext = async () => { if (!ready) throw Error('preparation unavailable'); return 'fixture-context'; };
  bridge.desktop.call = async name => { assert.equal(name, 'create_thread'); creates++; assert.equal(bridge.db.requests['create-once-001'].status, 'outcome-unknown'); return { threadId: id }; };
  const create = () => bridge.create('create-once-001', 'synthetic first prompt', { permissionMode: 'read-only' });
  await assert.rejects(create(), /preparation unavailable/);
  assert.equal(bridge.db.requests['create-once-001'].status, 'rejected'); assert.equal(creates, 0);
  ready = true;
  assert.equal((await create()).status, 'accepted');
  assert.equal((await create()).deduplicated, true); assert.equal(creates, 1);
});
