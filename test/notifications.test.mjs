import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { notificationProjection, NotificationSource } from '../src/notification-source.mjs';
import { DesktopNotifications } from '../src/desktop-notifications.mjs';
import { deviceFingerprint, notificationRequest } from '../src/notification-client.mjs';
import { allowedRoute } from '../src/remote.mjs';
import { EVENTS } from '../src/official-protocol.mjs';

const id = '11111111-1111-4111-8111-111111111111', remoteId = '22222222-2222-4222-8222-222222222222';
const agent = { id: remoteId, kind: 'remote', name: '测试设备', host: '100.64.0.2', port: 43128, sealedKey: 'fixture' };
const state = (turnId = 'turn-1', type = 'idle', turnStatus = 'completed') => ({ id, threadRuntimeStatus: { type },
  turnHistory: { history: { entitiesByKey: { [turnId]: { turnId, status: turnStatus, turnStartedAtMs: 1, items: [{ id: 'reply', type: 'agentMessage', text: '测试回报' }] } } } } });
const row = (turn = 'turn-1', type = 'idle', status = 'completed') => ({ ...notificationProjection(state(turn, type, status), id), mode: 'codex', title: '测试任务' });
function setup(t, extra = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'remote-notification-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  let current = { ...agent };
  const agents = { list: () => ({ agents: [{ id: 'local', kind: 'local' }, current] }), get: id => { if (id !== current.id) throw Error('Removed'); return current; } };
  const service = new DesktopNotifications(agents, dir, { now: () => 1000, ...extra });
  t.after(() => service.close());
  return { service, dir, agents, change: change => { current = { ...current, ...change }; },
    observe: rows => service.observe(current, deviceFingerprint(current), { threads: rows }) };
}
test('notifications require fresh runtime and matching task, and never expose unread as notification truth', () => {
  assert.equal(notificationProjection(state('a', 'notLoaded'), id).known, false);
  assert.throws(() => notificationProjection(state(), remoteId), /identity/);
  assert.equal(row('a', 'active').events.length, 0);
  assert.equal(row('a', 'idle', 'inProgress').events.length, 0);
  const a = state(); a.hasUnreadTurn = false; const b = state(); b.hasUnreadTurn = true;
  assert.deepEqual(notificationProjection(a, id), notificationProjection(b, id));
  assert.equal(row().events[0].kind, 'completed'); assert.equal(row('a', 'idle', 'failed').events[0].kind, 'failed');
});
test('approval and synchronous question IDs distinguish new requests; inactive requests cannot resurrect alerts', () => {
  const s = state('a', 'active', 'inProgress'); s.threadRuntimeStatus.activeFlags = ['waitingOnUserInput'];
  s.requests = [{ id: 'q1', method: EVENTS.userInput, params: { questions: [{ question: '选择颜色' }] } }];
  const first = notificationProjection(s, id).events[0]; assert.equal(first.kind, 'question'); assert.equal(first.quickReply, false);
  s.requests[0].id = 'q2'; assert.notEqual(notificationProjection(s, id).events[0].key, first.key);
  s.threadRuntimeStatus.activeFlags = ['waitingOnApproval']; assert.equal(notificationProjection(s, id).events[0].kind, 'approval');
  s.threadRuntimeStatus = { type: 'idle' }; assert.equal(notificationProjection(s, id).events.length, 0);
});
test('async questions use official answer messages; no old local done or notification dismissal answers them', () => {
  const s = state('a', 'active', 'inProgress'), items = s.turnHistory.history.entitiesByKey.a.items;
  items.push({ id: 'async-1', type: 'agentMessage', delivery: 'async', questions: [{ title: '测试问题' }] });
  assert.equal(notificationProjection(s, id).events[0].kind, 'question');
  items.push({ type: 'userMessage', content: [{ type: 'text', text: '<send_user_message_question_reply>' + JSON.stringify([{ questionItemId: '["request_user_input_async","async-1",0]', question: '测试问题', answer: 'A' }]) + '</send_user_message_question_reply>' }] });
  assert.equal(notificationProjection(s, id).events.length, 0);
});
test('initial history is silent; new completion, reconnect and restart deduplicate without storing message bodies', t => {
  const { service, observe, dir, agents } = setup(t);
  observe([row()]); assert.equal(service.events.size, 0);
  observe([row('turn-2')]); assert.equal(service.events.size, 1);
  const event = [...service.events.values()][0]; service.dismiss(event.id); observe([row('turn-2')]); assert.equal(service.events.size, 0);
  const restarted = new DesktopNotifications(agents, dir, { now: () => 2000 }); t.after(() => restarted.close());
  restarted.observe(agent, deviceFingerprint(agent), { threads: [row('turn-2')] }); assert.equal(restarted.events.size, 0);
  restarted.observe(agent, deviceFingerprint(agent), { threads: [row('turn-3')] }); assert.equal(restarted.events.size, 1);
  assert.ok(!fs.readFileSync(service.store.file, 'utf8').includes('测试回报'));
});
test('viewing suppresses only that task; unknown scans do not create or clear official facts', t => {
  const { service, observe } = setup(t); observe([row()]);
  service.viewing = { agent: remoteId, thread: id, mode: 'codex', at: 1000 }; observe([row('a')]); assert.equal(service.events.size, 0);
  service.viewing = { agent: remoteId, thread: id, mode: 'chat', at: 1000 }; observe([row('b')]); assert.equal(service.events.size, 1);
  observe([{ id, known: false }]); assert.equal(service.events.size, 1);
  observe([row('c', 'active', 'inProgress')]); assert.equal(service.events.size, 0);
});
test('new task first observed after monitoring began can notify; pause re-establishes a quiet baseline', t => {
  const { service, observe } = setup(t); const next = row(); next.startedAt = 2000; observe([next]); assert.equal(service.events.size, 1);
  service.settings(false); assert.equal(service.events.size, 0); service.settings(true); observe([row('old')]); assert.equal(service.events.size, 0);
});
test('draft survives dismissal/restart; deleting text removes the unsent draft; device edits never retarget replies', async t => {
  const calls = []; const { service, observe, dir, agents, change } = setup(t, { request: async (...args) => { calls.push(args); return { application: 'remote-codex', instanceId: randomUUID() }; } });
  observe([row()]); observe([row('a')]); const e = [...service.events.values()][0];
  service.draft(e.id, '未发送的测试草稿'); service.dismiss(e.id);
  const restarted = new DesktopNotifications(agents, dir); t.after(() => restarted.close()); assert.deepEqual(restarted.restore().ids, [e.id]);
  assert.equal(restarted.db.drafts[e.id].text, '未发送的测试草稿');
  restarted.draft(e.id, ''); assert.equal(Object.keys(restarted.db.drafts).length, 0);
  // Use restarted writer only after it has changed the storage.
  restarted.draft(e.id, '保留'); change({ port: 43129 });
  const result = await restarted.reply(e.id, '保留'); assert.equal(result.status, 'not-sent'); assert.equal(calls.length, 0);
});
test('quick reply uses the original target and stable ID; dropped response never retries and retains text', async t => {
  const writes = []; const { service, observe } = setup(t, { request: async (a, target, route, body) => {
    if (route === '/instance') return { application: 'remote-codex', instanceId: randomUUID() };
    writes.push({ target, route, body }); throw Error('Response lost');
  } });
  observe([row()]); observe([row('a')]); const e = [...service.events.values()][0];
  const [a, b] = await Promise.all([service.reply(e.id, '测试回复'), service.reply(e.id, '测试回复')]);
  assert.equal(a.status, 'outcome-unknown'); assert.equal(b.status, a.status); assert.equal(writes.length, 1);
  assert.equal(writes[0].target.id, remoteId); assert.equal(writes[0].body.eventKey, e.eventKey);
  assert.equal((await service.reply(e.id, '测试回复')).status, 'outcome-unknown'); assert.equal(writes.length, 1);
  assert.throws(() => service.draft(e.id, '不同内容'), /尚需核对/); assert.equal(service.db.drafts[e.id].text, '测试回复');
});
test('stale task is confirmed not-sent and editable; accepted response alone removes only the notification draft', async t => {
  let accepted = false; const { service, observe } = setup(t, { request: async (a, target, route) => route === '/instance' ? { application: 'remote-codex', instanceId: randomUUID() } : { status: accepted ? 'accepted' : 'not-sent' } });
  observe([row()]); observe([row('a')]); const e = [...service.events.values()][0];
  assert.equal((await service.reply(e.id, '测试')).status, 'not-sent'); assert.equal(service.db.drafts[e.id].outcome, 'draft');
  const oldRequest = service.db.drafts[e.id].requestId; service.draft(e.id, '编辑后的测试'); assert.notEqual(service.db.drafts[e.id].requestId, oldRequest);
  const changedRequest = service.db.drafts[e.id].requestId; service.draft(e.id, '编辑后的测试'); assert.equal(service.db.drafts[e.id].requestId, changedRequest);
  accepted = true; assert.equal((await service.reply(e.id, '编辑后的测试')).status, 'accepted'); assert.equal(service.db.drafts[e.id], undefined); assert.equal(service.events.size, 0);
});
test('all remote devices scan independently; local and self aliases never read tasks', async t => {
  const routes = []; let self = true;
  const { service } = setup(t, { request: async (a, target, route) => { routes.push(route); if (route === '/instance') return { application: 'remote-codex', instanceId: self ? service.instanceId : randomUUID() }; if (route === '/status') return { connected: false }; if (route === '/connect') return {}; return { schemaVersion: 1, supported: true, threads: [], partial: true }; } });
  const state = { fingerprint: deviceFingerprint(agent), failures: 0 }; service.devices.set(remoteId, state);
  await service.scan(agent, state); assert.deepEqual(routes, ['/instance']); assert.equal(state.status, 'local-excluded');
  self = false; routes.length = 0; await service.scan(agent, state); assert.deepEqual(routes, ['/instance', '/status', '/connect', '/notification-state']); assert.equal(state.status, 'partial');
  assert.ok(!routes.some(r => /read-receipt|messages|questions/.test(r)));
});
test('deleted or edited device invalidates a delayed scan; unsupported old peers are visible as update-required', async t => {
  let release; const delayed = new Promise(r => release = r);
  const { service, change } = setup(t, { request: async () => { await delayed; return { application: 'remote-codex', instanceId: randomUUID() }; } });
  const state = { fingerprint: deviceFingerprint(agent), failures: 0 }; service.devices.set(remoteId, state);
  const scan = service.scan(agent, state); change({ port: 44000 }); release(); await scan; assert.equal(service.events.size, 0);
  service.request = async () => { throw Object.assign(Error(), { code: 'UNSUPPORTED' }); };
  await service.scan(agent, state); assert.equal(state.status, 'update-required');
});
test('self network addresses are rejected before any HTTP; notification management stays loopback-only', async () => {
  await assert.rejects(notificationRequest({ key: async () => 'fake' }, agent, '/instance', undefined, { resolve: async () => '100.64.0.2', isLocal: () => true }), e => e.code === 'SELF');
  assert.equal(allowedRoute('GET', '/api/instance'), true); assert.equal(allowedRoute('GET', '/api/notification-state'), true);
  assert.equal(allowedRoute('POST', '/api/threads/' + id + '/notification-reply'), true);
  for (const route of ['poll', 'reply', 'settings', 'draft', 'restore', 'discard']) assert.equal(allowedRoute('POST', '/api/desktop-notifications/' + route), false);
});
test('a stalled device does not stop another device scan and reconnect', async t => {
  const other = { ...agent, id: randomUUID(), host: '100.64.0.3' };
  const { service, agents } = setup(t); let unblock;
  const blocked = new Promise(r => unblock = r);
  agents.list = () => ({ agents: [agent, other, { id: 'local', kind: 'local' }] });
  agents.get = id => id === other.id ? other : agent;
  const scanned = [];
  service.request = async (agents, target, route) => {
    if (target.id === agent.id) await blocked;
    if (route === '/instance') return { application: 'remote-codex', instanceId: randomUUID() };
    if (route === '/status') return { connected: true };
    scanned.push(target.id); return { schemaVersion: 1, supported: true, threads: [] };
  };
  service.tick(); await new Promise(r => setImmediate(r)); assert.deepEqual(scanned, [other.id]);
  unblock(); await new Promise(r => setImmediate(r)); assert.deepEqual(new Set(scanned), new Set([agent.id, other.id]));
});
test('a superseded notification still accepts its already-typed draft; a failed durable save publishes no event', t => {
  const { service, observe } = setup(t); observe([row()]); observe([row('a')]); const e = [...service.events.values()][0];
  observe([row('b', 'active', 'inProgress')]); assert.equal(service.events.size, 0);
  service.draft(e.id, '正在输入的内容'); assert.equal(service.db.drafts[e.id].text, '正在输入的内容');
  service.store.write = () => { throw Error('simulated disk failure'); };
  assert.throws(() => observe([row('c')]), /disk failure/); assert.equal(service.events.size, 0);
});
test('source reads fresh owner projections only; Chat and other hosts excluded; quick reply checks matching idle event', async () => {
  let closed = 0, live = state(), sent = 0;
  const bridge = { desktop: {}, requireConnection() {}, threads: async () => ({ data: { threads: [{ id, kind: 'codex', hostId: 'local', title: '测试' }, { id: remoteId, kind: 'chatgpt', hostId: 'local' }] } }), nativeSend: async () => { sent++; return { status: 'accepted' }; } };
  const source = new NotificationSource(bridge, { stateFactory: () => ({ supported: () => true, connect: async () => {}, read: async (id, ms, project) => project(live, id), close: () => closed++ }) });
  const snapshot = await source.collect(); assert.equal(snapshot.threads.length, 1); assert.equal(closed, 1);
  const eventKey = snapshot.threads[0].events[0].key;
  live = state('new'); assert.equal((await source.reply(id, { eventKey })).status, 'not-sent'); assert.equal(sent, 0);
  live = state(); await source.reply(id, { eventKey, prompt: '测试', requestId: 'test-only' }); assert.equal(sent, 1);
});
