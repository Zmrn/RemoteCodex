import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { Bridge, ROOT } from '../src/bridge.mjs';
import { OFFICIAL, TOOLS } from '../src/official-protocol.mjs';
import { permissionOverrides, permissionPresetMatches } from '../src/settings.mjs';
import { fixtureEvidence } from './fixtures/interface-evidence.mjs';

const helper = '88888888-1111-4111-8111-111111111111';
const createdId = '99999999-1111-4111-8111-111111111111';
const owner = 'permission-preset-owner';
const presets = {
  full: { permissions: ':danger-full-access', approvalPolicy: 'never', approvalsReviewer: 'user' },
  workspace: { permissions: ':workspace', approvalPolicy: 'on-request', approvalsReviewer: 'user' },
  'read-only': { permissions: ':read-only', approvalPolicy: 'on-request', approvalsReviewer: 'user' },
};
const effective = preset => ({ ...preset, activePermissionProfile: { id: preset.permissions, extends: null } });

test('built-in permission modes include official approval policy and reviewer; keep changes nothing', () => {
  for (const [mode, expected] of Object.entries(presets)) {
    assert.deepEqual(permissionOverrides(mode), expected);
    assert.equal(permissionPresetMatches(mode, effective(expected)), true);
    assert.equal(permissionPresetMatches(mode, { ...effective(expected), approvalsReviewer: 'guardian_subagent' }), false);
    assert.equal(permissionPresetMatches(mode, { ...effective(expected), approvalPolicy: mode === 'full' ? 'on-request' : 'never' }), false);
    assert.equal(permissionPresetMatches(mode, { activePermissionProfile: { id: expected.permissions } }), false);
    assert.equal(permissionPresetMatches(mode, { ...effective(expected), activePermissionProfile: { id: 'custom-profile' } }), false);
  }
  assert.deepEqual(permissionOverrides('keep'), {});
  assert.deepEqual(permissionOverrides(), {});
  assert.equal(permissionPresetMatches('full', null), false);
});

function fixture(t, mode, initial) {
  fs.mkdirSync(path.join(ROOT, 'test/scratch'), { recursive: true });
  const dir = fs.mkdtempSync(path.join(ROOT, 'test/scratch/permission-preset-'));
  const b = new Bridge(dir), calls = [], state = { id: helper, threadRuntimeStatus: { type: 'idle' },
    latestThreadSettings: effective(initial), currentPermissions: effective(initial) };
  b.connected = true;
  b.db.tests[helper] = { title: 'RemoteBridge-Settings-' + mode };
  b.db.permissionContexts = { [mode]: helper };
  b.desktop = {
    context: helper,
    identity: { appToolsPipe: { image: 'OpenAI.Codex_26.915.4065.0_x64__fixture' } },
    call: async (name, args, context) => {
      assert.equal(name, TOOLS.createThread);
      calls.push({ kind: 'create', args, context, inherited: structuredClone(state.currentPermissions) });
      return { threadId: createdId };
    },
    ipc: { broadcast() {}, request: async (method, params, options) => {
      assert.equal(params.conversationId, helper, 'all preparation writes stay on the registered helper');
      assert.equal(options.targetClientId, owner);
      calls.push({ kind: method, params });
      if (method === OFFICIAL.ipc.settings.method) {
        // Official settings are a partial update. Omitted policy/reviewer survive.
        state.latestThreadSettings = { ...state.latestThreadSettings, ...params.threadSettings,
          activePermissionProfile: { id: params.threadSettings.permissions, extends: null } };
        return { handledByClientId: owner, result: { applied: true } };
      }
      assert.equal(method, OFFICIAL.ipc.start.method);
      state.currentPermissions = { ...state.latestThreadSettings, ...params.turnStart.request };
      return { handledByClientId: owner, result: { result: { turn: { id: 'synthetic-turn' } } } };
    } },
  };
  fixtureEvidence(b.desktop);
  b.codexThread = async () => ({ thread: { id: helper, kind: 'codex', status: state.threadRuntimeStatus } });
  b.follow = async id => { b.live.set(id, { owner, state }); return { handledByClientId: owner }; };
  t.after(() => { clearInterval(b.subscriptionTimer); b.connected = false; fs.rmSync(dir, { recursive: true }); });
  return { b, calls, state };
}

for (const [mode, initial] of [
  ['full', { ...presets.full, approvalPolicy: 'on-request' }],
  ['full', { ...presets.full, approvalsReviewer: 'guardian_subagent' }],
  ['workspace', { ...presets.workspace, approvalPolicy: 'never' }],
  ['read-only', { ...presets['read-only'], approvalPolicy: 'never' }],
]) test(`new ${mode} task repairs a matching profile with mismatched policy/reviewer before creation: ${JSON.stringify(initial)}`, async t => {
  const { b, calls } = fixture(t, mode, initial);
  const result = await b.create('create-preset-001', 'User first message', { permissionMode: mode });
  assert.equal(result.status, 'accepted');
  assert.deepEqual(calls.map(c => c.kind), [OFFICIAL.ipc.settings.method, OFFICIAL.ipc.start.method, 'create']);
  assert.deepEqual(calls[0].params.threadSettings, presets[mode]);
  assert.equal(calls[2].context, helper);
  assert.equal(permissionPresetMatches(mode, calls[2].inherited), true);
  assert.equal(calls[2].args.prompt, 'User first message');
  assert.equal((await b.create('create-preset-001', 'User first message', { permissionMode: mode })).deduplicated, true);
  assert.equal(calls.filter(c => c.kind === 'create').length, 1);
});

test('a fully matching helper is reused without another preparation message', async t => {
  const { b, calls } = fixture(t, 'full', presets.full);
  await b.create('reuse-preset-001', 'User first message', { permissionMode: 'full' });
  assert.deepEqual(calls.map(c => c.kind), ['create']);
});

test('unknown preparation acknowledgement does not dispatch the user message', async t => {
  const { b, calls } = fixture(t, 'full', presets.workspace);
  b.nativeSend = async () => ({ status: 'outcome-unknown' });
  await assert.rejects(b.create('unknown-preset-001', 'User first message', { permissionMode: 'full' }), /结果未知/);
  assert.equal(calls.length, 0);
});

test('changed permission preparation connection or owner cannot authorize creation', async t => {
  for (const change of ['connection', 'owner']) {
    const { b, calls } = fixture(t, 'full', presets.full), follow = b.follow;
    b.follow = async id => {
      const result = await follow(id);
      if (change === 'connection') b.desktop.identity = { ...b.desktop.identity };
      else b.live.get(id).owner = 'different-owner';
      return result;
    };
    await assert.rejects(b.create('changed-preset-' + change, 'User first message', { permissionMode: 'full' }), /连接已更换|所有者尚未确认/);
    assert.equal(calls.length, 0);
  }
});
