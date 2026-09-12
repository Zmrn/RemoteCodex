import test from 'node:test';
import assert from 'node:assert/strict';
import { markOfficialReportRead } from '../src/official-report-read.mjs';
import { reportReceipt } from '../src/task-reports.mjs';
import { OFFICIAL } from '../src/official-protocol.mjs';
const id = '11111111-1111-4111-8111-111111111111';
function fixture() {
  const item = { id: 'item', type: 'agentMessage', text: 'fixture response' };
  const data = { thread: { id, kind: 'codex', status: { type: 'idle' } }, turns: [{ id: 'turn', startedAt: 1, status: 'completed', items: [item] }] };
  const state = { id, threadRuntimeStatus: { type: 'idle' }, turnHistory: { history: { entitiesByKey: {
    turn: { turnId: 'turn', turnStartedAtMs: 1000, status: 'completed', items: [item] } } } } };
  const sent = [], owner = 'owner'; let mark = true;
  const bridge = { requireConnection() {}, live: new Map([[id, { state, owner }]]),
    desktop: { owner: async () => ({ handledByClientId: owner }), call: async () => structuredClone(data),
      ipc: { broadcast(...args) { sent.push(args); mark = false; } } } };
  bridge.follow=async()=>{const o=await bridge.desktop.owner();bridge.live.set(id,{state,owner});return o;};
  const context = { identity: { kind: 'chatgpt', accountId: 'fixture-account', userId: 'fixture-user' }, executionHostKey: 'fixture-host' };
  const reader = { supported: () => true, context: async () => context, marked: async () => mark };
  return { data, state, bridge, sent, reader, token: reportReceipt(data).token,
    options: { reader, sleep: async () => {}, attempts: 2 } };
}
test('same idle latest report and verified owner notify official context once and confirm persisted removal', async () => {
  const f = fixture(), result = await markOfficialReportRead(f.bridge, id, f.token, f.options);
  assert.equal(result.status, 'synced'); assert.equal(f.sent.length, 1);
  const [method, params, version] = f.sent[0]; assert.equal(method, OFFICIAL.ipc.readStateChanged.method); assert.equal(version, 3);
  assert.equal(params.conversationId, id); assert.equal(params.hasUnreadTurn, false); assert.equal(params.hostId, 'local');
  assert.ok(!JSON.stringify(f.sent).includes('fixture response')); assert.ok(!JSON.stringify(f.sent).includes(f.token));
});
test('old reports, active turns, owner replacement and history lag never dispatch a clear', async () => {
  for (const change of [f => { f.state.turnHistory.history.entitiesByKey.turn.items[0].text = 'new report'; },
    f => { f.state.threadRuntimeStatus.type = 'active'; },
    f => { f.bridge.desktop.owner=async()=>({handledByClientId:'replacement'}); },
    f => { f.state.turnHistory.history.entitiesByKey.new = { turnId: 'new', turnStartedAtMs: 2000, status: 'completed', items: [{ id: 'new', type: 'agentMessage', text: 'new' }] }; },
    f => { f.data.thread.kind = 'chatgpt'; }]) {
    const f = fixture(); change(f); await markOfficialReportRead(f.bridge, id, f.token, f.options); assert.equal(f.sent.length, 0);
  }
});
test('unsupported version, missing account/host context, already-read state and changed connections cannot dispatch', async () => {
  for (const change of [f => { f.reader.supported = () => false; }, f => { f.reader.context = async () => null; },
    f => { f.reader.marked = async () => null; }, f => { f.reader.marked = async () => false; },
    f => { f.bridge.desktop.call = async () => { f.bridge.desktop = {}; return f.data; }; }]) {
    const f = fixture(); change(f); await markOfficialReportRead(f.bridge, id, f.token, f.options); assert.equal(f.sent.length, 0);
  }
});
test('rejected account context, disconnection or a newer turn after dispatch are unconfirmed and never replayed', async () => {
  for (const mode of ['rejected', 'disconnect', 'new-turn']) {
    const f = fixture();
    if (mode === 'rejected') f.reader.marked = async () => true;
    else f.options.sleep = async () => {
      if (mode === 'disconnect') f.bridge.requireConnection = () => { throw Error('offline'); };
      else f.state.threadRuntimeStatus.type = 'active';
    };
    const result = await markOfficialReportRead(f.bridge, id, f.token, f.options);
    assert.equal(result.status, 'unconfirmed'); assert.equal(f.sent.length, 1);
  }
});
test('a new turn arriving during the confirmation read cannot be reported as successfully synchronized', async () => {
  const f = fixture(); let reads = 0;
  f.reader.marked = async () => { if (++reads === 1) return true; f.state.threadRuntimeStatus.type = 'active'; return false; };
  const result = await markOfficialReportRead(f.bridge, id, f.token, f.options);
  assert.equal(result.status, 'unconfirmed'); assert.equal(f.sent.length, 1);
});

test('empty or stale history items use the same authoritative owner report as the displayed page', async () => {
  for (const items of [[], [{ id: 'item', type: 'agentMessage', text: 'stale history' }]]) {
    const f = fixture(); f.data.turns[0].items = items;
    const result = await markOfficialReportRead(f.bridge, id, f.token, f.options);
    assert.equal(result.status, 'synced'); assert.equal(result.retryable, false); assert.equal(f.sent.length, 1);
  }
});

test('an owner-deleted report or newer owner turn cannot clear the viewed older report', async () => {
  for (const change of [f => { f.state.turnHistory.history.entitiesByKey.turn.items = []; },
    f => { f.state.turnHistory.history.entitiesByKey.newer={turnId:'newer',turnStartedAtMs:2000,status:'completed',items:[{id:'new',type:'agentMessage',text:'new return'}]}; }]) {
    const f = fixture(); change(f);
    const result = await markOfficialReportRead(f.bridge, id, f.token, f.options);
    assert.equal(result.status, 'unavailable'); assert.equal(result.retryable, true); assert.equal(f.sent.length, 0);
  }
});

test('only failures known to precede dispatch may retry, including identity changes and throwing transports', async () => {
  const before = fixture(); before.bridge.desktop.owner = async () => { throw Error('owner unavailable'); };
  assert.equal((await markOfficialReportRead(before.bridge, id, before.token, before.options)).retryable, true);
  const changed = fixture(); changed.bridge.desktop.call = async () => { changed.bridge.desktop.identity = {}; return changed.data; };
  assert.equal((await markOfficialReportRead(changed.bridge, id, changed.token, changed.options)).retryable, true);
  assert.equal(changed.sent.length, 0);
  const during = fixture(); during.bridge.desktop.ipc.broadcast = () => { throw Error('write outcome unknown'); };
  const result = await markOfficialReportRead(during.bridge, id, during.token, during.options);
  assert.equal(result.status, 'unconfirmed'); assert.equal(result.retryable, false);
});
