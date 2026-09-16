// Shared production UI and local IndexedDB, synthetic targets only; no official task writes.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { ROOT } from '../src/bridge.mjs';
import { startServer } from '../src/server.mjs';
const { chromium } = await import(process.env.REMOTE_BRIDGE_PLAYWRIGHT || 'playwright-core');
fs.mkdirSync(path.join(ROOT, 'work'), { recursive: true });
const dir = fs.mkdtempSync(path.join(ROOT, 'work/offline-drafts-ui-'));
fs.writeFileSync(path.join(dir, 'update-settings.json'), '{"automatic":false}');
const { server, address } = await startServer({ port: 0, bridge: { dataDir: dir, on() {}, off() {}, connect: async () => {}, disconnect() {} } });
const browser = await chromium.launch({ headless: true, executablePath: process.env.REMOTE_BRIDGE_BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' });
const ids = ['11111111-2222-4333-8444-555555555555', '22222222-2222-4333-8444-555555555555'];
const chatId = '33333333-2222-4333-8444-555555555555';
const png = fs.readFileSync(path.join(ROOT, 'fixtures/multi-image-a.png'));
const checks = [], errors = [];
try {
  for (const width of [1300, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 900 } }), page = await context.newPage();
    const events = [], writes = [];
    let online = true, failHistory = false, active = false, readOnly = false, capable = true, notLoaded = false;
    let readNumber = 0;
    const status = () => ({ connected: online, existingCodexWritable: true, multiImageInput: true,
      imageCreation: { supported: true }, steer: { supported: true }, chat: { sendText: capable },
      readOnlyThreadIds: readOnly ? [ids[0]] : [], taskSummary: { readReceipts: false } });
    page.on('pageerror', e => errors.push(e.message));
    await page.route(address + '/api/**', async route => {
      const req = route.request(), p = new URL(req.url()).pathname;
      const json = (data, code = 200) => route.fulfill({ status: code, contentType: 'application/json', body: JSON.stringify(data) });
      if (p === '/api/agents') return json({ selectedId: 'local', agents: [
        { id: 'local', kind: 'local', name: '本机测试' },
        { id: 'laptop', kind: 'remote', host: '100.64.0.2', port: 43128, name: '另一设备' },
      ] });
      if (p.endsWith('/events')) { await new Promise(r => events.push(r)); return route.abort().catch(() => {}); }
      if (p.endsWith('/updates')) return json({ supported: false });
      if (p.endsWith('/status') || p.endsWith('/connect')) return json(status());
      if (p.endsWith('/projects')) return json({ data: { projects: [] } });
      if (p.endsWith('/models')) return json({ models: [] });
      if (p.endsWith('/usage')) return json({ status: 'unknown', weekly: [] });
      if (req.method() === 'POST' && /\/(messages|queue|threads|interrupt|read-receipt|settings|questions|approvals)$/.test(p)) {
        writes.push({ p, body: req.postDataJSON() }); return json({ status: 'accepted', result: { threadId: ids[0] } });
      }
      if (p.endsWith('/queue')) return json({ confirmed: true, revision: 'fixture', messages: [], recoveries: [] });
      if (p.endsWith('/threads')) return json({ data: { threads: [
        ...ids.map((id, i) => ({ id, kind: 'codex', title: '草稿测试 ' + i, status: active ? 'active' : 'idle' })),
        { id: chatId, kind: 'chatgpt', title: 'Chat 草稿测试', status: 'idle' },
      ] } });
      const id = [...ids, chatId].find(id => p.endsWith('/threads/' + id));
      if (id) {
        if (failHistory) return json({ error: '官方历史已变化，请刷新会话后继续加载；已显示内容和草稿已保留' }, 409);
        const state = notLoaded ? 'notLoaded' : active ? 'active' : 'idle';
        return json({ data: { thread: { id, kind: id === chatId ? 'chatgpt' : 'codex', status: { type: state } },
          turns: [{ id: 'turn', status: active ? 'inProgress' : 'completed', items: [{ id: 'reply', type: 'agentMessage', text: '官方内容 ' + ++readNumber }] }] },
          live: { activeTurnId: active ? 'turn' : null, status: { type: active ? 'running' : 'idle', confirmed: true }, state: {} } });
      }
      return json({});
    });
    const drawer = async () => {
      if (width === 390 && !(await page.locator('body').getAttribute('class')).includes('drawer-open')) await page.locator('#mobile-menu').click();
    };
    const closeDrawer = async () => {
      if (width === 390 && (await page.locator('body').getAttribute('class')).includes('drawer-open')) await page.locator('#drawer-close').click();
    };
    const select = async id => { await drawer(); await page.locator('[data-thread-id="' + id + '"]').click(); await page.waitForFunction(() => !document.querySelector('#prompt').disabled); };
    const chooseMode = async mode => {
      await drawer(); await page.locator('#mode-picker').click(); await page.locator('[data-mode="' + mode + '"]').click();
      await page.waitForFunction(m => document.body.dataset.mode === m, mode); await closeDrawer();
    };
    const device = async name => {
      await drawer(); await page.locator('#footer-agent').click(); await page.locator('#agents button').filter({ hasText: name }).click();
      await page.waitForFunction(n => document.querySelector('#destination').textContent === n, name); await closeDrawer();
    };
    const readReady = async () => page.waitForFunction(() => document.querySelector('#messages').textContent.includes('官方内容') && !document.querySelector('#older').disabled);
    const refresh = async () => page.locator('#refresh').evaluate(e => e.click());
    const addImage = async name => page.locator('#image').setInputFiles({ name, mimeType: 'image/png', buffer: png });
    const imageNames = () => page.locator('#image').evaluate(e => [...e.files].map(f => f.name));
    const save = () => page.evaluate(() => window.remoteCodexSaveDrafts());
    const waitSaved = async predicate => {
      for (let i = 0; i < 200; i++) {
        const saved = await page.evaluate(async () => (await import('/update-recovery.mjs')).readRecovery());
        if (predicate(saved)) return;
        await new Promise(r => setTimeout(r, 50));
      }
      throw Error('Local draft was not persisted');
    };
    try {
      await page.goto(address + '/?thread=' + ids[0]); await readReady();
      await page.locator('#prompt').fill('原始草稿'); await addImage('original.png');
      failHistory = true; await refresh();
      await page.waitForFunction(() => document.querySelector('#task-state').textContent.includes('刷新失败'));
      assert.equal(await page.locator('#connection').textContent(), '已连接官方桌面');
      assert.equal(await page.locator('#prompt').isEnabled(), true, 'history failure must allow local typing');
      await page.locator('#prompt').fill('读取失败后继续写');
      await addImage('offline.png'); await page.getByRole('button', { name: '移除图片 1', exact: true }).click();
      assert.deepEqual(await imageNames(), ['offline.png']);
      await page.locator('#prompt').focus(); await refresh();
      await page.waitForFunction(() => document.querySelector('#task-state').textContent.includes('刷新失败') && !document.querySelector('#older').disabled);
      assert.equal(await page.locator('#prompt').evaluate(e => e === document.activeElement), true);
      assert.equal(await page.locator('#send').isDisabled(), true);
      await page.locator('#prompt').press('Control+Enter'); await save();
      await page.screenshot({ path: path.join(dir, 'history-failed-' + width + '.png') });
      checks.push(width + 'px: connected history failure permits focused text/image editing and blocks sending');

      online = false; await page.locator('#reconnect').evaluate(e => e.click());
      await page.waitForFunction(() => document.querySelector('#connection').classList.contains('offline'));
      assert.equal(await page.locator('#prompt').isEnabled(), true);
      await page.locator('#prompt').fill('离线新增草稿');
      await waitSaved(saved => saved?.prompt === '离线新增草稿');
      // Clipboard image input uses the real shared paste handler.
      await page.locator('#prompt').evaluate((e, bytes) => {
        const data = new DataTransfer(); data.items.add(new File([new Uint8Array(bytes)], 'pasted.png', { type: 'image/png' }));
        e.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
      }, [...png]);
      assert.deepEqual(await imageNames(), ['offline.png', 'pasted.png']);
      await page.locator('#prompt').press('Enter'); await page.locator('#prompt').press('Control+Enter');
      await waitSaved(saved => saved?.prompt === '离线新增草稿' && saved?.files?.length === 2);
      await page.reload();
      await page.waitForFunction(() => document.querySelector('#prompt').value === '离线新增草稿' && !document.querySelector('#prompt').disabled);
      assert.deepEqual(await imageNames(), ['offline.png', 'pasted.png']);
      await page.locator('#prompt').fill('离线重开后继续写'); await save();
      assert.deepEqual(writes, []);
      checks.push(width + 'px: disconnected text/pasted images persist through page reload without sending');

      online = true; failHistory = false; await page.locator('#reconnect').evaluate(e => e.click()); await readReady();
      assert.equal(await page.locator('#prompt').inputValue(), '离线重开后继续写');
      assert.deepEqual(await imageNames(), ['offline.png', 'pasted.png']);
      await select(ids[1]); await readReady();
      assert.equal(await page.locator('#prompt').inputValue(), ''); assert.deepEqual(await imageNames(), []);
      await page.locator('#prompt').fill('另一任务草稿'); await select(ids[0]); await readReady();
      assert.equal(await page.locator('#prompt').inputValue(), '离线重开后继续写');
      await device('另一设备'); await select(ids[0]); await readReady();
      assert.equal(await page.locator('#prompt').inputValue(), ''); assert.deepEqual(await imageNames(), []);
      await page.locator('#prompt').fill('另一设备草稿');
      await device('本机测试'); await select(ids[0]); await readReady();
      assert.equal(await page.locator('#prompt').inputValue(), '离线重开后继续写'); assert.deepEqual(await imageNames(), ['offline.png', 'pasted.png']);
      assert.deepEqual(writes, []);
      checks.push(width + 'px: reconnect and task/device changes preserve isolated drafts without auto-send');

      notLoaded = true; await refresh(); await page.waitForFunction(() => document.querySelector('#writable').textContent.includes('图片暂不能发送'));
      assert.equal(await page.locator('#image').isEnabled(), true); assert.equal(await page.locator('#send').isDisabled(), true);
      await page.getByRole('button', { name: '移除图片 1', exact: true }).click(); await page.getByRole('button', { name: '移除图片 1', exact: true }).click();
      assert.equal(await page.locator('#send').isEnabled(), true);
      notLoaded = false; active = true; readOnly = true; await refresh();
      await page.waitForFunction(() => document.querySelector('#writable').textContent.includes('只读'));
      await page.locator('#prompt').fill('只读任务的本地草稿'); await page.locator('#prompt').press('Control+Enter'); await save();
      assert.equal(await page.locator('#send').isDisabled(), true); assert.deepEqual(writes, []);
      checks.push(width + 'px: local editing does not authorize image resume or protected-task Ctrl+Enter');

      readOnly = false; active = false; capable = false;
      await chooseMode('chat'); await select(chatId); await readReady();
      await page.locator('#prompt').fill('Chat 未开放发送时草稿');
      assert.equal(await page.locator('#image').isDisabled(), true); assert.equal(await page.locator('#send').isDisabled(), true);
      failHistory = true; await refresh(); await page.waitForFunction(() => document.querySelector('#task-state').textContent.includes('刷新失败'));
      await page.locator('#prompt').fill('Chat 历史失败后草稿'); await save(); await page.reload();
      await page.waitForFunction(() => document.querySelector('#prompt').value === 'Chat 历史失败后草稿' && !document.querySelector('#prompt').disabled);
      assert.equal(await page.locator('#send').isDisabled(), true); assert.deepEqual(writes, []);
      checks.push(width + 'px: existing Chat draft remains editable without capability/history; unsupported Chat images stay disabled');

      capable = true; failHistory = false; await refresh(); await readReady();
      await chooseMode('codex'); await readReady();
      await page.locator('#prompt').fill(''); await save(); await page.reload(); await readReady();
      await page.waitForFunction(() => !document.querySelector('#prompt').disabled);
      assert.equal(await page.locator('#prompt').inputValue(), ''); assert.deepEqual(await imageNames(), []);
      await page.locator('#prompt').fill('明确点击后发送');
      assert.deepEqual(writes, []); await page.locator('#send').click();
      await page.waitForFunction(() => document.querySelector('#prompt').value === '' && !document.querySelector('#prompt').disabled);
      assert.equal(writes.length, 1); assert.equal(writes[0].body.prompt, '明确点击后发送');
      assert.equal(writes[0].p, '/api/agents/local/bridge/threads/' + ids[0] + '/messages');
      checks.push(width + 'px: cleared drafts stay cleared; restored official state sends only after explicit click');
    } catch (error) {
      console.log(JSON.stringify({ width, checks, errors, state: await page.evaluate(async () => ({
        prompt: document.querySelector('#prompt').value, disabled: document.querySelector('#prompt').disabled,
        writable: document.querySelector('#writable').textContent, error: document.querySelector('#error')?.textContent,
        saved: await (await import('/update-recovery.mjs')).readRecovery(),
      })) }));
      throw error;
    } finally { for (const done of events) done(); await context.close(); }
  }
  assert.deepEqual(errors, []);
  const result = { result: 'PASS', checks, errors, officialTaskWrites: 0, apkExecuted: false };
  fs.writeFileSync(path.join(dir, 'result.json'), JSON.stringify(result, null, 2)); console.log(JSON.stringify({ ...result, evidence: dir }));
} finally { await browser.close(); server.closeAllConnections(); await new Promise(r => server.close(r)); }
