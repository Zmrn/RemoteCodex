// Shared production UI and isolated APIs. No official tasks or messages.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { ROOT } from '../src/bridge.mjs';
import { startServer } from '../src/server.mjs';
const { chromium } = await import(process.env.REMOTE_BRIDGE_PLAYWRIGHT || 'playwright-core');
const dir = fs.mkdtempSync(path.join(ROOT, 'work/activation-ui-'));
fs.writeFileSync(path.join(dir, 'update-settings.json'), '{"automatic":false}');
const { server, address } = await startServer({ port: 0, bridge: { dataDir: dir, on() {}, off() {}, connect: async () => {}, disconnect() {} } });
const browser = await chromium.launch({ headless: true, executablePath: process.env.REMOTE_BRIDGE_BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' });
const ids = ['11111111-2222-4333-8444-555555555555', '22222222-2222-4333-8444-555555555555'];
const png = fs.readFileSync(path.join(ROOT, 'fixtures/multi-image-a.png')), checks = [], errors = [];
try {
  for (const width of [1300, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 900 } }), page = await context.newPage();
    let loaded = false, support = true, fail = false, online = true;
    const events = [], activations = [], writes = [], releases = [];
    const status = () => ({ connected: online, existingCodexWritable: true, multiImageInput: true, viewerLeases: true,
      capabilities: { activate: { supported: support }, resume: { supported: true }, send: { supported: true }, open: { supported: true } }, taskSummary: { readReceipts: false } });
    page.on('pageerror', e => errors.push(e.message));
    await page.route(address + '/api/**', async route => {
      const req = route.request(), p = new URL(req.url()).pathname;
      const json = (data, code = 200) => route.fulfill({ status: code, contentType: 'application/json', body: JSON.stringify(data) }).catch(() => {});
      if (p === '/api/agents') return json({ selectedId: 'local', agents: [{ id: 'local', kind: 'local', name: '测试电脑' }] });
      if (p.endsWith('/events')) { await new Promise(r => events.push(r)); return route.abort().catch(() => {}); }
      if (p.endsWith('/updates')) return json({ supported: false });
      if (p.endsWith('/status') || p.endsWith('/connect')) return json(status());
      if (p.endsWith('/projects')) return json({ data: { projects: [] } });
      if (p.endsWith('/models')) return json({ models: [] });
      if (p.endsWith('/usage')) return json({ status: 'unknown', weekly: [] });
      if (p.endsWith('/activate')) {
        activations.push({ p, body: req.postDataJSON() });
        await new Promise(r => releases.push(r));
        if (fail) return json({ error: '官方会话加载超时；消息没有发送，草稿已保留，可重试加载' }, 400);
        loaded = true; return json({ threadId: ids[0], ready: true });
      }
      if (req.method() === 'POST' && /\/(messages|queue|settings|questions|approvals)$/.test(p)) {
        writes.push({ p, body: req.postDataJSON() }); return json({ status: 'accepted', result: { threadId: ids[0] } });
      }
      if (p.endsWith('/queue')) return json({ confirmed: true, revision: 'fixture', messages: [], recoveries: [] });
      if (p.endsWith('/threads')) return json({ data: { threads: ids.map((id, i) => ({ id, kind: 'codex', title: '加载测试 ' + i, status: i || loaded ? 'idle' : 'notLoaded' })) } });
      const id = ids.find(id => p.endsWith('/threads/' + id));
      if (id) return json({ data: { thread: { id, kind: 'codex', title: '加载测试 ' + ids.indexOf(id), status: { type: id === ids[0] && !loaded ? 'notLoaded' : 'idle' } },
        turns: [{ id: 'turn', status: 'completed', items: [{ id: 'reply', type: 'agentMessage', text: '历史内容 ' + ids.indexOf(id) }] }] },
        live: loaded ? { status: { confirmed: true, type: 'idle' }, state: {} } : null });
      return json({});
    });
    const until = async predicate => { for (let i = 0; i < 200; i++) { if (await predicate()) return; await new Promise(r => setTimeout(r, 25)); } throw Error('UI condition timeout'); };
    const refresh = () => page.locator('#refresh').evaluate(e => e.click());
    const select = async id => {
      if (width === 390 && !(await page.locator('body').getAttribute('class')).includes('drawer-open')) await page.locator('#mobile-menu').click();
      await page.locator('[data-thread-id="' + id + '"]').click();
      await page.waitForFunction(() => !document.querySelector('#prompt').disabled);
    };
    const addImage = () => page.locator('#image').setInputFiles({ name: 'draft.png', mimeType: 'image/png', buffer: png });
    try {
      await page.goto(address + '/?thread=' + ids[0]); await until(() => activations.length === 1);
      await page.locator('#prompt').fill('加载时继续写'); await addImage();
      assert.equal(await page.locator('#send').isDisabled(), true);
      await refresh(); await page.getByText('历史内容 0', { exact: true }).waitFor();
      assert.equal(activations.length, 1); assert.match(activations[0].body.viewerId, /^[\w-]{8,160}$/);
      assert.deepEqual(writes, []); await page.screenshot({ path: path.join(dir, 'loading-' + width + '.png') });
      releases.shift()(); await until(() => page.locator('#send').isEnabled());
      assert.equal(await page.locator('#prompt').inputValue(), '加载时继续写');
      assert.equal(await page.locator('#image').evaluate(e => e.files.length), 1);
      assert.equal(await page.locator('#task-activation').isHidden(), true); assert.deepEqual(writes, []);
      checks.push(width + 'px: selected cold task activates once; text/images survive loading and become sendable without auto-send');

      loaded = false; fail = true; await select(ids[1]); await select(ids[0]); await until(() => activations.length === 2);
      releases.shift()(); await page.locator('#retry-activation').waitFor();
      await refresh(); assert.equal(activations.length, 2);
      await page.locator('#prompt').fill('失败后继续写');
      assert.equal(await page.locator('#send').isDisabled(), true);
      assert.equal(await page.locator('body').evaluate(e => e.scrollWidth <= innerWidth), true);
      await page.screenshot({ path: path.join(dir, 'failed-' + width + '.png') });
      fail = false; await page.locator('#retry-activation').click(); await until(() => activations.length === 3);
      releases.shift()(); await until(() => page.locator('#send').isEnabled());
      assert.equal(await page.locator('#prompt').inputValue(), '失败后继续写'); assert.deepEqual(writes, []);
      checks.push(width + 'px: failed load exposes retry, preserves drafts and does not repeat on refresh');

      loaded = false; await select(ids[1]); await select(ids[0]); await until(() => activations.length === 4);
      await select(ids[1]); await page.locator('#prompt').fill('另一个任务草稿');
      releases.shift()(); await page.getByText('历史内容 1', { exact: true }).waitFor();
      assert.equal(await page.locator('#prompt').inputValue(), '另一个任务草稿');
      assert.equal(await page.locator('#task-activation').isHidden(), true); assert.deepEqual(writes, []);
      checks.push(width + 'px: late activation cannot replace another task or its draft');

      support = false; loaded = false; await refresh(); await select(ids[0]);
      await page.waitForFunction(() => document.querySelector('#writable').textContent.includes('图片暂不能发送'));
      assert.equal(activations.length, 4);
      await page.getByRole('button', { name: '移除图片 1', exact: true }).click();
      assert.equal(await page.locator('#send').isEnabled(), true); assert.deepEqual(writes, []);
      checks.push(width + 'px: older target retains plain-text resume and local drafts without an unsupported activation request');

      support = true; fail = true; await select(ids[1]); await refresh(); await select(ids[0]);
      await until(() => activations.length === 5); releases.shift()(); await page.locator('#retry-activation').waitFor();
      loaded = true; await refresh(); await until(() => page.locator('#task-activation').isHidden());
      assert.equal(activations.length, 5); assert.equal(await page.locator('#prompt').inputValue(), '失败后继续写');
      checks.push(width + 'px: fresh official recovery clears the failed-load notice without another activation');
    } finally { releases.forEach(r => r()); events.forEach(r => r()); await context.close(); }
  }
  assert.deepEqual(errors, []);
  fs.writeFileSync(path.join(dir, 'result.json'), JSON.stringify({ checks }, null, 2));
  console.log(JSON.stringify({ result: 'PASS', checks, dir }, null, 2));
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
