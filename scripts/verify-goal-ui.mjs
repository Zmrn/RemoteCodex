// Shared production UI with isolated API fixtures; no official task writes.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startServer } from '../src/server.mjs';

const { chromium } = await import(process.env.REMOTE_BRIDGE_PLAYWRIGHT || 'playwright-core');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'remote-goal-ui-'));
fs.writeFileSync(path.join(dir, 'update-settings.json'), '{"automatic":false}');
const { server, address } = await startServer({ port: 0,
  bridge: { dataDir: dir, on() {}, off() {}, async connect() {}, disconnect() {} } });
const browser = await chromium.launch({ headless: true,
  executablePath: process.env.REMOTE_BRIDGE_BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' });
const id = '11111111-2222-4333-8444-555555555555';
const checks = [];
try {
  for (const width of [1300, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 900 } });
    const page = await context.newPage(), writes = [], errors = [];
    let created = false, goal = null;
    page.on('pageerror', error => errors.push(error.message));
    await page.route(address + '/api/**', async route => {
      const request = route.request(), name = new URL(request.url()).pathname;
      const json = value => route.fulfill({ contentType: 'application/json', body: JSON.stringify(value) });
      if (name === '/api/agents') return json({ selectedId: 'local', agents: [{ id: 'local', kind: 'local', name: '测试电脑' }] });
      if (name.endsWith('/events')) return route.abort().catch(() => {});
      if (name.endsWith('/updates')) return json({ supported: false });
      if (name.endsWith('/status') || name.endsWith('/connect')) return json({ connected: true,
        existingCodexWritable: true, capabilities: { create: { supported: true }, send: { supported: true },
          read: { supported: true }, list: { supported: true } }, taskSummary: { readReceipts: false } });
      if (name.endsWith('/projects')) return json({ data: { projects: [] } });
      if (name.endsWith('/models')) return json({ models: [] });
      if (name.endsWith('/usage')) return json({ status: 'unknown', weekly: [] });
      if (name.endsWith('/queue')) return json({ confirmed: true, messages: [], recoveries: [] });
      if (name.endsWith('/threads') && request.method() === 'POST') {
        writes.push({ name, body: request.postDataJSON() });
        created = true;
        goal = { objective: writes.at(-1).body.goal.objective, tokenBudget: writes.at(-1).body.goal.tokenBudget,
          status: 'active', tokensUsed: 0 };
        return json({ status: 'accepted', result: { threadId: id }, goalConfirmation: { confirmed: true, goal } });
      }
      if (name.endsWith('/threads')) return json({ data: { threads: created ?
        [{ id, kind: 'codex', title: '目标测试', status: { type: 'idle' } }] : [] } });
      if (name.endsWith('/threads/' + id + '/goal')) {
        if (request.method() === 'POST') {
          writes.push({ name, body: request.postDataJSON() });
          goal = { ...goal, objective: writes.at(-1).body.objective, tokensUsed: 0 };
          return json({ status: 'accepted', goalConfirmation: { confirmed: true, goal },
            ownerSync: { confirmed: false, sent: true } });
        }
        return json({ goal, source: 'official-codex-app-server-goal-get', desktopSynced: false });
      }
      if (name.endsWith('/threads/' + id)) return json({ data: { thread: { id, kind: 'codex', title: '目标测试',
        status: { type: 'idle' } }, turns: [] }, live: { status: { type: 'idle', confirmed: true }, state: {} } });
      return json({});
    });
    try {
      await page.goto(address);
      await page.waitForFunction(() => !document.querySelector('#prompt')?.disabled);
      await page.locator('#goal-mode-toggle').click();
      assert.equal(await page.locator('#goal-mode-toggle').getAttribute('aria-pressed'), 'true');
      await page.locator('#goal-budget').fill('1200');
      await page.locator('#prompt').fill('完成目标测试');
      await page.locator('#send').click();
      await page.waitForFunction(() => document.querySelector('#goal-card')?.hidden === false);
      assert.equal(writes[0].body.goal.objective, '完成目标测试');
      assert.equal(writes[0].body.goal.tokenBudget, 1200);
      assert.equal(await page.locator('#goal-objective').textContent(), '完成目标测试');
      assert.match(await page.locator('#goal-sync-note').textContent(), /同步尚未确认/);
      await page.locator('#goal-edit').click();
      await page.locator('#goal-dialog').waitFor({ state: 'visible' });
      await page.locator('#goal-editor').fill('继续完成更新后的目标');
      await page.locator('#goal-save').click();
      await page.waitForFunction(() => document.querySelector('#goal-objective')?.textContent === '继续完成更新后的目标');
      const edit = writes.find(row => row.name.endsWith('/threads/' + id + '/goal'));
      assert.equal(edit.body.expectedObjective, '完成目标测试');
      assert.equal(edit.body.objective, '继续完成更新后的目标');
      assert.equal(await page.locator('#goal-dialog').evaluate(element => element.open), false);
      assert.deepEqual(errors, []);
      checks.push(width + 'px: create, official card, edit, owner sync warning');
    } finally { await context.close(); }
  }
  console.log(JSON.stringify({ result: 'PASS', checks }));
} finally {
  await browser.close();
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
  fs.rmSync(dir, { recursive: true, force: true });
}
