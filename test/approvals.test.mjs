import { fixtureEvidence } from "./fixtures/interface-evidence.mjs";
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Bridge } from '../src/bridge.mjs';
import { startServer } from '../src/server.mjs';
import { allowedRoute } from '../src/remote.mjs';
import { conversationView } from '../src/state.mjs';
import { EVENTS, OFFICIAL } from '../src/official-protocol.mjs';
import { browserApproval } from '../public/approval-content.mjs';
import { approvalView, approvalResponse, pendingApprovals } from '../src/approvals.mjs';
const id = '88888888-8888-4888-8888-888888888888';
const request = () => ({ id: 37, method: EVENTS.mcpElicitation, params: {
  threadId: id, turnId: 'turn-fixture', serverName: 'cua_repl', mode: 'form',
  message: 'Allow Browser use to access https://example.com?', requestedSchema: { type: 'object', properties: {} },
  _meta: { codex_approval_kind: 'mcp_tool_call', codex_request_type: 'approval_request', codex_sensitive_action: true,
    connector_id: 'browser-use', tool_name: 'access_browser_origin', origin: 'https://example.com', persist: 'always',
    tool_params: { origin: 'https://example.com' } },
} });
function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bridge-approval-'));
  const b = new Bridge(dir), calls = [], state = { requests: [request()], kind: 'codex', owner: 'owner', threadId: id };
  b.connected = true;
  b.desktop = { identity: { appToolsPipe: { image: 'OpenAI.Codex_26.903.8094.0_x64__fixture' } }, close() {}, catalog: [],
    call: async name => { assert.equal(name, 'read_thread'); return { thread: { id, kind: state.kind } }; },
    ipc: { request: async (method, params, options) => {
      assert.equal(Object.values(b.db.requests).at(-1).status, 'outcome-unknown');
      calls.push({ method, params, options });
      return { handledByClientId: 'owner', result: { method, result: { ok: true } } };
    } },
  };
  fixtureEvidence(b.desktop);
  b.follow = async () => { b.live.set(id, { owner: state.owner, state: { id: state.threadId, requests: structuredClone(state.requests) } }); return { handledByClientId: 'owner' }; };
  b.connect = async () => b.status(); b.disconnect = () => {};
  fs.writeFileSync(path.join(dir, 'update-settings.json'), '{"automatic":false}');
  t.after(() => { clearInterval(b.subscriptionTimer); fs.rmSync(dir, { recursive: true, force: true }); });
  const view = approvalView(state.requests[0], id);
  const body = { requestId: 'approval-client-001', approvalRequestId: view.requestId, token: view.token, decision: 'once' };
  return { b, dir, calls, state, body, send: (value = body) => b.answerApproval(id, value.requestId, value) };
}
test('browser origin scopes use exact official accept/decline forms; session is opt-in', () => {
  const r = request(), v = approvalView(r, id);
  assert.deepEqual(v.decisions, ['deny', 'once', 'site']);
  assert.deepEqual(approvalResponse(v, 'once'), { action: 'accept', content: {}, _meta: null });
  assert.deepEqual(approvalResponse(v, 'deny'), { action: 'decline', content: null, _meta: null });
  assert.deepEqual(approvalResponse(v, 'site'), { action: 'accept', content: {}, _meta: { persist: 'always' } });
  assert.throws(() => approvalResponse(v, 'session'));
  assert.throws(() => approvalResponse(v, 'all-sites'));
  r.params._meta.persist = ['session'];
  assert.deepEqual(approvalView(r, id).decisions, ['deny', 'once', 'session']);
  assert.deepEqual(approvalResponse(approvalView(r, id), 'session'), { action: 'accept', content: {}, _meta: { persist: 'session' } });
});
test('other MCP forms, URL login, raw CDP and ambiguous origins never acquire browser authorization', () => {
  for (const change of [r => r.params.mode = 'url', r => r.params.serverName = 'database',
    r => r.params._meta.tool_name = 'access_browser_origin_with_raw_cdp',
    r => r.params.requestedSchema.properties = { password: { type: 'string' } },
    r => r.params.requestedSchema.properties = [], r => r.params.requestedSchema.required = '',
    r => r.params.requestedSchema.required = ['password'], r => r.params.requestedSchema.const = { approved: true },
    r => r.params._meta.origin = 'https://example.org', r => r.params._meta.origin = 'https://user:pass@example.com',
    r => r.params._meta.tool_params.origin += '/private', r => r.params._meta.origin = 'javascript:alert(1)',
    r => r.params._meta.origin += '?secret=1']) {
    const r = request(); change(r); assert.equal(browserApproval(r.params), null);
    assert.equal(approvalView(r, id).supported, false);
  }
});
test('pending state is exclusively the matching official requests, never historical items', () => {
  const r = request();
  assert.deepEqual(pendingApprovals({ id, turns: [{ items: [{ type: 'mcpServerElicitation', completed: false }] }] }), []);
  assert.equal(pendingApprovals({ id, requests: [r] }).length, 1);
  assert.equal(approvalView(r, 'different-thread'), null);
  assert.equal(approvalView({ ...r, completed: true }, id), null);
  const view = conversationView({ live: { state: { id, requests: [r] } } });
  assert.equal(view.live.state.approvals[0].origin, 'https://example.com');
  const changed = request(); changed.params._meta.persist = 'session';
  assert.notEqual(approvalView(r, id).token, approvalView(changed, id).token);
});
test('explicit selection targets the current owner and preserves official request ID type; ACK is not state', async t => {
  for (const decision of ['once', 'deny', 'site']) {
    const { send, body, calls, b } = fixture(t);
    const result = await send({ ...body, decision }); assert.equal(result.status, 'accepted');
    assert.equal(calls[0].method, OFFICIAL.ipc.mcpElicitation.method);
    assert.deepEqual(calls[0].options, { targetClientId: 'owner', timeoutMs: 30000, version: 1 });
    assert.deepEqual(calls[0].params, { conversationId: id, requestId: 37, response: approvalResponse(approvalView(request(), id), decision) });
    assert.equal(pendingApprovals(b.live.get(id).state).length, 1, 'ACK must not remove pending request');
    assert.doesNotMatch(fs.readFileSync(b.stateFile, 'utf8'), /example.com|Allow Browser/);
  }
});
test('changed request, ended request, mismatched owner/thread, Chat or replaced desktop never dispatch', async t => {
  for (const change of ['changed', 'ended', 'owner', 'thread', 'chat', 'desktop']) {
    const { b, send, state, calls } = fixture(t), follow = b.follow;
    if (change === 'changed') state.requests[0].params._meta.persist = 'session';
    if (change === 'ended') state.requests = [];
    if (change === 'owner') state.owner = 'other';
    if (change === 'thread') state.threadId = 'other';
    if (change === 'chat') state.kind = 'chatgpt';
    if (change === 'desktop') b.follow = async () => { const r = await follow(); b.desktop = { ...b.desktop }; return r; };
    assert.equal((await send()).status, 'not-sent', change); assert.equal(calls.length, 0, change);
  }
});
test('invalid client scope/meta, unsupported build and unsupported MCP requests reject before dispatch', async t => {
  for (const override of [{ decision: 'all-sites' }, { _meta: { persist: 'always' } }, { response: { action: 'accept' } }, { token: 'stale' }]) {
    const { send, body, calls } = fixture(t); assert.equal((await send({ ...body, ...override })).status, 'not-sent'); assert.equal(calls.length, 0);
  }
  const { b, send, calls } = fixture(t); b.desktop.identity.appToolsPipe.image = 'OpenAI.Codex_26.901.6511.0_x64__fixture';
  assert.equal(b.status().browserApprovals.supported, false); assert.equal((await send()).status, 'not-sent'); assert.equal(calls.length, 0);
});
test('concurrent clients deduplicate by official request; unknown result survives restart and changed decision', async t => {
  const { b, body, send, calls, dir } = fixture(t);
  const results = await Promise.all([send(), send({ ...body, requestId: 'other-client-002' })]);
  assert.ok(results.every(r => r.status === 'accepted')); assert.equal(calls.length, 1);
  const second = fixture(t); let attempts = 0;
  second.b.desktop.ipc.request = async () => { attempts++; throw Error('lost response'); };
  assert.equal((await second.send()).status, 'outcome-unknown');
  const restart = new Bridge(second.dir); t.after(() => clearInterval(restart.subscriptionTimer));
  restart.connected = true; restart.desktop = second.b.desktop;
  const retry = { ...second.body, requestId: 'another-client-003', decision: 'site' };
  assert.equal((await restart.answerApproval(id, retry.requestId, retry)).status, 'outcome-unknown'); assert.equal(attempts, 1);
});
test('wrong owner or malformed ACK remains unknown; known pre-dispatch rejection permits changing the choice', async t => {
  for (const ack of [{ handledByClientId: 'other', result: { result: { ok: true } } }, { handledByClientId: 'owner', result: { ok: true } }]) {
    const { b, send } = fixture(t); b.desktop.ipc.request = async () => ack;
    assert.equal((await send()).status, 'outcome-unknown');
  }
  const { b, state, send, body, calls } = fixture(t); state.owner = 'other'; assert.equal((await send()).status, 'not-sent');
  state.owner = 'owner'; assert.equal((await send({ ...body, decision: 'deny' })).status, 'accepted'); assert.equal(calls.length, 1);
});
test('production HTTP modules, CSRF and POST-only remote forwarding expose the bounded approval route', async t => {
  const { b, send, body, calls } = fixture(t);
  const { server, address, secret } = await startServer({ port: 0, bridge: b });
  try {
    for (const module of ['approvals-ui.mjs', 'approval-content.mjs']) {
      const response = await fetch(address + '/' + module); assert.equal(response.status, 200); assert.match(response.headers.get('content-type'), /javascript/);
    }
    const route = '/api/threads/' + id + '/approvals';
    assert.equal(allowedRoute('POST', route), true); for (const method of ['GET', 'PUT', 'DELETE']) assert.equal(allowedRoute(method, route), false);
    const post = auth => fetch(address + route, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(auth ? { 'X-Bridge-CSRF': secret } : {}) }, body: JSON.stringify(body) });
    assert.equal((await post(false)).status, 403); assert.equal(calls.length, 0);
    assert.equal((await (await post(true)).json()).status, 'accepted'); assert.equal(calls.length, 1);
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});
