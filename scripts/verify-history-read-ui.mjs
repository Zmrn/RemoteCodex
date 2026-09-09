// Real shared UI/HTTP and Bridge fallback against isolated official fixtures.
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { Bridge, ROOT } from "../src/bridge.mjs";
import { startServer } from "../src/server.mjs";
const { chromium } = await import(process.env.REMOTE_BRIDGE_PLAYWRIGHT || "playwright-core");
fs.mkdirSync(path.join(ROOT, "test/scratch"), { recursive: true });
const dir = fs.mkdtempSync(path.join(ROOT, "test/scratch/history-read-ui-"));
fs.writeFileSync(path.join(dir, "update-settings.json"), '{"automatic":false}');
const id = "99999999-9999-4999-8999-999999999999", other = "88888888-8888-4888-8888-888888888888";
const bridge = new Bridge(dir), calls = [], errors = [], checks = [];
let failOlder = true, failHead = false;
bridge.connected = true;
const originalStatus = bridge.status.bind(bridge);
bridge.status = () => ({ ...originalStatus(), existingCodexWritable: true });
bridge.desktop = { identity: { officialPid: 1 }, catalog: [], call: async (tool, args) => {
  assert.equal(tool, "read_thread"); calls.push(args);
  if (args.threadId === id && (args.turnLimit > 1 || (args.cursor ? failOlder : failHead)))
    throw Error('{"code":-32000,"message":"Codex app tool request failed"}');
  const older = !!args.cursor;
  return { thread: { id: args.threadId, title: args.threadId === id ? "Large history fixture" : "Healthy fixture", kind: "codex", status: { type: "active" } },
    turns: [{ id: older ? "old-turn" : "recent-turn", startedAt: older ? 1 : 2, status: "completed",
      items: [{ id: older ? "old-message" : "recent-message", type: "agentMessage", text: older ? "OLDER_READABLE" : "RECENT_READABLE" }] }],
    page: { nextCursor: args.threadId === id && !older ? "official-older" : null } };
} };
bridge.projects = async () => ({ data: { projects: [] } });
bridge.threads = async () => ({ data: { threads: [id, other].map(threadId => ({ id: threadId, title: threadId === id ? "Large history fixture" : "Healthy fixture", kind: "codex", status: "active" })) } });
bridge.models = async () => ({ models: [] });
bridge.usage = async () => ({ status: "unavailable", weekly: [] });
bridge.connect = async () => { bridge.connected = true; return bridge.desktop.identity; };
bridge.follow = async () => ({});
bridge.queue.read = () => ({ confirmed: true, revision: "1", messages: [], recoveries: [] });
bridge.disconnect = () => { bridge.connected = false; };
const app = await startServer({ port: 0, bridge });
const browser = await chromium.launch({ executablePath: "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", headless: true });
try {
 for (const width of [1300, 390]) {
  failOlder = true; failHead = false;
  const context = await browser.newContext({ viewport: { width, height: 900 } });
  const page = await context.newPage();
  page.on("pageerror", e => errors.push(e.message));
  await page.route("**/api/**", route => {
    const request = route.request(), p = new URL(request.url()).pathname;
    if (request.method() !== "GET" && !/\/(follow|connect|activity|select)$/.test(p)) return route.abort();
    return route.continue();
  });
  await page.goto(app.address + "/?thread=" + id);
  await page.waitForFunction(() => document.querySelector("#messages").textContent.includes("RECENT_READABLE"));
  assert.match(await page.locator("#history-notice").textContent(), /已先显示可读内容/);
  await page.locator("#prompt").fill("KEEP_MY_DRAFT");
  await page.locator("#older").click();
  await page.waitForFunction(() => document.querySelector("#older").textContent.includes("重试"));
  assert.match(await page.locator("#messages").textContent(), /RECENT_READABLE/);
  assert.match(await page.locator("#history-notice").textContent(), /已保留当前内容/);
  const failures = calls.filter(c => c.cursor).length;
  await page.evaluate(() => document.querySelector("#refresh").click());
  await page.waitForFunction(() => !document.querySelector("#older").disabled);
  await page.waitForTimeout(650);
  assert.equal(calls.filter(c => c.cursor).length, failures);
  assert.match(await page.locator("#history-notice").textContent(), /已保留当前内容/);
  failOlder = false;
  await page.locator("#older").click();
  await page.waitForFunction(() => document.querySelector("#messages").textContent.includes("OLDER_READABLE"));
  assert.equal(await page.locator('[data-item-id="recent-message"]').count(), 1);
  assert.equal(await page.locator('[data-item-id="old-message"]').count(), 1);
  assert.equal(await page.locator("#prompt").inputValue(), "KEEP_MY_DRAFT");
  failHead = true;
  await page.evaluate(() => document.querySelector("#refresh").click());
  await page.waitForFunction(() => document.querySelector("#task-state").textContent.includes("刷新失败，已保留"));
  assert.match(await page.locator("#messages").textContent(), /OLDER_READABLE/);
  assert.equal(await page.locator("#prompt").inputValue(), "KEEP_MY_DRAFT");
  await page.locator(`[data-thread-id="${other}"]`).evaluate(e => e.click());
  await page.waitForFunction(() => document.querySelector("#title").textContent === "Healthy fixture");
  assert.equal(await page.locator("#history-notice").isVisible(), false);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  checks.push(`${width}px: readable head, retained older failure, no retry loop, exact cursor retry, retained refresh/draft, isolated task switch`);
  await context.close();
 }
 for (const width of [1300, 390]) {
   const context = await browser.newContext({ viewport: { width, height: 900 } });
   const page = await context.newPage();
   await page.addInitScript({ path: path.join(ROOT, "scripts/fixtures/history-read.js") });
   page.on("pageerror", e => errors.push(e.message));
   await page.goto(app.address);
   const result = await page.evaluate(() => window.historyReadFixture.run());
   assert.equal(result.passed, true);
   checks.push(`${width}px: ` + result.checks.join("; "));
   await context.close();
 }
 assert.deepEqual(errors, []);
 assert.deepEqual(calls.filter(c => c.threadId === id).slice(0, 2).map(c => c.turnLimit), [2, 1]);
 fs.mkdirSync(path.join(ROOT, "evidence"), { recursive: true });
 const result = { result: "PASS", checks, errors, officialTaskWrites: 0 };
 fs.writeFileSync(path.join(ROOT, "evidence/history-read-ui.json"), JSON.stringify(result, null, 2));
 console.log(JSON.stringify(result));
} finally { await browser.close(); app.server.closeAllConnections(); await new Promise(r => app.server.close(r)); }
