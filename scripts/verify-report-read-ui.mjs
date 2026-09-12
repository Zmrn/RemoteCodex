// Shared UI -> HTTP -> production report validation -> isolated official IPC.
// No real task writes, official UI automation, APK execution or local read store.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { Bridge, ROOT } from '../src/bridge.mjs';
import { startServer } from '../src/server.mjs';
import { markOfficialReportRead } from '../src/official-report-read.mjs';
import { OFFICIAL } from '../src/official-protocol.mjs';
import { fixtureEvidence } from '../test/fixtures/interface-evidence.mjs';
const { chromium } = await import(process.env.REMOTE_BRIDGE_PLAYWRIGHT || 'playwright-core');
fs.mkdirSync(path.join(ROOT, 'work'), { recursive: true });
const dir = fs.mkdtempSync(path.join(ROOT, 'work/report-read-ui-'));
fs.writeFileSync(path.join(dir, 'update-settings.json'), '{"automatic":false}');
const id = '99999999-9999-4999-8999-999999999999', owner = 'fixture-owner';
const bridge = new Bridge(dir), checks = [], errors = [];
let unread = true, reads = 0, sends = 0, ownerFailures = 0, reject = false, rawEmpty = true, marking = false;
const items = [
 { id: 'old', type: 'agentMessage', text: 'EARLIER\n\n' + 'Older content.\n\n'.repeat(50) },
 { id: 'files', type: 'fileChange', changes: [{ path: 'fixture.txt', diff: 'fixture diff' }] },
 { id: 'command', type: 'commandExecution', command: 'fixture command', output: 'output\n'.repeat(50), status: 'completed' },
 { id: 'report', type: 'agentMessage', text: 'FINAL_RETURN\n\n' + 'Final reply paragraph.\n\n'.repeat(20) },
];
const data = () => ({ thread: { id, title: 'Report read fixture', kind: 'codex', status: { type: 'idle' } },
 turns: [{ id: 'turn', startedAt: 1, status: 'completed', items: rawEmpty ? [] : structuredClone(items) }], page: { nextCursor: null } });
const state = () => ({ id, threadRuntimeStatus: { type: 'idle' }, hasUnreadTurn: unread,
 turnHistory: { history: { entitiesByKey: { turn: { turnId: 'turn', turnStartedAtMs: 1000, status: 'completed', items: structuredClone(items) } } } } });
const refreshLive = () => bridge.live.set(id, { owner, state: state() });
bridge.connected = true;
const status = bridge.status.bind(bridge);
bridge.status = () => ({ ...status(), existingCodexWritable: true });
bridge.desktop = { identity: { officialPid: 1 }, catalog: [],
 call: async method => { assert.equal(method, 'read_thread'); return data(); },
 owner: async () => { if (ownerFailures-- > 0) throw Error('owner snapshot not ready'); return { handledByClientId: owner }; },
 ipc: { broadcast(method, params) { assert.equal(method, OFFICIAL.ipc.readStateChanged.method); assert.equal(params.conversationId, id); sends++; if (!reject) unread = false; } } };
fixtureEvidence(bridge.desktop);
bridge.projects = async () => ({ data: { projects: [] } });
bridge.threads = async () => ({ data: { threads: [{ id, title: 'Report read fixture', kind: 'codex', status: 'idle', hostId: 'local' }] } });
bridge.models = async () => ({ models: [] }); bridge.usage = async () => ({ status: 'unavailable', weekly: [] });
bridge.connect = async () => { bridge.connected = true; return bridge.desktop.identity; };
bridge.follow = async () => { const result=marking?await bridge.desktop.owner():{handledByClientId:owner}; refreshLive(); return result; };
bridge.queue.read = () => ({ confirmed: true, revision: '1', messages: [], recoveries: [] });
bridge.disconnect = () => { bridge.connected = false; };
bridge.taskReports.stateFactory = () => ({ supported: () => true, connect: async () => {}, close() {},
 read: async () => ({ running: false, unread, runtimeKnown: true, readStateKnown: true, unknown: false, stateSource: 'official-owner-snapshot' }) });
