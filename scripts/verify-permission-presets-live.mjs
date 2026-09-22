// Opt-in only. All writes target newly created and registered Probe tasks.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Bridge, ROOT } from '../src/bridge.mjs';
import { OFFICIAL, desktopPolicy, protocolRequest } from '../src/official-protocol.mjs';
import { parseModels, permissionPresetMatches } from '../src/settings.mjs';
import { liveTurns } from '../src/state.mjs';
import { testExcludedThreadIds } from '../src/probe-safety.mjs';
if (!process.argv.includes('--create-probe')) throw Error('Use --create-probe for dedicated permission tests');
const expected = process.argv.find(x => x.startsWith('--version='))?.slice(10);
if (!expected || !testExcludedThreadIds().length) throw Error('Expected version and current development task ID are required');
const dir = fs.mkdtempSync(path.join(ROOT, 'work/permission-presets-live-'));
let b = new Bridge(dir);
const report = { source: 'official-desktop-owner', checks: [], developmentTaskExcluded: true };
const pause = ms => new Promise(r => setTimeout(r, ms));
async function until(fn, timeout = 120000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { const value = await fn(); if (value) return value; await pause(350); }
  throw Error('Timed out waiting for official permissions');
}
const pick = s => Object.fromEntries(['activePermissionProfile','sandboxPolicy','approvalPolicy','approvalsReviewer'].filter(k => s && Object.hasOwn(s,k)).map(k => [k,s[k]]));
async function connected() {
  await b.connect();
  assert.equal(desktopPolicy(b.desktop).detectedVersion, expected);
  const original = b.desktop.ipc.request.bind(b.desktop.ipc);
  b.desktop.ipc.request = async (method, params, options) => {
    if ([OFFICIAL.ipc.settings.method, OFFICIAL.ipc.start.method].includes(method)) b.guardProbe(params.conversationId);
    return original(method, params, options);
  };
}
async function idle(id) {
  return until(async () => { await b.follow(id); return (await b.codexThread(id)).thread.status.type === 'idle'; });
}
async function checked(id, mode) {
  await idle(id);
  await until(() => permissionPresetMatches(mode, b.live.get(id)?.state.currentPermissions));
  return pick(b.live.get(id).state.currentPermissions);
}
try {
  await connected(); report.officialVersion = expected; report.connection = b.desktop.identity.connection;
  const models = parseModels(b.desktop.catalog), model = models.find(m => m.id === 'gpt-5.6-luna') ?? models.at(-1);
  const options = { model: model.id, effort: model.efforts.includes('low') ? 'low' : model.efforts[0] };
  const ready = '这是 Remote Codex 的专用权限验证任务。只回复 READY，不使用任何工具，不访问或修改文件。';
  const initial = await b.createProbe('permission-initial-' + randomUUID(), ready, { ...options, permissionMode: 'workspace' });
  assert.equal(initial.status, 'accepted');
  const helper = initial.result.threadId; b.guardProbe(helper);
  report.initial = await checked(helper, 'workspace');
  // Reproduce the released implementation: changing only the profile leaves
  // the workspace approval policy in place. This is confined to this Probe.
  const owner = await b.follow(helper);
  const old = await protocolRequest(b.desktop.ipc, 'settings', { conversationId: helper,
    threadSettings: { permissions: ':danger-full-access' } }, { targetClientId: owner.handledByClientId, timeoutMs: 30000 });
  assert.equal(old.handledByClientId, owner.handledByClientId); assert.equal(old.result.applied, true);
  assert.equal((await b.nativeSend(helper, 'permission-old-' + randomUUID(), ready)).status, 'accepted');
  await idle(helper);
  await until(() => b.live.get(helper)?.state.currentPermissions?.activePermissionProfile?.id === ':danger-full-access');
  report.oldProfileOnly = pick(b.live.get(helper).state.currentPermissions);
  assert.equal(report.oldProfileOnly.approvalPolicy, 'on-request');
  assert.equal(permissionPresetMatches('full', report.oldProfileOnly), false);
  report.checks.push('released profile-only update reproduces full profile with old on-request policy');
  // Reuse precisely that stale preparation task as production would after upgrade.
  b.db.permissionContexts.full = helper; b.save();
  const created = await b.createProbe('permission-full-' + randomUUID(), ready, { ...options, permissionMode: 'full' });
  assert.equal(created.status, 'accepted'); const id = created.result.threadId; b.guardProbe(id);
  report.threadId = id; report.helper = await checked(helper, 'full'); report.firstTurn = await checked(id, 'full');
  report.checks.push('existing mismatched helper repaired and new task first turn has complete full-access preset');
  const previousTurn = liveTurns(b.live.get(id).state).at(-1)?.turnId;
  b.disconnect(); b = new Bridge(dir); await connected();
  report.reconnected = await checked(id, 'full');
  assert.equal((await b.nativeSend(id, 'permission-next-' + randomUUID(), ready)).status, 'accepted');
  await until(() => liveTurns(b.live.get(id)?.state).at(-1)?.turnId !== previousTurn);
  report.nextTurn = await checked(id, 'full');
  report.checks.push('Remote reconnection and following turn without permission overrides keep full access');
  assert.equal((await b.updateSettings(id, 'permission-restrict-' + randomUUID(), { permissionMode: 'read-only' })).status, 'accepted');
  assert.equal((await b.nativeSend(id, 'permission-restricted-turn-' + randomUUID(), ready)).status, 'accepted');
  report.readOnly = await checked(id, 'read-only');
  report.checks.push('switching back to read-only also restores on-request user approval policy');
  report.result = 'PASS';
} catch (error) { report.result = 'FAIL'; report.error = error.message; process.exitCode = 1; }
finally {
  report.probeCount = Object.keys(b.db.tests).length; b.disconnect();
  fs.writeFileSync(path.join(dir,'result.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify({output:dir,...report}));
}
