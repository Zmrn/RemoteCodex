// Production controller UI, isolated quota fixtures, no official task writes.
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { startServer } from "../src/server.mjs";
import { ROOT } from "../src/bridge.mjs";
import { accountUsage } from "../src/usage.mjs";
const { chromium } = await import(process.env.REMOTE_BRIDGE_PLAYWRIGHT || "playwright-core");
const dir = fs.mkdtempSync(path.join(ROOT, "work/usage-ui-"));
fs.writeFileSync(path.join(dir, "update-settings.json"), '{"automatic":false}');
const { server, address } = await startServer({ port: 0, bridge: { dataDir: dir, on() {}, off() {}, connect: async () => {}, disconnect() {} } });
const browser = await chromium.launch({ executablePath: "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
const errors = [], events = [];
let used = 68, fail = false, legacy = false, delay = false, release, completedDelay;
let resetsAt = Math.floor(Date.now() / 1000) + 3 * 86400 + 5 * 3600 + 120;
const win = (usedPercent, windowDurationMins) => ({ usedPercent, windowDurationMins, resetsAt });
page.on("pageerror", e => errors.push(e.message));
await page.route(address + "/api/**", async route => {
  const req = route.request(), p = new URL(req.url()).pathname, laptop = p.includes("/laptop/");
  const json = (data, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(data) }).catch(() => {});
  if (p === "/api/agents") return json({ selectedId: "local", agents: [{ id: "local", kind: "local", host: "fixture", name: "Pro 电脑" }, { id: "laptop", kind: "remote", host: "100.64.0.2", port: 43128, name: "Plus 笔记本" }] });
  if (p.endsWith("/events")) { await new Promise(r => events.push(r)); return route.abort().catch(() => {}); }
  if (p.endsWith("/updates")) return json({ supported: false, automatic: false });
  if (p.endsWith("/status") || p.endsWith("/connect")) return json({ connected: true, existingCodexWritable: true });
  if (p.endsWith("/projects")) return json({ data: { projects: [] } });
  if (p.endsWith("/threads")) return json({ data: { threads: [] } });
  if (p.endsWith("/usage")) {
    const response = accountUsage({ rateLimitsByLimitId: {
      codex: laptop ? { planType: "plus", primary: win(used, 300), secondary: win(21, 10080) } : { planType: "pro", primary: win(80, 10080) },
      codex_bengalfox: { limitName: "GPT-5.3-Codex-Spark", primary: win(1, 300), secondary: win(2, 10080) },
    } });
    if (legacy) { delete response.schemaVersion; delete response.fiveHour; delete response.planType; }
    const held = delay && !laptop;
    if (held) { delay = false; await new Promise(r => { release = r; }); }
    if (fail) return json({ error: "fixture quota unavailable" }, 502);
    const result = await json(response); if (held) completedDelay?.(); return result;
  }
  return json({});
});
const footer = text => page.waitForFunction(t => document.querySelector("#agent-quota").textContent === t, text);
const openMenu = async () => { if (!await page.locator("#agent-menu").isVisible()) await page.locator("#footer-agent").click(); };
const choose = async name => { await openMenu(); await page.locator("#agents button").filter({ hasText: name }).click(); };
try {
  await page.goto(address); await footer("周额度剩余 20%");
  await openMenu();
  assert.equal(await page.locator("#usage-details .usage-row").first().getAttribute("data-limit-id"), "codex");
  assert.equal(await page.locator('#usage-details [data-limit-id="codex"][data-duration="300"]').count(), 0);
  assert.equal(await page.locator('#usage-details [data-limit-id="codex_bengalfox"][data-duration="300"]').count(), 1);
  assert.match(await page.locator("#usage-account-note").textContent(), /^Pro/);
  await page.locator("#agents button").filter({ hasText: "Plus 笔记本" }).click();
  await footer("5h 额度剩余 32%"); await openMenu();
  assert.match(await page.locator("#usage-account-note").textContent(), /^Plus/);
  const first = page.locator("#usage-details .usage-row").first();
  assert.equal(await first.getAttribute("data-limit-id"), "codex"); assert.equal(await first.getAttribute("data-duration"), "300");
  assert.equal(await first.locator("progress").getAttribute("value"), "32");
  assert.match(await page.locator('#usage-details [data-limit-id="codex"][data-duration="10080"]').innerText(), /79%/);
  assert.ok(await first.locator(".usage-reset").count());
  const countdown = first.locator(".usage-countdown");
  const initialCountdown = await countdown.innerText();
  assert.match(initialCountdown, /^剩余 3天5小时\d+分\d+秒$/);
  await page.waitForFunction(previous => document.querySelector(".usage-countdown").textContent !== previous, initialCountdown);
  assert.match(await first.locator(".usage-reset").innerText(), /重置 · 剩余/);
  await page.screenshot({ path: path.join(dir, "plus-desktop.png") });
  used = 100; await page.locator("#refresh-usage").click(); await footer("5h 额度剩余 0%");
  used = null; await page.locator("#refresh-usage").click(); await footer("5h 额度 · 未知");
  assert.equal(await first.locator("progress").count(), 0);
  used = 68; legacy = true; await page.locator("#refresh-usage").click(); await footer("周额度剩余 79%");
  assert.match(await page.locator("#usage-details").textContent(), /更新目标设备/);
  legacy = false; await page.locator("#refresh-usage").click(); await footer("5h 额度剩余 32%");
  fail = true; await page.locator("#refresh-usage").click(); await footer("额度 · 未知");
  assert.equal(await page.locator("#usage-details progress").count(), 0); fail = false;
  await choose("Pro 电脑"); await footer("周额度剩余 20%");
  delay = true; await openMenu();
  await page.waitForFunction(() => document.querySelector("#refresh-usage").disabled);
  await page.locator("#agents button").filter({ hasText: "Plus 笔记本" }).click(); await footer("5h 额度剩余 32%");
  assert.ok(release);
  const finished = new Promise(r => { completedDelay = r; }); release(); await finished;
  await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
  assert.equal(await page.locator("#agent-quota").textContent(), "5h 额度剩余 32%");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator("#mobile-menu").click(); await openMenu();
  await page.waitForFunction(() => !document.querySelector("#refresh-usage").disabled);
  await page.locator("#usage-details .usage-row").last().scrollIntoViewIfNeeded();
  const box = await page.locator("#agent-menu").boundingBox();
  assert.ok(box.x >= 0 && box.y >= 0 && box.x + box.width <= 390 && box.y + box.height <= 844);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  assert.match(await countdown.innerText(), /^剩余 \d+天\d+小时\d+分\d+秒$/);
  await page.screenshot({ path: path.join(dir, "plus-mobile.png") });
  resetsAt = Math.floor(Date.now() / 1000) - 1;
  await page.locator("#refresh-usage").click();
  await page.waitForFunction(() => document.querySelector(".usage-countdown").textContent === "已到重置时间，等待刷新");
  assert.ok(!(await first.innerText()).includes("-1"));
  assert.deepEqual(errors, []);
  fs.writeFileSync(path.join(dir, "result.json"), JSON.stringify({ passed: true, checks: ["Plus Codex five-hour priority", "weekly detail", "Pro Codex weekly", "Spark only in details", "zero quota", "unknown five-hour quota", "old agent compatibility", "failed read clears values", "late previous-device read discarded", "mobile panel bounds"], errors }, null, 2));
  console.log("PASS quota UI", dir);
} catch (error) { console.log(JSON.stringify({ errors })); throw error; }
finally { release?.(); for (const done of events) done(); await browser.close(); server.closeAllConnections(); await new Promise(r => server.close(r)); }
