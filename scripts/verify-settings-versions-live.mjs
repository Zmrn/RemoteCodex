// Explicit opt-in: only creates and changes newly registered dedicated probes.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Bridge, ROOT } from '../src/bridge.mjs';
import { OFFICIAL, desktopPolicy } from '../src/official-protocol.mjs';
import { parseModels } from '../src/settings.mjs';
import { activeTurnId, liveTurns } from '../src/state.mjs';
import { testExcludedThreadIds } from '../src/probe-safety.mjs';
if (!process.argv.includes('--create-probe')) throw Error('Use --create-probe for dedicated official settings tests');
const expected = process.argv.find(x => x.startsWith('--version='))?.slice(10);
if (!expected || !testExcludedThreadIds().length) throw Error('Expected version and current development task ID are required');
const dir = fs.mkdtempSync(path.join(ROOT, 'work/settings-live-')), b = new Bridge(dir);
const report = { source: 'official-desktop-owner', checks: [], settingsRequests: [], developmentTaskExcluded: true };
const pause = ms => new Promise(r => setTimeout(r, ms));
async function until(fn, timeout = 120000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { const result = await fn(); if (result) return result; await pause(350); }
  throw Error('Timed out waiting for confirmed official settings');
}
const settings = id => b.live.get(id)?.state?.latestThreadSettings;
const permission = s => s?.permissions ?? s?.activePermissionProfile?.id;
let id;
try {
  await b.connect();
  const policy = desktopPolicy(b.desktop);
  assert.equal(policy.detectedVersion, expected); assert.equal(policy.interfaces.settings.version, 2);
  assert.equal(policy.features.settings.supported, true); assert.equal(policy.features.createPermissions.supported, true);
  report.officialVersion = expected; report.connection = b.desktop.identity.connection;
  const originalRequest = b.desktop.ipc.request.bind(b.desktop.ipc);
  b.desktop.ipc.request = async (method, params, options) => {
    if (method === OFFICIAL.ipc.settings.method || method === OFFICIAL.ipc.start.method) b.guardProbe(params.conversationId);
    const result = await originalRequest(method, params, options);
    if (method === OFFICIAL.ipc.settings.method) {
      assert.equal(options.version, 2); assert.equal(result.result.applied, true);
      report.settingsRequests.push({ version: options.version, fields: Object.keys(params.threadSettings), applied: result.result.applied,
        nextTurnOnly: params.activeTurnId === undefined, sameOwner: result.handledByClientId === options.targetClientId });
    }
    return result;
  };
  const models = parseModels(b.desktop.catalog), model = models.find(m => m.id === 'gpt-5.6-luna') ?? models.at(-1);
  const effort = model.efforts.includes('low') ? 'low' : model.efforts[0];
  const created = await b.createProbe('settings-new-' + randomUUID(), '这是专用设置验证。只回复 SETTINGS_READY，不使用工具、不访问或修改文件。',
    { model: model.id, effort, permissionMode: 'workspace' });
  assert.equal(created.status, 'accepted'); id = report.threadId = created.result.threadId; b.guardProbe(id);
  await until(async () => { await b.follow(id); return (await b.codexThread(id)).thread.status.type === 'idle' &&
    permission(b.live.get(id)?.state?.currentPermissions) === ':workspace'; });
  report.checks.push('workspace permission confirmed on newly created task');
  const first = await b.nativeSend(id, 'settings-active-' + randomUUID(),
    '这是专用设置验证。请调用 clock.sleep 等待 35 秒，然后只回复 SETTINGS_ACTIVE_OK。不要访问文件、网络或使用其他工具。');
  assert.equal(first.status, 'accepted');
  const turnId = await until(() => activeTurnId(b.live.get(id)?.state));
  const secondModel = models.find(m => m.id === 'gpt-5.6-sol') ?? model;
  const secondEffort = secondModel.efforts.includes('low') ? 'low' : secondModel.efforts[0];
  const update = await b.updateSettings(id, 'settings-update-' + randomUUID(), { permissionMode: 'read-only', model: secondModel.id, effort: secondEffort });
  assert.equal(update.status, 'accepted');
  await until(() => permission(settings(id)) === ':read-only' && settings(id)?.model === secondModel.id && settings(id)?.effort === secondEffort);
  assert.equal(activeTurnId(b.live.get(id)?.state), turnId, 'next-turn setting must not interrupt active turn');
  report.checks.push('active v2 permission/model/effort update confirmed by live owner without interrupt');
  await until(async () => (await b.codexThread(id)).thread.status.type === 'idle');
  b.guardProbe(id);
  assert.equal((await b.nativeSend(id, 'settings-next-' + randomUUID(), '只回复 SETTINGS_NEXT_OK，不使用工具、不访问文件。')).status, 'accepted');
  const next = await until(() => { const turn = liveTurns(b.live.get(id)?.state).at(-1); return turn?.turnId !== turnId && turn?.params ? turn : null; });
  assert.equal(next.params.model ?? next.params.collaborationMode?.settings?.model, secondModel.id);
  assert.equal(permission(next.params) ?? permission(b.live.get(id)?.state.currentPermissions), ':read-only');
  await until(async () => (await b.codexThread(id)).thread.status.type === 'idle');
  report.checks.push('following turn used confirmed model and read-only permissions');
  b.guardProbe(id);
  assert.equal((await b.updateSettings(id, 'settings-idle-' + randomUUID(), { permissionMode: 'workspace' })).status, 'accepted');
  await until(() => permission(settings(id)) === ':workspace');
  report.checks.push('idle v2 permission change confirmed');
  report.result = 'PASS';
} catch (error) { report.result = 'FAIL'; report.error = error.message; process.exitCode = 1; }
finally {
  report.probeCount = Object.keys(b.db.tests).length;
  b.disconnect(); fs.writeFileSync(path.join(dir, 'result.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ output: dir, ...report }));
}
