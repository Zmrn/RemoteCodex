// Production UI against isolated HTTP fixtures; no official task writes.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startServer } from '../src/server.mjs';

const { chromium } = await import(process.env.REMOTE_BRIDGE_PLAYWRIGHT || 'playwright-core');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'remote-send-recovery-'));
fs.writeFileSync(path.join(dir, 'update-settings.json'), '{"automatic":false}');
const { server, address } = await startServer({ port: 0, bridge: { dataDir: dir, on() {}, off() {}, async connect() {}, disconnect() {} } });
const browser = await chromium.launch({ headless: true, executablePath: process.env.REMOTE_BRIDGE_BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' });
const id = '11111111-2222-4333-8444-555555555555';
try {
  for (const width of [1300, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 900 } });
    const page = await context.newPage(), writes = [], errors = [], events = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route(address + '/api/**', async route => {
      const request = route.request(), name = new URL(request.url()).pathname;
      const json = (value, code = 200) => route.fulfill({ status: code, contentType: 'application/json', body: JSON.stringify(value) });
      if (name === '/api/agents') return json({ selectedId: 'local', agents: [{ id: 'local', kind: 'local', name: '测试电脑' }] });
      if (name.endsWith('/events')) { await new Promise(resolve => events.push(resolve)); return route.abort().catch(() => {}); }
      if (name.endsWith('/updates')) return json({ supported: false });
      if (name.endsWith('/status') || name.endsWith('/connect')) return json({ connected: true, existingCodexWritable: true,
        capabilities: { send: { supported: true }, resume: { supported: true } }, taskSummary: { readReceipts: false } });
      if (name.endsWith('/projects')) return json({ data: { projects: [] } });
      if (name.endsWith('/models')) return json({ models: [] });
      if (name.endsWith('/usage')) return json({ status: 'unknown', weekly: [] });
      if (name.endsWith('/threads')) return json({ data: { threads: [{ id, kind: 'codex', title: '发送测试', status: { type: 'idle' } }] } });
      if (name.endsWith('/threads/' + id)) return json({ data: { thread: { id, kind: 'codex', title: '发送测试', status: { type: 'idle' } }, turns: [] },
        live: { status: { confirmed: true, type: 'idle' }, state: {} } });
      if (request.method() === 'POST' && name.endsWith('/threads/' + id + '/messages')) {
        writes.push(request.postDataJSON());
        if (writes.length === 1) return json({ error: 'no-client-found', status: 'unknown' }, 400);
        if (writes.length === 2) return json({ status: 'outcome-unknown', error: 'no-client-found', deduplicated: true });
        return json({ status: 'accepted', result: { threadId: id } });
      }
      return json({});
    });
    try {
      await page.goto(address + '/?thread=' + id);
      try { await page.waitForFunction(() => !document.querySelector('#prompt').disabled); }
      catch (error) {
        const snapshot = await page.evaluate(() => ({ promptDisabled: document.querySelector('#prompt').disabled,
          sendDisabled: document.querySelector('#send').disabled, body: document.body.textContent.slice(0, 600),
          error: document.querySelector('#error').textContent }));
        throw Error(JSON.stringify({ message: error.message, snapshot, errors }));
      }
      await page.locator('#prompt').fill('仅发送一次的草稿');
      try { await page.waitForFunction(() => !document.querySelector('#send').disabled); }
      catch (error) {
        const snapshot = await page.evaluate(() => ({ title: document.querySelector('#title').textContent,
          prompt: document.querySelector('#prompt').value, sendDisabled: document.querySelector('#send').disabled,
          writable: document.querySelector('#writable').textContent, error: document.querySelector('#error').textContent,
          taskState: document.querySelector('#task-state').textContent, route: location.href }));
        throw Error(JSON.stringify({ message: error.message, snapshot, errors }));
      }
      await page.locator('#send').click();
      await page.getByRole('button', { name: '我已确认官方未收到，允许重新发送' }).waitFor();
      assert.equal(writes.length, 1);
      assert.equal(await page.locator('#prompt').inputValue(), '仅发送一次的草稿');
      assert.match(await page.locator('#error').textContent(), /no-client-found/);
      await page.locator('#send').click();
      await page.waitForFunction(() => document.querySelector('#error').textContent.includes('no-client-found'));
      assert.equal(writes.length, 2);
      assert.equal(writes[0].requestId, writes[1].requestId, 'normal retry must keep the protected ID');
      await page.getByRole('button', { name: '我已确认官方未收到，允许重新发送' }).click();
      assert.equal(writes.length, 2, 'confirming absence must not send');
      assert.equal(await page.locator('#prompt').inputValue(), '仅发送一次的草稿');
      await page.locator('#send').click();
      await page.waitForFunction(() => document.querySelector('#prompt').value === '');
      assert.equal(writes.length, 3);
      assert.notEqual(writes[2].requestId, writes[1].requestId);
      assert.deepEqual(errors, []);
      console.log(width + 'px: unknown send preserves draft and ID; explicit confirmation alone does not send; next click uses a new ID');
    } finally { await context.close(); }
  }
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
  fs.rmSync(dir, { recursive: true, force: true });
}
