// Full production UI/static server, synthetic official states and isolated HTTP only.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { startServer } from '../src/server.mjs';
import { ROOT } from '../src/bridge.mjs';
import { approvalView } from '../src/approvals.mjs';
import { EVENTS } from '../src/official-protocol.mjs';
const { chromium } = await import(process.env.REMOTE_BRIDGE_PLAYWRIGHT || 'playwright-core');
fs.mkdirSync(path.join(ROOT, 'work'), { recursive: true });
const dir = fs.mkdtempSync(path.join(ROOT, 'work/command-approvals-ui-'));
fs.writeFileSync(path.join(dir, 'update-settings.json'), '{"automatic":false}');
const { server, address } = await startServer({ port: 0, bridge: { dataDir: dir, on() {}, off() {}, connect: async () => {}, disconnect() {} } });
const browser = await chromium.launch({ headless: true, executablePath: process.env.REMOTE_BRIDGE_BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' });
const page = await browser.newPage({ viewport: { width: 1300, height: 950 } });
const id = '88888888-8888-4888-8888-888888888888';
let serial = 1, pending = true, history = false, completed = false, supported = true, connected = true, unknownShape = false;
let outcome = 'accepted', finish, reads = 0;
const writes = [], errors = [], events = [], checks = [];
const request = () => ({ id: serial, method: EVENTS.commandApproval, params: { threadId: id, turnId: 'turn', itemId: 'command',
  command: "Invoke-WebRequest -Uri 'https://example.com/paper.pdf' -OutFile 'C:\\work\\paper.pdf'",
  reason: '普通下载遇到网络认证错误。是否允许在沙箱外下载这份公开论文，以核对证明细节？', cwd: 'C:\\work',
  proposedExecpolicyAmendment: ['Invoke-WebRequest', '-Uri', 'https://example.com/paper.pdf'],
  ...(unknownShape ? { networkApprovalContext: { host: 'example.com' } } : {}) } });
const state = () => ({ connected, existingCodexWritable: true, browserApprovals: { supported: true }, commandApprovals: supported ? { supported: true } : undefined,
  chat: { read: true }, interrupt: { supported: true } });
page.on('pageerror', e => errors.push(e.message));
await page.route(address + '/api/**', async route => {
  const req = route.request(), p = new URL(req.url()).pathname, remote = p.includes('/agents/remote/');
  const json = data => route.fulfill({ contentType: 'application/json', body: JSON.stringify(data) }).catch(() => {});
  if (p === '/api/agents') return json({ selectedId: 'local', agents: [
    { id: 'local', kind: 'local', name: '测试电脑', host: 'fixture' }, { id: 'remote', kind: 'remote', name: '另一设备', host: '100.64.0.2', port: 43128 },
  ] });
  if (p.endsWith('/events')) { await new Promise(r => events.push(r)); return route.abort().catch(() => {}); }
  if (p.endsWith('/status') || p.endsWith('/connect')) return json(state());
  if (p.endsWith('/updates')) return json({ supported: false });
  if (p.endsWith('/projects')) return json({ data: { projects: [] } });
  if (p.endsWith('/usage')) return json({ status: 'unknown', weekly: [] });
  if (p.endsWith('/models')) return json({ models: [] });
  if (p.endsWith('/queue')) return json({ confirmed: true, revision: 'fixture', messages: [], recoveries: [] });
  if (p.endsWith('/threads')) return json({ data: { threads: [{ id, kind: 'codex', title: '终端命令审批测试', status: 'active' }] } });
  if (p.endsWith('/approvals') || p.endsWith('/open')) {
    writes.push({ p, body: req.postDataJSON() });
    if (outcome === 'hold') await new Promise(r => { finish = r; });
    if (outcome === 'network') return route.abort('failed');
    return json({ status: outcome === 'not-sent' ? 'not-sent' : outcome === 'unknown' ? 'outcome-unknown' : 'accepted', error: outcome === 'not-sent' ? '未发送，请刷新后重试。' : undefined });
  }
  if (p.endsWith('/threads/' + id)) {
    reads++;
    return json({ data: { thread: { id, kind: 'codex', title: '终端命令审批测试', status: { type: 'active' } },
      turns: history || remote ? [{ id: 'turn', status: completed ? 'completed' : 'inProgress', items: remote ? [{ id: 'reply', type: 'agentMessage', text: '另一设备的正文' }] : [
        { id: 'command', type: 'commandExecution', command: request().params.command, status: completed ? 'completed' : 'inProgress', output: '' },
      ] }] : [] }, live: { status: { type: 'waiting-approval', confirmed: true }, state: { approvals: [], commandApprovals: pending && !remote ? [approvalView(request(), id)] : [] } } });
  }
  return json({});
});
const until = async condition => { for (let i = 0; i < 250; i++) { if (await condition()) return; await new Promise(r => setTimeout(r, 20)); } throw Error('UI fixture condition timed out'); };
const cards = () => page.locator('.approval-card:not(.approval-history)');
const refresh = async () => { const n = reads; await page.locator('#refresh').click(); await until(() => reads > n); };
const switchDevice = async name => { await page.locator('#footer-agent').click(); await page.locator('#agents button').filter({ hasText: name }).click(); await page.locator('.thread-card[data-thread-id="' + id + '"]').click(); };
try {
  await page.goto(address); await page.locator('.thread-card[data-thread-id="' + id + '"]').click();
  await cards().waitFor(); assert.equal(await page.locator('.turn').count(), 0);
  assert.equal(await cards().getByRole('button', { name: '允许一次', exact: true }).isEnabled(), true);
  assert.match(await cards().innerText(), /https:\/\/example.com/);
  assert.equal(await cards().getByRole('button', { name: '允许所有网站', exact: true }).count(), 0);
  assert.equal(await cards().locator('.approval-command code').textContent(), request().params.command);
  assert.match(await cards().locator('.approval-scope').textContent(), /Invoke-WebRequest/);
  assert.equal(await cards().getByRole('button', { name: '本会话允许', exact: true }).count(), 0);
  assert.equal(writes.length, 0); checks.push('pending command request renders with no loaded turns; no automatic approval');
  for (const width of [1300, 390, 320]) {
    await page.setViewportSize({ width, height: 950 });
    await cards().scrollIntoViewIfNeeded();
    assert.equal(await cards().evaluate(e => e.scrollWidth <= e.clientWidth), true);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.screenshot({ path: path.join(dir, `approval-${width}.png`) });
  }
  checks.push('shared desktop / narrow layouts show the complete command, reason, cwd and exact prefix before an explicit choice');
  await page.setViewportSize({ width: 1300, height: 950 });
  await cards().getByRole('button', { name: '允许一次', exact: true }).evaluate(b => { window.originalApprovalButton = b; });
  await refresh();
  assert.equal(await cards().getByRole('button', { name: '允许一次', exact: true }).evaluate(b => b === window.originalApprovalButton), true, 'unchanged request keeps attached controls');
  for (const [decision, name] of [['once', '允许一次'], ['deny', '拒绝'], ['prefix', '允许类似命令']]) {
    const n = writes.length; await cards().getByRole('button', { name, exact: true }).click(); await until(() => writes.length > n);
    await until(async () => (await cards().innerText()).includes('等待官方状态确认'));
    assert.equal(writes.at(-1).body.decision, decision); assert.equal(writes.at(-1).body.approvalRequestId, String(serial));
    assert.match(writes.at(-1).body.token, /^[a-f0-9]{64}$/); assert.ok(writes.at(-1).body.requestId);
    await refresh(); assert.equal(await cards().count(), 1); assert.equal(await cards().getByRole('button', { name: '允许一次', exact: true }).isDisabled(), true);
    serial++; await refresh(); await until(async () => await cards().getByRole('button', { name: '允许一次', exact: true }).isEnabled());
  }
  checks.push('each explicit choice carries a fingerprint and stable request ID; ACK/refresh never hide or approve the official pending request');
  history = true; await refresh(); assert.equal(await page.locator('.approval-card').count(), 1);
  pending = false; completed = true; await refresh(); await until(async () => await cards().count() === 0);
  assert.equal(await page.locator('.result-card').count(), 1);
  completed = false; await refresh(); assert.equal(await cards().count(), 0);
  checks.push('command history does not duplicate the pending card; only official request removal ends it, old unfinished history has no approval action');
  pending = true; history = false; serial++; unknownShape = true; await refresh();
  assert.equal(await cards().locator('.approval-actions button').count(), 0);
  assert.equal(await cards().getByRole('button', { name: '在官方应用中处理' }).isEnabled(), true);
  unknownShape = false; supported = false; serial++; await refresh();
  await until(async () => await cards().getByRole('button', { name: '允许一次', exact: true }).isDisabled());
  checks.push('unsupported command shape and old target never offer executable approval choices even when browser approval remains available');
  supported = true; serial++; await refresh(); outcome = 'not-sent';
  await cards().getByRole('button', { name: '允许一次', exact: true }).click();
  await until(async () => await cards().getByRole('button', { name: '允许一次', exact: true }).isEnabled());
  outcome = 'network'; await cards().getByRole('button', { name: '拒绝', exact: true }).click();
  await until(async () => (await cards().innerText()).includes('提交结果未知')); const count = writes.length;
  await refresh(); assert.equal(await cards().getByRole('button', { name: '允许一次', exact: true }).isDisabled(), true); assert.equal(writes.length, count);
  checks.push('known not-sent response allows another choice; network loss locks choices and refresh never retries');
  serial++; outcome = 'hold'; await refresh(); await cards().getByRole('button', { name: '允许一次', exact: true }).click();
  await until(() => !!finish); await switchDevice('另一设备');
  await page.getByText('另一设备的正文', { exact: true }).waitFor(); const readCount = reads;
  outcome = 'accepted'; finish(); await page.waitForTimeout(650);
  assert.equal(await cards().count(), 0); assert.equal(reads, readCount); assert.ok(!writes.at(-1).p.includes('/agents/remote/'));
  checks.push('late approval response is bound to the original device and cannot refresh or modify the new view');
  await switchDevice('测试电脑'); serial++; await refresh();
  const openCount = writes.length; await cards().getByRole('button', { name: '在官方应用中处理' }).click(); await until(() => writes.length > openCount);
  assert.ok(writes.at(-1).p.endsWith('/open')); assert.deepEqual(writes.at(-1).body, {});
  checks.push('official processing link only navigates the same task and grants no permission');
  assert.deepEqual(errors, []);
  fs.writeFileSync(path.join(dir, 'result.json'), JSON.stringify({ status: 'PASS', checks, writes: writes.length, scope: 'Isolated production UI; no official approval submitted, no APK' }, null, 2));
  console.log(JSON.stringify({ status: 'PASS', checks: checks.length, directory: dir }));
} catch (error) {
  await page.screenshot({ path: path.join(dir, 'failure.png') });
  fs.writeFileSync(path.join(dir, 'failure.json'), JSON.stringify({ error: error.stack, errors, checks }, null, 2)); throw error;
} finally { events.forEach(r => r()); finish?.(); await browser.close(); server.closeAllConnections(); await new Promise(r => server.close(r)); }