const reader = { supported: () => true, context: async () => ({ identity: { kind: 'chatgpt', accountId: 'fixture', userId: 'fixture' }, executionHostKey: 'fixture' }), marked: async () => unread };
bridge.markOfficialReportRead = async (thread, token) => { reads++; marking=true;try{return await markOfficialReportRead(bridge, thread, token, { reader, sleep: async () => {}, attempts: 1 });}finally{marking=false;} };
const app = await startServer({ port: 0, bridge });
const browser = await chromium.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true });
const wait = ms => new Promise(r => setTimeout(r, ms));
async function open(width, outcome = 'success') {
 unread = true; reads = sends = 0; ownerFailures = 0;
 reject = outcome === 'unconfirmed'; refreshLive();
 const context = await browser.newContext({ viewport: { width, height: 800 } }), page = await context.newPage();
 page.on('pageerror', e => errors.push(e.message));
 await page.addInitScript(() => { window.fixtureFocus = false; Object.defineProperty(document, 'hasFocus', { value: () => window.fixtureFocus }); });
 await page.route('**/api/**', route => {
  const req = route.request(), p = new URL(req.url()).pathname;
  if (outcome === 'lost' && p.endsWith('/read-receipt')) { reads++; return route.abort(); }
  if (req.method() !== 'GET' && !/\/(follow|connect|activity|select|read-receipt)$/.test(p)) return route.abort();
  return route.continue();
 });
 await page.goto(app.address + '/?thread=' + id);
 await page.locator('[data-item-id="report"] .message-body').waitFor();
 await page.locator('.thread-dot.unread').waitFor({ state: 'attached' });
 ownerFailures = outcome === 'retry' ? 1 : outcome === 'exhaust' ? 100 : 0;
 return { context, page };
}
async function showReplyEnd(page, focus = true) {
 return page.evaluate(focus => {
  const s = document.querySelector('#message-scroll');
  document.querySelectorAll('.result-card').forEach(e => { e.open = true; });
  const body = document.querySelector('[data-item-id="report"] .message-body');
  s.scrollTop += body.getBoundingClientRect().bottom - s.getBoundingClientRect().bottom + 30;
  window.fixtureFocus = focus; s.dispatchEvent(new Event('scroll')); window.dispatchEvent(new Event('focus'));
  return { gap: s.scrollHeight - s.scrollTop - s.clientHeight, bottom: body.getBoundingClientRect().bottom, viewport: s.getBoundingClientRect().bottom };
 }, focus);
}
try {
 for (const width of [1300, 390]) {
  const { context, page } = await open(width);
  await showReplyEnd(page, false); await wait(950); assert.equal(reads, 0, 'background view must not acknowledge');
  await page.evaluate(() => { const s = document.querySelector('#message-scroll'); s.scrollTop = 0; window.fixtureFocus = true; s.dispatchEvent(new Event('scroll')); });
  await wait(950); assert.equal(reads, 0, 'only older content visible');
  const position = await showReplyEnd(page);
  assert.ok(position.gap > 80, 'report visible but optional records extend beyond the old bottom threshold');
  await page.locator('#prompt').fill('DRAFT_PRESERVED');
  await page.waitForFunction(task => document.querySelector(`[data-thread-id="${task}"]`)?.title.includes('官方已读状态'), id);
  assert.equal(reads, 1); assert.equal(sends, 1); assert.equal(unread, false);
  assert.equal(await page.locator('#prompt').inputValue(), 'DRAFT_PRESERVED');
  await showReplyEnd(page); await wait(1000); assert.equal(reads, 1, 'confirmed notification is not repeated');
  checks.push(`${width}px: empty official history + visible owner reply + expanded trailing cards clears only after official notification/confirmation; older/background views and draft protected`);
  await context.close();
 }
 for (const outcome of ['retry', 'unconfirmed', 'lost', 'exhaust']) {
  const { context, page } = await open(1300, outcome);
  await showReplyEnd(page);
  if (outcome === 'retry') {
   await page.waitForFunction(task => document.querySelector(`[data-thread-id="${task}"]`)?.title.includes('官方已读状态'), id);
   assert.equal(reads, 2); assert.equal(sends, 1);
  } else {
   const end = Date.now() + 11000, expected = outcome === 'exhaust' ? 3 : 1;
   while (reads < expected && Date.now() < end) await wait(100);
   await showReplyEnd(page); await wait(2500);
   assert.equal(reads, expected); assert.equal(sends, outcome === 'unconfirmed' ? 1 : 0);
   assert.equal(await page.locator('.thread-dot.unread').count(), 1, 'unconfirmed official state must retain its blue dot');
  }
  checks.push(outcome + ': bounded pre-dispatch retries; no resend or local blue-dot clearing for unknown outcomes');
  await context.close();
 }
 const { context, page } = await open(1300, 'retry');
 await showReplyEnd(page);
 while (!reads) await wait(100);
 await page.evaluate(() => { window.fixtureFocus = false; document.dispatchEvent(new Event('visibilitychange')); });
 await wait(3000); assert.equal(reads, 1); assert.equal(sends, 0);
 checks.push('leaving the readable foreground cancels a pending safe retry');
 await context.close();
 assert.deepEqual(errors, []); assert.ok(!fs.existsSync(path.join(dir, 'task-receipts.json')));
 const result = { result: 'PASS', checks, errors, officialTaskWrites: 0, apkExecuted: false };
 fs.writeFileSync(path.join(dir, 'result.json'), JSON.stringify(result, null, 2)); console.log(JSON.stringify(result));
} finally { await browser.close(); app.server.closeAllConnections(); await new Promise(r => app.server.close(r)); }
