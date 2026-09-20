import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Bridge } from '../src/bridge.mjs';
import { activateThread } from '../src/thread-activation.mjs';
import { allowedRoute } from '../src/remote.mjs';
import { fixtureEvidence } from './fixtures/interface-evidence.mjs';

const id = '11111111-2222-4333-8444-555555555555', owner = 'official-owner';
function setup(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'activation-')), b = new Bridge(dir), calls = [];
  const state = { status: 'notLoaded', resume: 'resumed', runtime: 'idle', emit: true, owner, id };
  const snapshot = () => b.frame({ type: 'broadcast', method: 'thread-stream-state-changed', sourceClientId: state.owner,
    params: { hostId: 'local', conversationId: id, change: { type: 'snapshot', revision: Date.now(),
      conversationState: { id: state.id, resumeState: state.resume, latestThreadSettings: { permissions: ':workspace' }, threadRuntimeStatus: { type: state.runtime } } } } });
  const desktop = { identity: { appToolsPipe: { image: 'OpenAI.Codex_26.915.4065.0_x64__fixture' } }, close() {},
    call: async (name, args) => {
      calls.push({ name, args });
      if (name === 'list_threads') return { threads: [{ id, kind: state.kind ?? 'codex', hostId: state.host ?? 'local', status: state.status }] };
      if (name === 'navigate_to_codex_page') { await state.onNavigate?.(); state.status = 'idle'; return { navigated: true }; }
      throw Error('Unexpected tool ' + name);
    },
    owner: async () => { if (state.noOwner) throw Error('no-client-found'); return { handledByClientId: owner }; },
    ipc: { broadcast(method, params) { if (params.following && state.emit) snapshot(); },
      async request(method, params) { calls.push({ name: method, params });
        if (state.writeFailure) throw Error('lost acknowledgement');
        return { handledByClientId: owner, result: { result: { turn: { id: 'next' } } } }; } } };
  fixtureEvidence(desktop); b.desktop = desktop; b.connected = true;
  t.after(() => { b.disconnect(); fs.rmSync(dir, { recursive: true, force: true }); });
  return { b, desktop, state, calls, snapshot, activate: viewer => activateThread(b, id, viewer, { timeoutMs: 180, pollMs: 5 }) };
}
test('cold activation merges simultaneous viewers and waits past navigation for a resumed owner without sending', async t => {
  const { activate, state, snapshot, calls } = setup(t);
  state.resume = 'resuming'; let complete = false;
  const a = activate('viewer-one').then(r => { complete = true; return r; }), b = activate('viewer-two');
  await new Promise(r => setTimeout(r, 30)); assert.equal(complete, false);
  state.resume = 'resumed'; snapshot();
  assert.equal((await a).ready, true); assert.equal((await b).threadId, id);
  assert.deepEqual(calls.map(c => c.name), ['list_threads', 'navigate_to_codex_page']);
});
test('loaded tasks get a fresh owner without navigation and no persisted activation state', async t => {
  const { b, activate, state, calls } = setup(t); state.status = 'active'; state.runtime = 'active';
  assert.equal((await activate()).ready, true); assert.deepEqual(calls.map(c => c.name), ['list_threads']);
  assert.deepEqual(b.db.requests, {});
});
test('stale, wrong task/owner, resuming, unknown and missing owners never count as loaded', async t => {
  for (const fault of ['stale', 'task', 'owner', 'resuming', 'runtime', 'missing']) {
    const { b, activate, state, calls } = setup(t);
    b.live.set(id, { owner, state: { id, resumeState: 'resumed', threadRuntimeStatus: { type: 'idle' } } });
    if (fault === 'stale') state.emit = false;
    if (fault === 'task') state.id = 'another-task';
    if (fault === 'owner') state.owner = 'other-owner';
    if (fault === 'resuming') state.resume = 'resuming';
    if (fault === 'runtime') state.runtime = 'unknown';
    if (fault === 'missing') state.noOwner = true;
    await assert.rejects(activate(), /加载超时/, fault);
    assert.equal(calls.filter(c => c.name === 'navigate_to_codex_page').length, 1);
  }
});
test('Chat, foreign hosts, unknown status and changed connection cannot navigate', async t => {
  for (const fault of ['chat', 'host', 'unknown', 'connection']) {
    const { b, desktop, activate, state, calls } = setup(t);
    if (fault === 'chat') state.kind = 'chatgpt';
    if (fault === 'host') state.host = 'other';
    if (fault === 'unknown') state.status = 'unknown';
    if (fault === 'connection') { const call = desktop.call; desktop.call = async (...args) => { const r = await call(...args); b.desktop = { ...desktop }; return r; }; }
    await assert.rejects(activate());
    assert.equal(calls.filter(c => c.name === 'navigate_to_codex_page').length, 0);
  }
});
test('failed load can retry explicitly; released viewers and expired metadata cannot trigger late navigation', async t => {
  const { b, desktop, activate, state, calls } = setup(t);
  state.noOwner = true;
  await assert.rejects(activate(), /加载超时/); state.noOwner = false;
  assert.equal((await activate()).ready, true);
  state.status = 'notLoaded';
  const call = desktop.call; desktop.call = async (...args) => { const r = await call(...args); await new Promise(r => setTimeout(r, 220)); return r; };
  const attempt = activate('viewer-cancel'); b.unfollow(id, 'viewer-cancel');
  await assert.rejects(attempt);
  await new Promise(r => setTimeout(r, 70));
  assert.equal(calls.filter(c => c.name === 'navigate_to_codex_page').length, 1);
});
test('image send loads first, keeps original image, dispatches once and never falls back after a lost write', async t => {
  const { b, state, calls } = setup(t);
  const image = 'data:image/png;base64,AAAA'; state.writeFailure = true;
  const send = () => b.nativeSend(id, 'cold-image-send', 'synthetic prompt', [image]);
  await assert.rejects(send(), /lost acknowledgement/);
  assert.equal((await send()).status, 'outcome-unknown');
  assert.equal(calls.filter(c => c.name === 'thread-follower-start-turn').length, 1);
  assert.ok(!calls.some(c => c.name === 'send_message_to_thread'));
  const write = calls.find(c => c.name === 'thread-follower-start-turn');
  assert.equal(write.params.turnStart.request.input[1].url, image);
});
test('activation failures reject before dispatch and never replay notification writes', async t => {
  const { b, state, calls } = setup(t); b.activate = async () => { throw Error('load failed'); };
  await assert.rejects(b.nativeSend(id, 'load-failed-send', 'text', ['data:image/png;base64,AAAA']), /load failed/);
  assert.equal(b.db.requests['load-failed-send'].status, 'rejected');
  await assert.rejects(b.nativeSend(id, 'cold-notification', 'text', ['data:image/png;base64,AAAA'], {}, async () => {}), /Notification task/);
  assert.ok(calls.every(c => c.name === 'list_threads'));
});
test('cold settings use activation and a new owner before applying the exact permission choice', async t => {
  const { b, calls } = setup(t);
  const result = await b.updateSettings(id, 'cold-settings', { permissionMode: 'read-only' });
  assert.equal(result.status, 'accepted');
  assert.equal(calls.filter(c => c.name === 'navigate_to_codex_page').length, 1);
  const settings = calls.filter(c => c.name === 'thread-follower-update-thread-settings');
  assert.equal(settings.length, 1); assert.equal(settings[0].params.threadSettings.permissions, ':read-only');
  assert.ok(!calls.some(c => ['thread-follower-start-turn', 'send_message_to_thread'].includes(c.name)));
});
test('released viewing lease or changed IPC stops activation before a late navigation', async t => {
  for (const change of ['release', 'ipc']) {
    const { b, desktop, calls, activate } = setup(t);
    const call = desktop.call; let release;
    desktop.call = async (...args) => { const r = await call(...args); await new Promise(resolve => { release = resolve; }); return r; };
    const job = activate('viewer-cancelled');
    await new Promise(r => setTimeout(r, 10));
    if (change === 'release') b.unfollow(id, 'viewer-cancelled'); else desktop.ipc = { ...desktop.ipc };
    release(); await assert.rejects(job);
    assert.equal(calls.filter(c => c.name === 'navigate_to_codex_page').length, 0);
  }
});
test('activation forwarding accepts only the task POST route', () => {
  assert.equal(allowedRoute('POST', '/api/threads/' + id + '/activate'), true);
  for (const verb of ['GET', 'PUT', 'DELETE']) assert.equal(allowedRoute(verb, '/api/threads/' + id + '/activate'), false);
});
