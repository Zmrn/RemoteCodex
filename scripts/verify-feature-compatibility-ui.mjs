// Production shared UI with synthetic official catalogs, no real task writes.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { ROOT } from '../src/bridge.mjs';
import { startServer } from '../src/server.mjs';
import { OFFICIAL } from '../src/official-protocol.mjs';
import { buildCompatibilityReport } from '../src/compatibility-report.mjs';
import { fixtureCatalog, fixtureProtocols } from '../test/fixtures/interface-evidence.mjs';
const { chromium } = await import(process.env.REMOTE_BRIDGE_PLAYWRIGHT || 'playwright-core');
const dir = fs.mkdtempSync(path.join(ROOT, 'work/feature-ui-'));
fs.writeFileSync(path.join(dir, 'update-settings.json'), '{"automatic":false}');
const { server, address } = await startServer({ port: 0, bridge: { dataDir: dir, on() {}, off() {}, connect: async () => {}, disconnect() {} } });
const browser = await chromium.launch({ headless: true, executablePath: process.env.REMOTE_BRIDGE_BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } }), events = [], writes = [], errors = [], checks = [];
const id = '33333333-4444-4555-8666-777777777777';
let missing = ['setTitle'], changed = [], active = false, reports = 0;
const report = () => {
  const protocols = fixtureProtocols(); for (const k of changed) protocols[0].methods[OFFICIAL.ipc[k].method]++;
  return buildCompatibilityReport({ activeVersion: '26.903.9818.0', latestVersion: '26.903.9818.0', connected: true,
    catalog: fixtureCatalog().filter(t => !missing.some(k => OFFICIAL.tools[k].name === t.name)), activeProtocols: protocols });
};
const status = () => { const f = report().features; return { connected: true, capabilities: f, existingCodexWritable: true, multiImageInput: true,
  steer: f.steer, interrupt: f.interrupt, threadTitles: { rename: f.rename.supported }, projectCreation: { local: f.projectCreate.supported },
  imageCreation: f.createImages, taskSummary: { readReceipts: false }, chat: { read: true, sendText: f.chatSend.supported } }; };
page.on('pageerror', e => errors.push(e.message));
await page.route(address + '/api/**', async route => {
  const req = route.request(), p = new URL(req.url()).pathname;
  const json = (data, code = 200) => route.fulfill({ status: code, contentType: 'application/json', body: JSON.stringify(data) });
  if (p === '/api/agents') return json({ selectedId: 'local', agents: [{ id: 'local', kind: 'local', name: '测试电脑' }] });
  if (p.endsWith('/status') || p.endsWith('/connect')) { reports++; return json(status()); }
  if (p.endsWith('/events')) { await new Promise(r => events.push(r)); return route.abort().catch(() => {}); }
  if (p.endsWith('/updates')) return json({ supported: false });
  if (p.endsWith('/projects')) return missing.includes('listProjects') ? json({ error: 'fixture list_projects unavailable' }, 400) : json({ data: { projects: [] } });
  if (p.endsWith('/models')) return json({ models: [] });
  if (p.endsWith('/usage')) return json({ status: 'unknown', weekly: [] });
  if (p.endsWith('/compatibility/report')) return json(report());
  if (req.method() === 'POST' && ['/messages', '/queue', '/interrupt', '/threads'].some(s => p.endsWith(s))) {
    writes.push({ p, body: req.postDataJSON() }); return json({ status: 'accepted', result: { threadId: id } });
  }
  if (p.endsWith('/queue')) return json({ confirmed: true, revision: 'fixture', messages: [], recoveries: [] });
  if (p.endsWith('/threads')) return missing.includes('listThreads') ? json({ error: 'fixture list_threads unavailable' }, 400)
    : json({ data: { threads: [{ id, kind: 'codex', title: '测试任务', status: active ? 'active' : 'idle' }] } });
  if (p.endsWith('/threads/' + id)) return json({ data: { thread: { id, kind: 'codex', title: '测试任务', status: { type: active ? 'active' : 'idle' } },
    turns: [{ id: 'turn', status: active ? 'inProgress' : 'completed', items: [{ id: 'reply', type: 'agentMessage', text: '读取正常' }] }] },
    live: { activeTurnId: active ? 'turn' : null, status: { type: active ? 'running' : 'idle', confirmed: true }, state: {} } });
  return json({});
});
const until = async fn => { for (let i = 0; i < 160; i++) { if (await fn()) return; await new Promise(r => setTimeout(r, 50)); } throw Error('UI condition timed out'); };
const refresh = async () => { const n = reports; await page.locator('#refresh').click(); await until(() => reports > n); };
try {
  await page.goto(address); await page.locator('.thread-card[data-thread-id="' + id + '"]').click();
  await page.getByText('读取正常', { exact: true }).waitFor();
  await page.locator('#prompt').fill('改名坏了仍发送');
  await page.locator('#send').click(); await until(() => writes.length === 1);
  assert.ok(writes[0].p.endsWith('/messages')); checks.push('missing rename does not disable idle send');
  active = true; changed = ['queueWrite']; await refresh();
  await page.locator('#prompt').fill('直接调整'); await until(() => page.locator('#send').isDisabled());
  assert.equal(await page.locator('#prompt').isEnabled(), true);
  await page.locator('#prompt').press('Control+Enter'); await until(() => writes.length === 2);
  assert.equal(writes[1].body.delivery, 'steer'); checks.push('queue mismatch keeps drafts editable and Ctrl+Enter operational');
  changed = ['start', 'queueWrite']; await refresh();
  await page.locator('#prompt').fill('保留草稿');
  await page.locator('#interrupt').waitFor(); assert.equal(await page.locator('#interrupt').isEnabled(), true);
  assert.equal(await page.locator('#send').isDisabled(), true); checks.push('stop remains available when sending and queue fail');
  active = false; changed = []; missing = ['listThreads', 'listProjects']; await refresh();
  await until(() => page.locator('#send').isEnabled());
  assert.equal(await page.locator('#prompt').inputValue(), '保留草稿');
  await page.locator('#send').click(); await until(() => writes.length === 3);
  assert.ok(writes[2].p.endsWith('/messages')); checks.push('list/project failure preserves connection, selected content and sending');
  // Verify the runtime feature map is visible in the production report on both layouts.
  missing = ['setTitle'];
  await page.evaluate(() => document.getElementById('help-compatibility').click());
  await page.locator('#compatibility-features').waitFor();
  assert.equal(await page.locator('[data-feature="rename"]').getAttribute('data-supported'), 'false');
  assert.equal(await page.locator('[data-feature="send"]').getAttribute('data-supported'), 'true');
  assert.doesNotMatch(await page.locator('#compatibility-versions').innerText(), /现有版本保护会限制/);
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 900 });
    assert.equal(await page.locator('#official-compatibility').evaluate(e => e.scrollWidth <= e.clientWidth), true);
    await page.screenshot({ path: path.join(dir, 'features-' + width + '.png') });
  }
  checks.push('report shows exact affected features on desktop and mobile layouts');
  assert.deepEqual(errors, []);
  fs.writeFileSync(path.join(dir, 'result.json'), JSON.stringify({ checks, writes: writes.length }, null, 2));
  console.log(JSON.stringify({ output: dir, checks }));
} finally {
  for (const done of events) done(); await browser.close(); server.closeAllConnections(); await new Promise(r => server.close(r));
}
