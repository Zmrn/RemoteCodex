import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { startServer } from '../src/server.mjs';
import { ROOT } from '../src/bridge.mjs';
const { chromium } = await import(process.env.REMOTE_BRIDGE_PLAYWRIGHT || 'playwright-core');
fs.mkdirSync(path.join(ROOT, 'work'), { recursive: true });
const dir = fs.mkdtempSync(path.join(ROOT, 'work/thread-list-ui-'));
fs.writeFileSync(path.join(dir, 'update-settings.json'), '{"automatic":false}');
const { server, address } = await startServer({ port: 0, bridge: { dataDir: dir, on() {}, off() {}, connect: async () => {}, disconnect() {} } });
const browser = await chromium.launch({ headless: true, executablePath: process.env.REMOTE_BRIDGE_BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' });
const page = await browser.newPage({ viewport: { width: 1300, height: 950 } });
const id = '99999999-9999-4999-8999-999999999999', newId = '99999999-9999-4999-8999-999999999998', chatId = '99999999-9999-4999-8999-999999999997';
let title = '官方原会话名', includeNew = false, created = false, holdProjects = false, projectFinish, nextListHeld = false, listFinish, outcome = 'accepted', renameFinish;
let lists = 0, taskReads = 0; const writes = [], errors = [], events = [], checks = [];
const rows = remote => [{ id, kind: 'codex', title: remote ? '另一设备任务' : title, status: 'idle' },
  ...(includeNew && !remote ? [{ id: newId, kind: 'codex', title: '官方自动生成的标题', status: 'idle' }] : []),
  { id: chatId, kind: 'chatgpt', title: '官方 Chat', status: 'idle' }];
page.on('pageerror', e => errors.push(e.message));
await page.route(address + '/api/**', async route => {
  const req = route.request(), p = new URL(req.url()).pathname, remote = p.includes('/agents/remote/');
  const json = data => route.fulfill({ contentType: 'application/json', body: JSON.stringify(data) }).catch(() => {});
  if (p === '/api/agents') return json({ selectedId: 'local', agents: [{ id: 'local', kind: 'local', name: '测试电脑', host: 'fixture' }, { id: 'remote', kind: 'remote', name: '另一设备', host: '100.64.0.2', port: 43128 }] });
  if (p.endsWith('/events')) { await new Promise(r => events.push(r)); return route.abort().catch(() => {}); }
  if (p.endsWith('/status') || p.endsWith('/connect')) return json({ connected: true, existingCodexWritable: true, multiImageInput: true, threadTitles: { rename: true }, chat: { read: true } });
  if (p.endsWith('/updates')) return json({ supported: false });
  if (p.endsWith('/projects')) { if (holdProjects) { holdProjects = false; await new Promise(r => { projectFinish = r; }); } return json({ data: { projects: [] } }); }
  if (p.endsWith('/models')) return json({ models: [{ id: 'fixture', efforts: ['low'] }] });
  if (p.endsWith('/usage')) return json({ status: 'unknown', weekly: [] });
  if (p.endsWith('/queue')) return json({ confirmed: true, revision: 'fixture', messages: [], recoveries: [] });
  if (p.endsWith('/threads')) {
    if (req.method() === 'POST') { writes.push({ p, body: req.postDataJSON() }); created = true; return json({ status: 'accepted', result: { threadId: newId } }); }
    const data = { threads: rows(remote) }; lists++;
    if (nextListHeld) { nextListHeld = false; await new Promise(r => { listFinish = r; }); }
    return json({ data });
  }
  if (p.endsWith('/title')) {
    writes.push({ p, body: req.postDataJSON() });
    if (outcome === 'hold') await new Promise(r => { renameFinish = r; });
    return json({ status: outcome });
  }
  const task = /\/threads\/([\w-]+)$/.exec(p)?.[1];
  if (task) {
    taskReads++; const name = task === newId ? '官方自动生成的标题' : '历史工具里的旧标题';
    return json({ data: { thread: { id: task, title: name, kind: task === chatId ? 'chatgpt' : 'codex', status: { type: 'idle' } },
      turns: [{ id: 'turn', status: 'completed', items: [{ id: 'reply', type: 'agentMessage', text: remote ? '另一设备正文' : task === newId ? '刚创建会话的正文' : '原任务正文' }] }] },
      live: { state: {}, status: { type: 'idle', confirmed: true } } });
  }
  return json({});
});
const until = async fn => { for (let i = 0; i < 500; i++) { if (await fn()) return; await new Promise(r => setTimeout(r, 20)); } throw Error('UI fixture condition timed out'); };
const card = value => page.locator('.thread-card[data-thread-id="' + value + '"]');
const menu = () => page.locator('.thread-context-menu');
const dialog = () => page.locator('.thread-rename-dialog');
const refresh = async () => { const n = lists; await page.locator('#refresh').click(); await until(() => lists > n); };
const edit = async value => { await card(value).click({ button: 'right' }); await menu().getByRole('menuitem', { name: '重命名', exact: true }).click(); };
try {
  await page.goto(address); await card(id).click();
  await page.getByText('原任务正文', { exact: true }).waitFor(); assert.equal(await page.locator('#title').innerText(), title);
  await edit(id); await dialog().getByRole('textbox', { name: '会话名称' }).fill('用户指定的新名称');
  await dialog().getByRole('button', { name: '保存', exact: true }).click(); await until(() => writes.length === 1); await until(async () => !await dialog().isVisible());
  assert.equal(writes[0].body.expectedTitle, '官方原会话名'); assert.equal(writes[0].body.title, '用户指定的新名称'); assert.ok(writes[0].p.endsWith('/' + id + '/title'));
  assert.equal(await card(id).innerText(), '官方原会话名');
  title = '用户指定的新名称'; await refresh(); await until(async () => (await card(id).innerText()).includes(title));
  assert.equal(await page.locator('#title').innerText(), title); checks.push('right click renames exact task through official endpoint; ACK and stale history never override official list title');
  holdProjects = true; title = '项目慢请求时的官方标题'; await refresh(); await until(() => !!projectFinish);
  await until(async () => (await card(id).innerText()).includes(title)); projectFinish(); projectFinish = null;
  checks.push('task list renders without waiting for slow project discovery');
  nextListHeld = true; await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange'))); await until(() => !!listFinish);
  title = '较新请求返回的标题'; await refresh(); await until(async () => (await card(id).innerText()).includes(title));
  listFinish(); listFinish = null; await page.waitForTimeout(100); assert.ok((await card(id).innerText()).includes(title));
  checks.push('late older list response cannot remove new entries or restore an old title');
  await page.locator('#create').click(); await page.locator('#prompt').fill('讨论用户真正关心的需求');
  holdProjects = true; const before = lists;
  await page.locator('#prompt').press('Enter'); await until(() => created);
  await page.getByText('刚创建会话的正文', { exact: true }).waitFor();
  assert.equal(await card(newId).count(), 0); assert.equal(await page.locator('#thread-list-sync').isVisible(), true);
  assert.equal(holdProjects, true, 'creation navigation must not wait on a full project refresh'); holdProjects = false;
  includeNew = true; await until(() => lists > before); await refresh(); await card(newId).waitFor();
  await until(async () => !await page.locator('#thread-list-sync').isVisible());
  checks.push('accepted official ID opens content immediately before index membership; sync hint ends only when official list includes it');
  const oldLists = lists; await until(() => lists > oldLists); checks.push('visible list automatically polls within five seconds');
  await edit(id); outcome = 'outcome-unknown'; await dialog().getByRole('textbox', { name: '会话名称' }).fill('未知结果不重发');
  const beforeUnknown = writes.length; await dialog().getByRole('button', { name: '保存', exact: true }).click(); await until(() => writes.length > beforeUnknown);
  await until(async () => (await dialog().innerText()).includes('未知')); assert.equal(await dialog().getByRole('button', { name: '保存', exact: true }).isDisabled(), true);
  await dialog().getByRole('button', { name: '取消', exact: true }).click(); checks.push('unknown rename response preserves input and prevents repeat submission');
  outcome = 'hold'; await edit(id); await dialog().getByRole('textbox', { name: '会话名称' }).fill('目标固定');
  await dialog().getByRole('button', { name: '保存', exact: true }).click(); await until(() => !!renameFinish);
  await dialog().getByRole('button', { name: '取消', exact: true }).click();
  await page.locator('#footer-agent').click(); await page.locator('#agents button').filter({ hasText: '另一设备' }).click(); await card(id).click();
  await page.getByText('另一设备正文', { exact: true }).waitFor(); outcome = 'accepted'; renameFinish(); renameFinish = null;
  await page.waitForTimeout(300); assert.equal(await card(id).innerText(), '另一设备任务'); assert.ok(!writes.at(-1).p.includes('/agents/remote/'));
  checks.push('rename stays bound to original device; closed dialog and late success do not affect new view');
  await page.locator('#mode-picker').click(); await page.locator('[data-mode="chat"]').click(); await card(chatId).click({ button: 'right' });
  assert.equal(await menu().getByRole('menuitem').isDisabled(), true); await page.keyboard.press('Escape');
  await page.locator('#mode-picker').click(); await page.locator('[data-mode="codex"]').click();
  await page.setViewportSize({ width: 390, height: 844 });
  if (!await card(id).isVisible()) await page.locator('#mobile-menu').click();
  await card(id).dispatchEvent('pointerdown', { pointerType: 'touch', clientX: 80, clientY: 180 }); await menu().waitFor();
  await card(id).dispatchEvent('pointerup', { pointerType: 'touch' });
  await menu().getByRole('menuitem', { name: '重命名', exact: true }).click();
  assert.equal(await dialog().evaluate(e => e.scrollWidth <= e.clientWidth), true); await page.screenshot({ path: path.join(dir, 'rename-mobile.png') });
  checks.push('Chat unsupported action is disabled; touch long press opens the shared rename form within narrow viewport');
  assert.deepEqual(errors, []); fs.writeFileSync(path.join(dir, 'result.json'), JSON.stringify({ status: 'PASS', checks, writes: writes.length, scope: 'Synthetic official APIs on production UI; no real task writes, no APK' }, null, 2));
  console.log(JSON.stringify({ status: 'PASS', checks: checks.length, directory: dir }));
} catch (error) { await page.screenshot({ path: path.join(dir, 'failure.png') }); fs.writeFileSync(path.join(dir, 'failure.json'), JSON.stringify({ error: error.stack, errors, checks }, null, 2)); throw error; }
finally { events.forEach(r => r()); listFinish?.(); projectFinish?.(); renameFinish?.(); await browser.close(); server.closeAllConnections(); await new Promise(r => server.close(r)); }
