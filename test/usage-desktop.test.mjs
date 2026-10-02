import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { Desktop } from '../src/desktop.mjs';
import { OFFICIAL, TOOLS, desktopPolicy } from '../src/official-protocol.mjs';
import { buildCompatibilityReport } from '../src/compatibility-report.mjs';
import { accountUsage, isUsageResponse } from '../src/usage.mjs';
import { planName, quotaSummary } from '../public/usage-view.mjs';
import { fixtureCatalog, fixtureProtocols } from './fixtures/interface-evidence.mjs';
import { verifyLive } from '../scripts/verify-compatibility-live.mjs';

const raw = { accountId: 'private-fixture', rateLimitResetCredits: { credits: ['private-fixture'] },
  rateLimitsByLimitId: { codex: { planType: 'promax', primary: { usedPercent: 26, windowDurationMins: 10080, resetsAt: 1791362766 } } } };
const reply = value => ({ result: { success: true, contentItems: [{ type: 'inputText', text: JSON.stringify(value) }] } });
async function fixture(t, { listed = false, inspect = false, handler = async () => reply(raw) } = {}) {
  const image = 'C:\\Program Files\\WindowsApps\\OpenAI.Codex_26.930.2377.0_x64__fixture\\app\\ChatGPT.exe';
  const pipes = [{ path: '\\\\.\\pipe\\codex-browser-use-fixture', pid: 100, image }, { path: '\\\\.\\pipe\\codex-ipc', pid: 100, image }];
  const state = { catalog: fixtureCatalog().filter(s => s.name !== TOOLS.setTitle && (listed || s.name !== TOOLS.usage)), handler, discoveries: 0 };
  const calls = [], protocols = fixtureProtocols();
  const desktop = new Desktop(inspect ? null : '11111111-2222-4333-8444-555555555555', {
    discoverPipes: async () => { state.discoveries++; return { pipes }; }, readProtocols: () => protocols,
    pipeFactory: () => {
      const pipe = new EventEmitter();
      pipe.connect = async () => { pipe.socket = { destroyed: false }; };
      pipe.close = () => { if (pipe.socket) pipe.socket.destroyed = true; };
      pipe.request = async (method, params) => {
        if (method === OFFICIAL.transport.toolsList) return { result: { tools: structuredClone(state.catalog) } };
        calls.push({ method, params });
        if (params.tool === TOOLS.usage) {
          assert.ok(state.discoveries >= 2, 'quota probe must follow process identity recheck');
          assert.equal(params.namespace, OFFICIAL.discovery.toolsNamespace);
          assert.equal(params.callerSource, OFFICIAL.transport.toolsCallerSource);
          assert.deepEqual(params.arguments, {});
          return state.handler();
        }
        assert.equal(params.tool, TOOLS.listProjects, 'no task writes or missing write probes');
        return reply({ projects: [] });
      };
      return pipe;
    },
  });
  t.after(() => desktop.close());
  await desktop.connect({ inspectCatalog: inspect });
  return { desktop, state, calls, protocols };
}

test('missing catalog quota is enabled only by the identified desktop empty query; report agrees and writes remain blocked', async t => {
  const f = await fixture(t), policy = desktopPolicy(f.desktop);
  assert.equal(policy.features.usage.supported, true);
  assert.equal(policy.interfaces.usage.source, 'live-read-only-query');
  assert.equal(policy.features.rename.supported, false);
  assert.equal(policy.features.send.supported, true);
  assert.deepEqual(f.calls.map(c => c.params.tool), [TOOLS.listProjects, TOOLS.usage]);
  const result = accountUsage(await f.desktop.call(TOOLS.usage));
  assert.equal(result.planType, 'promax'); assert.equal(planName(result), 'Pro Max');
  assert.equal(quotaSummary(result, 'available', true), '周额度剩余 74%');
  assert.doesNotMatch(JSON.stringify(result), /private-fixture/);
  const report = buildCompatibilityReport({ connected: true, catalog: f.desktop.catalog, activeProtocols: f.protocols,
    toolCallObservation: f.desktop.toolCallObservation, usageObservation: f.desktop.usageObservation });
  assert.deepEqual(report.features, policy.features); assert.equal(report.taskWrites, 0);
  assert.doesNotMatch(JSON.stringify(report), /private-fixture/);
  await assert.rejects(f.desktop.call(TOOLS.setTitle, { title: 'must not send' }), /Unavailable official interface/);
});

test('older declared quota uses the original route without an extra connection probe', async t => {
  const f = await fixture(t, { listed: true });
  assert.deepEqual(f.calls.map(c => c.params.tool), [TOOLS.listProjects]);
  assert.deepEqual(await f.desktop.call(TOOLS.usage), raw);
  assert.equal(f.calls.length, 2);
});

test('failed or unknown quota probe leaves healthy features usable; next read can recover without reconnect or double query', async t => {
  const f = await fixture(t, { handler: async () => { throw Error('private-error-fixture'); } });
  const policy = desktopPolicy(f.desktop);
  assert.equal(policy.features.usage.supported, false); assert.equal(policy.features.read.supported, true);
  assert.equal(policy.features.send.supported, true);
  assert.doesNotMatch(JSON.stringify(policy), /private-error-fixture/);
  f.state.handler = async () => reply({ text: 'not a quota response' });
  await assert.rejects(f.desktop.call(TOOLS.usage), /Unavailable official interface/);
  assert.equal(desktopPolicy(f.desktop).features.usage.supported, false);
  f.state.handler = async () => reply(raw);
  const before = f.calls.length;
  assert.deepEqual(await f.desktop.call(TOOLS.usage), raw);
  assert.equal(f.calls.length - before, 1); assert.equal(desktopPolicy(f.desktop).features.usage.supported, true);
  for (const args of [{ creditId: 'must not consume' }, [], null])
    await assert.rejects(f.desktop.call(TOOLS.usage, args), /takes no arguments/);
  assert.equal(f.calls.length - before, 1);
});

