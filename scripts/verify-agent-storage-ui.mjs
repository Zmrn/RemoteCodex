// Real registry + HTTP + shared UI; synthetic devices, no official desktop calls.
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { startServer } from "../src/server.mjs";
import { Agents } from "../src/agents.mjs";
const { chromium } = await import(process.env.REMOTE_BRIDGE_PLAYWRIGHT || "playwright-core");
const dir = fs.mkdtempSync(path.resolve("work/agent-storage-ui-"));
fs.writeFileSync(path.join(dir, "update-settings.json"), '{"automatic":false}');
const app = await startServer({ port: 0, bridge: {
  dataDir: dir, on() {}, off() {}, async connect() {}, disconnect() {},
} });
const external = new Agents(dir);
const browser = await chromium.launch({ executablePath: "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", headless: true });
const page = await browser.newPage({ viewport: { width: 1200, height: 820 } });
const errors = [], checks = [];
page.on("pageerror", e => errors.push(e.message));
await page.route(app.address + "/api/**", async route => {
  const p = new URL(route.request().url()).pathname;
  if (p === "/api/agents" || p === "/api/agents/select") return route.continue();
  let result = {};
  if (/\/(status|connect)$/.test(p)) result = { connected: true, existingCodexWritable: true, threads: {} };
  else if (p.endsWith("/projects")) result = { data: { projects: [] } };
  else if (p.endsWith("/threads")) result = { data: { threads: [] } };
  else if (p.endsWith("/models")) result = { models: [] };
  else if (p.endsWith("/usage")) result = { status: "available", weekly: [] };
  else if (p.endsWith("/updates")) result = { supported: false, currentVersion: "fixture" };
  else if (p.endsWith("/events")) return route.fulfill({ contentType: "text/event-stream", body: ": fixture\n\n" });
  return route.fulfill({ contentType: "application/json", body: JSON.stringify(result) });
});
try {
  await page.goto(app.address);
  await page.waitForFunction(() => document.querySelectorAll("#agents button").length === 1);
  assert.equal(await page.locator("#agents button").count(), 1);
  await external.save({ name: "Recovered fixture laptop", host: "100.70.8.10", port: 43128 });
  const id = external.list().agents.at(-1).id;
  await page.locator("#footer-agent").click();
  await page.locator(`[data-agent-id="${id}"]`).waitFor();
  assert.equal(await page.locator("#agents button").count(), 2);
  assert.equal(await page.locator("#agent-menu").isVisible(), true);
  checks.push("opening desktop menu refreshes a device saved after UI startup without closing the menu");
  const selection = page.waitForResponse(response => response.url().endsWith("/api/agents/select") && response.request().method() === "POST");
  await page.locator(`[data-agent-id="${id}"]`).click();
  assert.equal((await selection).status(), 200);
  await page.waitForFunction(() => document.querySelector("#agent-title").textContent === "Recovered fixture laptop");
  assert.equal(new Agents(dir).list().selectedId, id);
  checks.push("switching uses the same stable ID and persists both devices");
  await page.setViewportSize({ width: 400, height: 820 });
  await page.locator("#mobile-menu").click();
  await external.save({ name: "Second fixture", host: "100.70.8.11", port: 43128 });
  await page.locator("#footer-agent").click();
  await page.waitForFunction(() => document.querySelectorAll("#agents button").length === 3);
  checks.push("mobile drawer also refreshes saved devices");
  await page.locator("#footer-agent").click();
  fs.writeFileSync(external.file, "truncated");
  await page.locator("#footer-agent").click();
  await page.waitForFunction(() => document.body.textContent.includes("已从备份恢复读取"));
  assert.equal(await page.locator("#agents button").count(), 3);
  checks.push("backup recovery is visible and keeps every device");
  await page.locator("#footer-agent").click();
  fs.writeFileSync(external.file + ".bak", "invalid backup");
  await page.locator("#footer-agent").click();
  await page.waitForFunction(() => document.querySelector("#error").textContent.includes("未重置已有设备"));
  assert.equal(await page.locator("#agents button").count(), 3);
  assert.equal(fs.readFileSync(external.file, "utf8"), "truncated");
  assert.equal(fs.readFileSync(external.file + ".bak", "utf8"), "invalid backup");
  checks.push("read error retains displayed devices and both damaged files");
  assert.deepEqual(errors, []);
  fs.mkdirSync("evidence", { recursive: true });
  const report = { result: "passed", source: "isolated real storage, HTTP and browser; synthetic device endpoints", checks, errors };
  fs.writeFileSync("evidence/agent-storage-ui.json", JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
} catch (error) {
  console.error(JSON.stringify({ errors, ui: await page.locator("#error").textContent(), connection: await page.locator("#connection").textContent() }));
  throw error;
} finally {
  await browser.close();
  app.server.closeAllConnections();
  await new Promise(r => app.server.close(r));
}
