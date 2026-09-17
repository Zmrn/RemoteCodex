// Shared production page with synthetic official owner data; no task writes or APK.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { startServer } from '../src/server.mjs';
import { ROOT } from '../src/bridge.mjs';
import { mergeLiveTurnItems } from '../src/state.mjs';
import { compactConversation } from '../src/conversation-pages.mjs';
const { chromium } = await import(process.env.REMOTE_BRIDGE_PLAYWRIGHT || 'playwright-core');
fs.mkdirSync(path.join(ROOT, 'work'), { recursive: true });
const dir = fs.mkdtempSync(path.join(ROOT, 'work/message-times-ui-'));
fs.writeFileSync(path.join(dir, 'update-settings.json'), '{"automatic":false}');
const app = await startServer({ port: 0, bridge: { dataDir: dir, on() {}, off() {}, async connect() {}, disconnect() {} } });
const browser = await chromium.launch({ executablePath: process.env.REMOTE_BRIDGE_BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true });
const id = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee', checks = [], errors = [];
const start = Date.parse('2026-09-17T00:30:02Z');
try {
  for (const [width, zone, day, hour] of [[1300, 'Asia/Shanghai', '2026-09-17', '08'], [390, 'America/New_York', '2026-09-16', '20']]) {
    const context = await browser.newContext({ viewport: { width, height: 1100 }, timezoneId: zone });
    const page = await context.newPage();
    let time = Date.parse('2026-09-17T00:35:45Z'), mediaRequests = 0;
    await page.addInitScript(() => {
      localStorage.setItem('remote-codex-mode', 'codex');
      const fetch = window.fetch.bind(window);
      window.fetch = (url, options) => String(url).endsWith('/events') ? Promise.resolve(new Response(new ReadableStream({ start(controller) {
        options.signal.addEventListener('abort', () => controller.error(new DOMException('Aborted', 'AbortError')));
      } }), { headers: { 'content-type': 'text/event-stream' } })) : fetch(url, options);
    });
    page.on('pageerror', e => errors.push(e.message));
    await page.route(app.address + '/api/**', async route => {
      const url = new URL(route.request().url()), p = url.pathname;
      const json = data => route.fulfill({ contentType: 'application/json', body: JSON.stringify(data) }).catch(() => {});
      if (p === '/api/agents') return json({ selectedId: 'local', agents: [{ id: 'local', kind: 'local', name: '示例电脑' }] });
      if (p.endsWith('/status') || p.endsWith('/connect')) return json({ connected: true, existingCodexWritable: true });
      if (p.endsWith('/threads')) return json({ data: { threads: [{ id, kind: 'codex', title: '逐条消息时间', status: 'idle' }] } });
      if (p.endsWith('/threads/' + id)) {
        const older = !!url.searchParams.get('before'), turnId = older ? 'old' : 'turn';
        const items = older ? [{ id: 'old-reply', type: 'agentMessage', text: '较早的回复也保留官方逐条时间。' }] : [
          { id: 'user', type: 'userMessage', content: [{ type: 'text', text: '显示每段回复各自到达的时间。' }] },
          { id: 'reply', type: 'agentMessage', text: '这段回复使用官方的逐条时间。\n\n图片保持已加载状态。',
            bridgeDisplay: { text: '这段回复使用官方的逐条时间。\n\n图片保持已加载状态。', images: [{ id: 'picture-ref', name: 'sample.png', contentKey: 'same-image' }] } },
          { id: 'progress', type: 'agentMessage', text: '同一轮的下一段进度，有自己的时间。' },
          { id: 'unknown', type: 'agentMessage', text: '官方没有提供这段的时间。' },
          { id: 'record', type: 'agentMessage', text: '只有完成记录的历史单独标明来源。', bridgeRecordedAt: '2026-09-17T00:39:00Z' }
        ];
        const turn = { turnId, turnStartedAtMs: start, status: 'completed', items,
          aeonAssistantMessageStartedAtMsById: older ? { 'old-reply': Date.parse('2026-09-01T00:03:10Z') } : { reply: time, progress: start + 60000 } };
        const data = mergeLiveTurnItems({ thread: { id, kind: 'codex', status: { type: 'idle' } },
          turns: [{ id: turnId, startedAt: start / 1000, items: [] }],
          page: { pagination: 'items-v1', order: 'newest_first', nextCursor: older ? null : 'older', hasMore: !older } },
          { id, turnHistory: { history: { entitiesByKey: { [turnId]: turn } } } });
        return json({ data: compactConversation(data) });
      }
      if (p.endsWith('/media')) {
        mediaRequests++;
        return route.fulfill({ contentType: 'image/png', body: fs.readFileSync(path.join(ROOT, 'fixtures/multi-image-a.png')) });
      }
      if (p.endsWith('/queue')) return json({ confirmed: true, messages: [], recoveries: [] });
      if (p.endsWith('/models')) return json({ models: [] });
      if (p.endsWith('/projects')) return json({ data: { projects: [] } });
      if (p.endsWith('/usage')) return json({ status: 'unknown', weekly: [] });
      return json({});
    });
    const stamp = name => page.locator('[data-item-id="' + name + '"] .message-time');
    const refresh = async iso => {
      await page.locator('#refresh').evaluate(e => e.click());
      await page.waitForFunction(iso => document.querySelector('[data-item-id="reply"] time')?.getAttribute('datetime') === iso, iso);
    };
    try {
      await page.goto(app.address + '/?thread=' + id);
      await stamp('reply').waitFor();
      assert.equal(await stamp('reply').textContent(), '开始接收 ' + day + ' ' + hour + ':35:45');
      assert.equal(await stamp('progress').textContent(), '开始接收 ' + day + ' ' + hour + ':31:02');
      assert.equal(await stamp('record').textContent(), '记录于 ' + day + ' ' + hour + ':39:00');
      for (const name of ['user', 'unknown']) {
        assert.equal(await stamp(name).textContent(), '时间未知');
        assert.equal(await stamp(name).getAttribute('datetime'), null);
      }
      assert.equal(await page.locator('.message-time').filter({ hasText: '本轮开始' }).count(), 0);
      checks.push(width + 'px: same-turn distinct times, per-message source labels and missing data, ' + zone);
      await page.locator('.message-image img').scrollIntoViewIfNeeded();
      await page.waitForFunction(() => document.querySelector('.message-image')?.imageStatus === 'ready');
      await page.evaluate(() => {
        window.imageBefore = document.querySelector('.message-image img');
        window.replyBefore = document.querySelector('[data-item-id="reply"]');
      });
      const original = new Date(time).toISOString();
      await refresh(original); await refresh(original);
      time = Date.parse('2026-09-17T00:36:50Z');
      await refresh(new Date(time).toISOString());
      assert.equal(await page.evaluate(() => document.querySelector('.message-image img') === window.imageBefore &&
        document.querySelector('[data-item-id="reply"]') === window.replyBefore &&
        document.querySelector('.message-image')?.imageStatus === 'ready'), true);
      assert.equal(mediaRequests, 1);
      checks.push(width + 'px: refresh and corrected official time preserve decoded image, message node and request count');
      const layout = await page.locator('#messages .message-time').evaluateAll(nodes => nodes.map(e => ({
        opacity: getComputedStyle(e).opacity, display: getComputedStyle(e).display, width: e.getBoundingClientRect().width,
        parent: e.closest('[data-item-id]').getBoundingClientRect().width
      })));
      assert.ok(layout.every(e => e.opacity === '1' && e.display !== 'none' && e.width > 0 && e.width <= e.parent + 1));
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      await page.screenshot({ path: path.join(dir, 'timestamps-' + width + '.png') });
      await page.reload(); await stamp('reply').waitFor();
      assert.equal(await stamp('reply').getAttribute('datetime'), new Date(time).toISOString());
      checks.push(width + 'px: reopening preserves original official time and never stamps the open time; visible layout fits');
      time = null; await refresh(null);
      assert.equal(await stamp('reply').textContent(), '时间未知');
      await page.locator('#older').evaluate(e => e.click());
      await stamp('old-reply').waitFor();
      assert.equal(await stamp('old-reply').getAttribute('datetime'), '2026-09-01T00:03:10.000Z');
      assert.equal(await stamp('reply').count(), 1);
      assert.equal(await stamp('reply').textContent(), '时间未知');
      checks.push(width + 'px: removed timing evidence clears stale timestamp, older page retains its own message time');
    } catch (error) {
      await page.screenshot({ path: path.join(dir, 'failure-' + width + '.png') });
      console.log(JSON.stringify({ width, errors, error: error.message, ui: await page.locator('#error').textContent() }));
      throw error;
    } finally { await context.close(); }
  }
  assert.deepEqual(errors, []);
  const result = { result: 'PASS', checks, errors, officialTaskWrites: 0, apkExecuted: false };
  fs.writeFileSync(path.join(dir, 'result.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ ...result, evidence: dir }));
} finally { await browser.close(); app.server.closeAllConnections(); await new Promise(resolve => app.server.close(resolve)); }