test('quota envelope validates nullable fields; missing, error and arbitrary success values stay unknown', () => {
  for (const value of [raw, { rateLimits: null }, { rateLimitsByLimitId: null }, { rateLimits: {} }])
    assert.equal(isUsageResponse(value), true);
  for (const value of [null, [], {}, { text: 'ok' }, { rateLimits: [] }, { rateLimits: 'unknown' },
    { rateLimits: undefined }, { rateLimitsByLimitId: 100 }, { rateLimits: {}, rateLimitsByLimitId: [] }])
    assert.equal(isUsageResponse(value), false);
  assert.equal(accountUsage({ rateLimits: null }).status, 'unknown');
  for (const [plan, name] of [['go', 'Go'], ['prolite', 'Pro Lite'], ['promax', 'Pro Max']]) {
    const usage = accountUsage({ rateLimits: { planType: plan, primary: null } });
    assert.equal(planName(usage), name); assert.equal(usage.status, 'unknown');
  }
});

test('a later quota failure revokes only the fallback proof and the next healthy read recovers', async t => {
  const f = await fixture(t);
  f.state.handler = async () => ({ result: { success: false, contentItems: [] } });
  await assert.rejects(f.desktop.call(TOOLS.usage), /Desktop tool failed/);
  assert.equal(desktopPolicy(f.desktop).features.usage.supported, false);
  assert.equal(desktopPolicy(f.desktop).features.send.supported, true);
  f.state.handler = async () => reply(raw);
  assert.deepEqual(await f.desktop.call(TOOLS.usage), raw);
});

test('late quota evidence is discarded after connection identity changes', async t => {
  const f = await fixture(t); let started, finish;
  const ready = new Promise(resolve => { started = resolve; });
  f.state.handler = () => { started(); return new Promise(resolve => { finish = resolve; }); };
  const pending = f.desktop.refreshCatalog();
  const rejected = assert.rejects(pending, /connection changed/);
  await ready;
  f.desktop.identity = { ...f.desktop.identity };
  finish(reply(raw)); await rejected;
  assert.equal(desktopPolicy(f.desktop).features.usage.supported, false);
  const before = f.calls.length;
  await assert.rejects(f.desktop.call(TOOLS.usage), /Unavailable official interface/);
  assert.equal(f.calls.length, before);
});

test('an older failed quota refresh cannot invalidate a newer healthy refresh', async t => {
  const f = await fixture(t); let started, finish;
  const ready = new Promise(resolve => { started = resolve; });
  f.state.handler = () => { started(); return new Promise(resolve => { finish = resolve; }); };
  const old = f.desktop.refreshCatalog(), rejected = assert.rejects(old, /connection changed/);
  await ready;
  assert.equal(desktopPolicy(f.desktop).features.send.supported, true, 'healthy interfaces remain available while reading quota');
  f.state.handler = async () => reply(raw);
  await f.desktop.refreshCatalog();
  finish(reply({ text: 'old failure' })); await rejected;
  assert.equal(desktopPolicy(f.desktop).features.usage.supported, true);
});

test('diagnostics without task context do not send a quota request or claim compatibility', async t => {
  const f = await fixture(t, { inspect: true });
  await f.desktop.probeToolCall(null);
  assert.equal(f.calls.length, 0); assert.equal(desktopPolicy(f.desktop).features.usage.supported, false);
  await assert.rejects(f.desktop.call(TOOLS.usage), /Unavailable official interface/);
  assert.equal(f.calls.length, 0);
});

test('a simultaneous quota retry supersedes a pending refresh without disabling unrelated interfaces', async t => {
  const f = await fixture(t); let started, finish;
  const ready = new Promise(resolve => { started = resolve; });
  f.state.handler = () => { started(); return new Promise(resolve => { finish = resolve; }); };
  const refresh = f.desktop.refreshCatalog();
  await ready;
  f.state.handler = async () => reply(raw);
  assert.deepEqual(await f.desktop.call(TOOLS.usage), raw);
  finish(reply({ text: 'older unavailable read' })); await refresh;
  assert.equal(desktopPolicy(f.desktop).features.usage.supported, true);
  assert.equal(desktopPolicy(f.desktop).features.send.supported, true);
});

test('read-only preflight distinguishes actual quota proof from the missing catalog entry and redacts private data', async t => {
  const f = await fixture(t);
  // Include every unrelated catalog declaration for the upgrade preflight.
  f.state.catalog = fixtureCatalog().filter(s => s.name !== TOOLS.usage);
  const report = await verifyLive(f.desktop);
  assert.equal(report.catalogMatches, false);
  assert.equal(report.toolInterfacesMatch, true);
  assert.equal(report.usageRead.matched, true);
  assert.deepEqual(report.usageRead.fields, ['rateLimitsByLimitId']);
  assert.equal(report.quotaProbe.source, 'live-read-only-query');
  assert.equal(report.taskWrites, 0);
  assert.doesNotMatch(JSON.stringify(report), /private-fixture|usedPercent|resetsAt|accountId/);
  assert.equal(desktopPolicy(f.desktop).features.usage.supported, false, 'preflight closes its connection');
});
