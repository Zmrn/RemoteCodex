// Shared production assets with synthetic reports; no official task operations.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { startServer } from '../src/server.mjs';
import { buildCompatibilityReport } from '../src/compatibility-report.mjs';
import { OFFICIAL } from '../src/official-protocol.mjs';
const root = fileURLToPath(new URL('../', import.meta.url));
fs.mkdirSync(path.join(root, 'work'), { recursive: true });
const output = fs.mkdtempSync(path.join(root, 'work/compatibility-ui-'));
const { chromium } = await import(process.env.REMOTE_BRIDGE_PLAYWRIGHT || 'playwright-core');
fs.writeFileSync(path.join(output, 'update-settings.json'), '{"automatic":false}');
const { server, address } = await startServer({ port: 0,
  bridge: { dataDir: output, on() {}, off() {}, connect: async () => {}, disconnect() {} } });
const catalog = Object.values(OFFICIAL.tools).map(s => ({ name: s.name, namespace: OFFICIAL.discovery.toolsNamespace,
  inputSchema: { properties: Object.fromEntries(s.request.map(f => [f, {}])) } }));
const protocols = [{ methods: Object.fromEntries(Object.values(OFFICIAL.ipc).map(s => [s.method, s.version])) }];
const normal = buildCompatibilityReport({ activeVersion: OFFICIAL.support.verifiedVersions.at(-1), connected: true, catalog,
  activeProtocols: protocols, latestVersion: OFFICIAL.support.verifiedVersions.at(-1) });
const report = structuredClone(normal);
report.latest.version = '99.1.2.3'; report.latest.source = 'downloaded-package'; report.latest.writeSupported = false;
report.rows.find(r => r.id === 'interrupt').latest = { status: 'mismatch', version: 10, detail: '预期 v4，官方为 v10' };
report.rows.find(r => r.id === 'readThread').latest = { status: 'unknown', detail: '需新版运行后读取工具参数' };
const browser = await chromium.launch({ headless: true, executablePath: process.env.REMOTE_BRIDGE_BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' });
const page = await browser.newPage({ viewport: { width: 1300, height: 980 } }), errors = [], checks = [];
page.on('pageerror', e => errors.push(e.message));
try {
  await page.route(address + '/app.js', route => route.fulfill({ contentType: 'text/javascript', body: '' }));
  await page.goto(address);
  assert.equal(await page.locator('#help-compatibility').count(), 1);
  await page.evaluate(async ({ report, normal }) => {
    const { CompatibilityView } = await import('/compatibility-view.mjs');
    window.normal = normal; window.report = report; window.requests = []; window.toasts = [];
    window.current = { id: 'a', name: '这台电脑' };
    window.view = new CompatibilityView({ getAgent: () => current,
      getAgents: () => [current, { id: 'b', name: '公司的电脑' }], toast: text => toasts.push(text),
      agentApi: async (id, route, body, options) => {
        requests.push({ id, route, body, signal: !!options.signal });
        if (window.hold) { window.hold = false; return new Promise(resolve => { window.finish = resolve; }); }
        if (window.fail) throw Error('private-hostname');
        return structuredClone(window.legacy ? {} : id === 'a' ? report : normal);
      } });
    document.getElementById('help-compatibility').onclick = () => view.open();
    document.getElementById('setup-dialog').showModal();
  }, { report, normal });
  await page.locator('#help-compatibility').click();
  await page.waitForFunction(() => document.querySelectorAll('.compatibility-row').length === 19);
  assert.match(await page.locator('.compatibility-summary').innerText(), /19 项 · 1 项异常 · 1 项待验证/);
  assert.equal(await page.locator('.compatibility-row').first().getAttribute('data-status'), 'error');
  assert.equal(await page.locator('.compatibility-row').nth(1).getAttribute('data-status'), 'warning');
  assert.match(await page.locator('#compatibility-versions').innerText(), /目标 Remote Codex[\s\S]*正在运行的官方版[\s\S]*官方最新版[\s\S]*99.1.2.3/);
  checks.push('help entry shows three versions, red mismatches first and unknown in yellow');
  for (const width of [1300, 390]) {
    await page.setViewportSize({ width, height: 980 });
    assert.equal(await page.locator('#official-compatibility').evaluate(el => el.scrollWidth <= el.clientWidth), true);
    await page.screenshot({ path: path.join(output, `fixture-${width}.png`) });
  }
  checks.push('desktop and narrow shared UI fit without horizontal overflow');
  await page.locator('#official-compatibility input[type=checkbox]').check();
  assert.equal(await page.locator('.compatibility-row').count(), 2);
  checks.push('filter keeps only anomalies and unknowns');
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async text => { window.copied = text; } } });
  });
  await page.getByRole('button', { name: '复制检查报告', exact: true }).click();
  assert.equal((await page.evaluate(() => JSON.parse(copied))).rows.length, 19);
  assert.doesNotMatch(await page.evaluate(() => copied), /公司的电脑|private-hostname/);
  await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async () => { throw Error(); } } }));
  await page.getByRole('button', { name: '复制检查报告', exact: true }).click();
  assert.match(await page.getByRole('textbox', { name: '可手动复制的兼容性报告' }).inputValue(), /used-interfaces-only/);
  checks.push('copy includes full checklist; clipboard refusal provides manual copy');
  await page.evaluate(() => { window.hold = true; view.run(); });
  await page.locator('#compatibility-device').selectOption('b');
  await page.waitForFunction(() => document.querySelector('.compatibility-summary').textContent.includes('0 项异常'));
  await page.evaluate(async () => { finish(report); await Promise.resolve(); });
  assert.match(await page.locator('#compatibility-rows').innerText(), /没有异常或待验证/);
  assert.equal(await page.evaluate(() => current.id), 'a');
  checks.push('device switch rejects late response and preserves global device selection');
  await page.evaluate(async () => { window.legacy = true; await view.run(); });
  assert.match(await page.locator('.compatibility-summary').innerText(), /更新目标电脑/);
  assert.equal(await page.getByRole('button', { name: '复制检查报告', exact: true }).isDisabled(), true);
  await page.evaluate(async () => { window.legacy = false; window.fail = true; await view.run(); });
  assert.match(await page.locator('.compatibility-summary').innerText(), /检查设备连接/);
  assert.doesNotMatch(await page.locator('#official-compatibility').innerText(), /private-hostname/);
  checks.push('legacy endpoint and connection failure clear stale report');
  await page.evaluate(() => { window.fail = false; window.hold = true; view.run(); });
  await page.getByRole('button', { name: '关闭兼容性检查', exact: true }).click();
  await page.evaluate(async () => { finish(report); await Promise.resolve(); });
  assert.equal(await page.evaluate(() => view.report), null);
  assert.ok((await page.evaluate(() => requests)).every(r => r.body === undefined && r.route === '/compatibility/report' && r.signal));
  checks.push('closing cancels rendering and every request is read-only');
  assert.deepEqual(errors, []);
  fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify({ status: 'PASS', checks, errors }, null, 2));
  console.log(JSON.stringify({ status: 'PASS', checks: checks.length, output }));
} finally { await browser.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
