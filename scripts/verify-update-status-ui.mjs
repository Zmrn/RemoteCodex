// Real shared DOM/controllers, isolated update API. No package download or installation.
import fs from 'node:fs';
import path from 'node:path';
import { startServer } from '../src/server.mjs';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
fs.mkdirSync(path.join(root, 'work'), { recursive: true });
const output = fs.mkdtempSync(path.join(root, 'work/update-status-ui-'));
const { chromium } = await import(process.env.REMOTE_BRIDGE_PLAYWRIGHT || 'playwright-core');
fs.writeFileSync(path.join(output, 'update-settings.json'), '{"automatic":false}');
const { server, address } = await startServer({ port: 0,
  bridge: { dataDir: output, on() {}, off() {}, connect: async () => {}, disconnect() {} } });
const browser = await chromium.launch({ headless: true, executablePath: process.env.REMOTE_BRIDGE_BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } }), errors = [], checks = [];
page.on('pageerror', e => errors.push(e.message));
try {
  // Instantiate the update controllers only; serve their modules through the real asset allowlist.
  await page.route(address + '/app.js', route => route.fulfill({ contentType: 'text/javascript', body: '' }));
  await page.goto(address);
  await page.evaluate(async () => {
    const { HelpUpdates } = await import('/help-updates.mjs');
    const { DeviceSettings } = await import('/device-settings.mjs');
    window.$ = id => document.getElementById(id);
    window.state = { currentVersion: '0.10.29', latestVersion: '0.10.30', downloadedVersion: '0.10.30',
      phase: 'waiting', supported: true, available: true, automatic: false, platform: 'android',
      packageState: 'verified', checkedAt: '2026-09-10T08:00:00Z' };
    window.writes = []; window.backups = 0;
    const api = async (route, body) => {
      if (route === '/api/local-access') return { addresses: [], port: 43128, enabled: false };
      if (body !== undefined) writes.push(route);
      if (route === '/api/updates' && window.holdGet) { window.holdGet = false; return new Promise(resolve => { window.finishGet = resolve; }); }
      return structuredClone(state);
    };
    window.remoteState = { ...state, currentVersion: '0.10.28', platform: 'windows', downloadedVersion: null, packageState: 'none' };
    const agentApi = async (id, route, body) => {
      if (body !== undefined) writes.push(id + route);
      if (window.holdAgent === id && route === '/updates') { window.holdAgent = null; return new Promise(resolve => { window.finishAgent = resolve; }); }
      return structuredClone(remoteState);
    };
    const backupDrafts = async () => { backups++; if (window.holdBackup) await new Promise(resolve => { window.finishBackup = resolve; }); };
    window.helpUpdates = new HelpUpdates({ $, api, backupDrafts }); clearInterval(helpUpdates.timer);
    window.deviceSettings = new DeviceSettings({ $, api, agentApi, backupDrafts, toast: () => {} });
    $('setup-dialog').showModal();
  });
  await page.waitForFunction(() => document.getElementById('help-update-versions').textContent.includes('0.10.30'));
  const versions = () => page.locator('#help-update-versions').innerText();
  assert.match(await versions(), /当前安装\s+0.10.29[\s\S]*远端最新\s+0.10.30[\s\S]*已下载\s+0.10.30 · 已校验/);
  assert.equal(await page.locator('#help-install-update').innerText(), '安装 0.10.30');
  assert.match(await page.locator('#help-update-scope').innerText(), /手机/);
  checks.push('installed/latest/verified candidate and Android scope shown independently');
  await page.screenshot({ path: path.join(output, 'android-390.png') });
  for (const width of [390, 1300]) {
    await page.setViewportSize({ width, height: 900 });
    assert.equal(await page.locator('#help-update-versions').evaluate(el => el.scrollWidth <= el.clientWidth), true);
    assert.equal(await page.locator('#setup-dialog').evaluate(el => el.scrollWidth <= el.clientWidth), true);
  }
  checks.push('mobile and desktop dialogs fit without horizontal overflow');
  await page.evaluate(() => { state = { ...state, latestVersion: '0.10.31', phase: 'available' }; helpUpdates.render(state); });
  assert.match(await versions(), /0.10.30 · 已校验/);
  assert.match(await versions(), /已下载包较旧/);
  assert.equal(await page.locator('#help-install-update').innerText(), '下载并安装 0.10.31');
  await page.locator('#help-install-update').click();
  assert.deepEqual(await page.evaluate(() => ({ writes, backups })), { writes: ['/api/updates/install'], backups: 1 });
  checks.push('older package does not masquerade as latest, install preserves draft backup');
  await page.evaluate(() => { state = { ...state, phase: 'downloading', downloadVersion: '0.10.31', progress: 23 }; helpUpdates.render(state); });
  assert.match(await versions(), /正在下载\s+0.10.31/);
  assert.match(await page.locator('#help-update-status').innerText(), /23%/);
  assert.equal(await page.locator('#help-install-update').isDisabled(), true);
  checks.push('active download version and old verified package both visible');
  await page.evaluate(async () => {
    window.holdGet = true; helpUpdates.refresh();
    await Promise.resolve();
    state = { ...state, phase: 'available', latestVersion: '0.10.32' };
    await helpUpdates.action('check');
    finishGet({ ...state, latestVersion: '0.10.20' });
  });
  assert.match(await versions(), /远端最新\s+0.10.32/);
  assert.doesNotMatch(await versions(), /0.10.20/);
  checks.push('late pre-action polling result cannot replace the new check');
  await page.evaluate(() => { helpUpdates.render({ ...state, phase: 'error', error: '检查失败' }); });
  assert.match(await versions(), /上次确认/);
  assert.equal(await page.locator('#help-update-status').innerText(), '检查失败');
  await page.evaluate(() => helpUpdates.render({ phase: 'waiting', currentVersion: '0.10.29', latestVersion: '0.10.30', available: true, supported: true }));
  assert.match(await versions(), /已下载\s+版本未确认/); assert.doesNotMatch(await versions(), /一致|已校验/);
  checks.push('failed check and legacy server keep uncertainty explicit');
  await page.evaluate(async () => {
    $('setup-dialog').close(); $('agent-dialog').showModal();
    deviceSettings.open({ id: 'a', kind: 'remote' }); clearInterval(deviceSettings.timer);
    await Promise.resolve();
    window.holdAgent = 'a'; deviceSettings.loadUpdates(); await Promise.resolve();
    window.finishOldAgent = finishAgent;
    window.holdAgent = 'b'; deviceSettings.open({ id: 'b', kind: 'remote' }); clearInterval(deviceSettings.timer);
  });
  assert.doesNotMatch(await page.locator('#update-versions').innerText(), /0.10.28/);
  await page.evaluate(async () => {
    finishAgent(remoteState); // New device response.
    await Promise.resolve();
    finishOldAgent({ ...remoteState, currentVersion: '0.1.0' });
    await Promise.resolve();
  });
  assert.match(await page.locator('#update-versions').innerText(), /当前安装\s+0.10.28/);
  assert.match(await versions(), /当前安装\s*0.10.29/);
  checks.push('device switch clears previous details and does not change this phone version');
  await page.evaluate(async () => {
    window.holdBackup = true;
    deviceSettings.open({ id: 'local', kind: 'local' }); clearInterval(deviceSettings.timer);
    const pending = deviceSettings.updateAction('install'); await Promise.resolve();
    deviceSettings.open({ id: 'b', kind: 'remote' }); clearInterval(deviceSettings.timer);
    finishBackup(); await pending;
  });
  assert.equal(await page.evaluate(() => writes.some(x => x === 'b/updates/install')), false);
  checks.push('switching while saving drafts never redirects installation to another device');
  assert.deepEqual(errors, []);
  fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify({ status: 'PASS', checks, errors }, null, 2));
  console.log(JSON.stringify({ status: 'PASS', checks: checks.length, output }));
} finally { await browser.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
