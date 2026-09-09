// Shared browser UI and real isolated HTTP receipt storage. No official writes.
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { Bridge, ROOT } from "../src/bridge.mjs";
import { startServer } from "../src/server.mjs";
const { chromium } = await import(process.env.REMOTE_BRIDGE_PLAYWRIGHT || "playwright-core");
fs.mkdirSync(path.join(ROOT, "test/scratch"), { recursive: true });
const dir = fs.mkdtempSync(path.join(ROOT, "test/scratch/widget-ui-"));
fs.writeFileSync(path.join(dir, "update-settings.json"), '{"automatic":false}');
const id = "99999999-9999-4999-8999-999999999999", other = "88888888-8888-4888-8888-888888888888", agent = "77777777-7777-4777-8777-777777777777";
const bridge = new Bridge(dir), errors = [], acknowledgements = [], checks = [];
let revision = 1, fail = false;
bridge.connected = true;
const originalStatus = bridge.status.bind(bridge);
bridge.status = () => ({ ...originalStatus(), existingCodexWritable: true });
bridge.desktop = { identity: { officialPid: 1 }, catalog: [], call: async (tool, args) => {
  assert.equal(tool, "read_thread"); if (fail) throw Error("unreadable fixture");
  return { thread: { id: args.threadId, title: args.threadId === id ? "Report fixture" : "Other fixture", kind: "codex", status: { type: "idle" } },
    turns: [{ id: "turn-" + revision, startedAt: revision, status: "completed",
      items: [{ id: "report-" + revision, type: "agentMessage", text: "REPORT_" + revision + "\n" + "Readable fixture paragraph.\n\n".repeat(100) }] }], page: { nextCursor: null } };
} };
bridge.projects = async () => ({ data: { projects: [] } });
bridge.threads = async () => ({ data: { threads: [id, other].map(threadId => ({ id: threadId, title: threadId === id ? "Report fixture" : "Other fixture", kind: "codex", status: "idle", updatedAt: revision })) } });
bridge.models = async () => ({ models: [] }); bridge.usage = async () => ({ status: "unavailable", weekly: [] });
bridge.connect = async () => { bridge.connected = true; return bridge.desktop.identity; };
bridge.follow = async () => ({}); bridge.queue.read = () => ({ confirmed: true, revision: "1", messages: [], recoveries: [] });
bridge.disconnect = () => { bridge.connected = false; };
const originalAck = bridge.taskReports.acknowledge.bind(bridge.taskReports);
bridge.taskReports.acknowledge = async (thread, token) => { acknowledgements.push({ thread, token }); return originalAck(thread, token); };
const app = await startServer({ port: 0, bridge });
const browser = await chromium.launch({ executablePath: "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", headless: true });
try {
 for (const width of [1300, 390]) {
  revision++; fail = false; const before = acknowledgements.length;
  const context = await browser.newContext({ viewport: { width, height: 800 } }); const page = await context.newPage();
  await page.addInitScript(() => { window.fixtureFocus = false; Object.defineProperty(document, "hasFocus", { value: () => window.fixtureFocus }); });
  page.on("pageerror", e => errors.push(e.message));
  await page.route("**/api/**", route => { const req = route.request(), p = new URL(req.url()).pathname;
    if (req.method() !== "GET" && !/\/(follow|connect|activity|select|read-receipt)$/.test(p)) return route.abort(); return route.continue(); });
  await page.goto(app.address + "/?thread=" + id);
  await page.waitForFunction(() => document.querySelector("#messages").textContent.includes("REPORT_"));
  await page.waitForTimeout(1000); assert.equal(acknowledgements.length, before, "background page must not acknowledge");
  await page.evaluate(() => { const s = document.querySelector("#message-scroll"); s.scrollTop = 0; window.fixtureFocus = true; window.dispatchEvent(new Event("focus")); });
  await page.waitForTimeout(1000); assert.equal(acknowledgements.length, before, "reading older content must not acknowledge the return");
  await page.locator("#prompt").fill("DRAFT_RETAINED");
  await page.evaluate(() => { const s = document.querySelector("#message-scroll"); s.scrollTop = s.scrollHeight; s.dispatchEvent(new Event("scroll")); });
  for (let i = 0; i < 30 && acknowledgements.length === before; i++) await page.waitForTimeout(100);
  assert.equal(acknowledgements.length, before + 1);
  const oldToken = acknowledgements.at(-1).token;
  for (let i = 0; i < 30 && !bridge.taskReports.receipts().read[id]?.includes(oldToken); i++) await page.waitForTimeout(100);
  assert.ok(bridge.taskReports.receipts().read[id].includes(oldToken));
  assert.equal(await page.locator("#prompt").inputValue(), "DRAFT_RETAINED");
  revision++;
  const summary = await bridge.taskReports.summary(); assert.equal(summary.threads.find(t => t.id === id).unread, true);
  fail = true; await page.evaluate(() => document.querySelector("#refresh").click());
  await page.waitForFunction(() => document.querySelector("#task-state").textContent.includes("刷新失败"));
  await page.evaluate(() => window.dispatchEvent(new Event("focus"))); await page.waitForTimeout(1000);
  assert.equal(acknowledgements.length, before + 1, "failed head must invalidate receipt evidence");
  fail = false; await page.evaluate(() => { window.fixtureFocus = false; });
  await page.locator(`[data-thread-id="${other}"]`).evaluate(e => e.click());
  await page.waitForFunction(() => document.querySelector("#title").textContent === "Other fixture");
  await page.waitForTimeout(1000); assert.equal(acknowledgements.length, before + 1);
  checks.push(`${width}px: hidden/older content does not acknowledge; visible final report persists; new report stays unread; errors and navigation invalidate old receipts; draft retained`);
  await context.close();
 }
 // Android deep link plumbing in the shared JS (browser fixture, not an APK test).
 const context = await browser.newContext({ viewport: { width: 390, height: 800 } }); const page = await context.newPage();
 page.on("pageerror", e => errors.push(e.message));
 await page.addInitScript(() => { Object.defineProperty(document, "hasFocus", { value: () => false }); });
 await page.route("**/*", async route => {
   const url = new URL(route.request().url());
   if (url.pathname === "/") { const response = await route.fetch(); return route.fulfill({ response, body: (await response.text()).replace("<head>", '<head><meta name="bridge-platform" content="android">') }); }
   if (url.pathname === "/api/agents") return route.fulfill({ json: { agents: [{ id: agent, kind: "remote", name: "Fixture device", host: "100.70.1.1", port: 43128, hasKey: true }], selectedId: agent } });
   if (url.pathname === "/api/agents/select") return route.fulfill({ json: { selectedId: agent } });
   if (url.pathname.startsWith(`/api/agents/${agent}/bridge/`)) { url.pathname = url.pathname.replace(`/api/agents/${agent}/bridge/`, "/api/agents/local/bridge/"); return route.continue({ url: url.toString() }); }
   return route.continue();
 });
 await page.goto(app.address + `/?widgetAgent=${agent}&widgetThread=${id}&widgetMode=codex`);
  await page.waitForFunction(() => document.querySelector("#title").textContent === "Report fixture").catch(async e => { console.error(JSON.stringify({ errors, text: (await page.locator("body").innerText()).slice(0,2400) })); throw e; });
 await page.locator("#prompt").fill("WIDGET_DRAFT");
 await page.evaluate(d => window.remoteCodexOpenTask(d), { agent, thread: other, mode: "codex" });
 await page.waitForFunction(() => document.querySelector("#title").textContent === "Other fixture");
 await page.evaluate(d => window.remoteCodexOpenTask(d), { agent, thread: id, mode: "codex" });
 await page.waitForFunction(() => document.querySelector("#prompt").value === "WIDGET_DRAFT");
 const missing = await page.evaluate(async d => { try { await window.remoteCodexOpenTask(d); return "unexpected"; } catch(e) { return e.message; } }, { agent: other, thread: id, mode: "codex" });
 assert.match(missing, /已移除/); checks.push("Android shared-JS deep link: startup task, warm navigation, device validation and isolated draft restoration");
 await context.close(); assert.deepEqual(errors, []);
 fs.mkdirSync(path.join(ROOT, "evidence"), { recursive: true });
 const result = { result: "PASS", checks, errors, officialTaskWrites: 0, apkBehaviorTested: false };
 fs.writeFileSync(path.join(ROOT, "evidence/widget-ui.json"), JSON.stringify(result, null, 2)); console.log(JSON.stringify(result));
} finally { await browser.close(); app.server.closeAllConnections(); await new Promise(r => app.server.close(r)); }
