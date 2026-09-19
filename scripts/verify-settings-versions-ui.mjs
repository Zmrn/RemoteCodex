// Shared production UI, isolated synthetic endpoints. Never writes real tasks.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { ROOT } from '../src/bridge.mjs';
import { startServer } from '../src/server.mjs';
import { OFFICIAL } from '../src/official-protocol.mjs';
import { buildCompatibilityReport } from '../src/compatibility-report.mjs';
import { fixtureCatalog, fixtureProtocols } from '../test/fixtures/interface-evidence.mjs';
const { chromium } = await import(process.env.REMOTE_BRIDGE_PLAYWRIGHT || 'playwright-core');
const dir = fs.mkdtempSync(path.join(ROOT, 'work/settings-versions-ui-'));
fs.writeFileSync(path.join(dir, 'update-settings.json'), '{"automatic":false}');
const { server, address } = await startServer({ port: 0, bridge: { dataDir: dir, on() {}, off() {}, connect: async () => {}, disconnect() {} } });
const browser = await chromium.launch({ headless: true, executablePath: process.env.REMOTE_BRIDGE_BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' });
const id = '33333333-4444-4555-8666-777777777777', checks = [];
try {
  for (const width of [1280, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 900 } }), page = await context.newPage();
    let supported = true, connected = true, created = false, active = false, reports = 0;
    const writes = [], errors = [], events = [];
    const report = () => {
      const protocols = fixtureProtocols(); protocols[0].methods[OFFICIAL.ipc.settings.method] = supported ? 2 : 3;
      return buildCompatibilityReport({ activeVersion: '26.915.4065.0', latestVersion: '26.915.4065.0', connected,
        catalog: fixtureCatalog(), activeProtocols: protocols });
    };
    page.on('pageerror', e => errors.push(e.message));
    await page.route(address + '/api/**', async route => {
      const req = route.request(), p = new URL(req.url()).pathname;
      const json = (data, code = 200) => route.fulfill({ status: code, contentType: 'application/json', body: JSON.stringify(data) });
      if (p === '/api/agents') return json({ selectedId: 'local', agents: [{ id: 'local', kind: 'local', name: '测试电脑' }] });
      if (p.endsWith('/status') || p.endsWith('/connect')) { reports++; return json({ connected, capabilities: report().features,
        existingCodexWritable: true, multiImageInput: true, imageCreation: { supported: true }, projectCreation: { local: true } }); }
      if (p.endsWith('/events')) { await new Promise(r => events.push(r)); return route.abort().catch(() => {}); }
      if (p.endsWith('/updates')) return json({ supported: false });
      if (p.endsWith('/projects')) return json({ data: { projects: [] } });
      if (p.endsWith('/models')) return connected ? json({ models: [{ id: 'fixture-model', description: 'Fixture', efforts: ['low', 'high'] }] }) : json({ error: 'offline' }, 503);
      if (p.endsWith('/usage')) return json({ status: 'unknown', weekly: [] });
      if (p.endsWith('/compatibility/report')) return json(report());
      if (p.endsWith('/queue')) return json({ confirmed: true, revision: 'fixture', messages: [], recoveries: [] });
      if (req.method() === 'POST' && ['/messages', '/settings', '/threads'].some(s => p.endsWith(s))) {
        writes.push({ p, body: req.postDataJSON() }); if (p.endsWith('/threads')) created = true;
        return json({ status: 'accepted', result: { threadId: id } });
      }
      if (p.endsWith('/threads')) return json({ data: { threads: created ? [{ id, kind: 'codex', title: '测试任务', status: active ? 'active' : 'idle' }] : [] } });
      if (p.endsWith('/threads/' + id)) return json({ data: { thread: { id, kind: 'codex', title: '测试任务', status: { type: active ? 'active' : 'idle' } },
        turns: [{ id: 'turn', status: active ? 'inProgress' : 'completed', items: [{ id: 'reply', type: 'agentMessage', text: '测试回复' }] }] },
        live: { state: { latestThreadSettings: { model: 'fixture-model', effort: 'low', permissions: ':read-only' } } } });
      return json({});
    });
    const until = async fn => { for (let i = 0; i < 200; i++) { if (await fn()) return; await new Promise(r => setTimeout(r, 50)); } throw Error('UI condition timed out'); };
    const refresh = async () => { const n = reports; await page.evaluate(() => document.getElementById('refresh').click()); await until(() => reports > n); };
    const option = value => page.locator('#settings-menu .setting-option[data-value="' + value + '"]');
    try {
      await page.goto(address); await until(() => page.locator('#prompt').isEnabled());
      await page.locator('#prompt').fill('权限修复草稿');
      await page.locator('#model-display').click(); await option('fixture-model').click();
      await page.locator('#permission-display').click(); await option('workspace').click();
      assert.equal(await page.locator('#permission-name').innerText(), '工作区权限');
      await page.locator('#image').setInputFiles(path.join(ROOT, 'fixtures/vision-probe.png'));
      supported = false; await refresh(); await page.locator('#send').click();
      await until(async () => (await page.locator('#error').innerText()).includes('沿用官方权限'));
      assert.equal(writes.length, 0);
      await page.locator('#permission-display').click();
      assert.equal(await option('workspace').isDisabled(), true);
      await option('keep').click();
      assert.equal(await page.locator('#prompt').inputValue(), '权限修复草稿');
      assert.equal(writes.length, 0);
      await page.reload(); await until(() => page.locator('#prompt').isEnabled());
      assert.equal(await page.locator('#prompt').inputValue(), '权限修复草稿');
      assert.equal(await page.locator('#permission-name').innerText(), '桌面默认权限');
      await page.locator('#send').click(); await until(() => writes.length === 1);
      assert.equal(writes[0].body.settings?.permissionMode, undefined);
      assert.equal(writes[0].body.settings?.model, 'fixture-model');
      assert.ok(writes[0].body.imageDataUrls?.length === 1 || writes[0].body.imageDataUrl, 'original image retained');
      checks.push(width + ': unsupported selection can reset without losing text, image or model; reset survives reload and default creation works');
      supported = true; active = true; await refresh(); await page.getByText('测试回复', { exact: true }).waitFor();
      await page.locator('#permission-display').click(); await option('workspace').click();
      await until(() => writes.length === 2);
      assert.ok(writes[1].p.endsWith('/settings')); assert.deepEqual(writes[1].body.settings, { permissionMode: 'workspace' });
      await until(() => page.locator('#permission-display').isEnabled());
      assert.equal(await page.locator('#permission-name').innerText(), '只读权限');
      checks.push(width + ': active permission change uses settings route and ACK never fabricates live permissions');
      await page.evaluate(() => document.getElementById('mobile-new').click());
      await page.locator('#prompt').fill('离线保留');
      await page.locator('#permission-display').click(); await option('workspace').click();
      connected = false; await refresh();
      await page.locator('#permission-display').click(); await option('keep').click();
      assert.equal(await page.locator('#prompt').inputValue(), '离线保留');
      assert.equal(writes.length, 2); assert.equal(await page.locator('#send').isDisabled(), true);
      await page.locator('#permission-display').click();
      await page.screenshot({ path: path.join(dir, 'permissions-' + width + '.png') });
      assert.equal(await option('keep').isEnabled(), true);
      assert.equal(await option('full').isDisabled(), true);
      checks.push(width + ': local reset works offline with no model catalog and makes no official write');
      assert.deepEqual(errors, []);
    } finally { events.forEach(done => done()); await context.close(); }
  }
  fs.writeFileSync(path.join(dir, 'result.json'), JSON.stringify({ checks }, null, 2));
  console.log(JSON.stringify({ output: dir, checks }));
} finally { await browser.close(); server.closeAllConnections(); await new Promise(r => server.close(r)); }
