import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { startServer } from "../src/server.mjs";
import { Bridge, ROOT } from "../src/bridge.mjs";
import { OfficialQueue, composeQueuedMessage } from "../src/queue.mjs";
const { chromium } = await import(process.env.REMOTE_BRIDGE_PLAYWRIGHT || "playwright-core");
const dir = fs.mkdtempSync(path.join(ROOT, "work/queue-progressive-"));
fs.writeFileSync(path.join(dir, "update-settings.json"), '{"automatic":false}');
const b = new Bridge(dir), id = "77777777-7777-4777-8777-777777777777";
b.connect = async () => { b.connected = true; };
b.disconnect = () => {};
const file = path.join(dir, "official-fixture.json");
const png = "data:image/png;base64," + fs.readFileSync(path.join(ROOT, "fixtures/vision-probe.png")).toString("base64");
fs.writeFileSync(file, JSON.stringify({ "queued-follow-ups": { [id]: [composeQueuedMessage("first", "队列先显示，历史和图片稍后加载", "C:/Fixture", [png, png])] } }));
b.queue = new OfficialQueue(b, file);
const { server, address, secret } = await startServer({ port: 0, bridge: b });
const browser = await chromium.launch({ executablePath: "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
const events = [], errors = [], media = [];
let historyRelease, historyDone = false;
page.on("pageerror", e => errors.push(e.message));
const checks = [];
await page.route(address + "/api/**", async route => {
  const p = new URL(route.request().url()).pathname;
  const json = data => route.fulfill({ contentType: "application/json", body: JSON.stringify(data) }).catch(() => {});
  if (p === "/api/agents") return json({ selectedId: "local", agents: [{ id: "local", kind: "local", host: "fixture", name: "队列测试" }] });
  if (p.endsWith("/events")) { await new Promise(r => events.push(r)); return route.abort().catch(() => {}); }
  if (p.endsWith("/status") || p.endsWith("/connect")) return json({ connected: true, existingCodexWritable: true, multiImageInput: true });
  if (p.endsWith("/projects")) return json({ data: { projects: [] } });
  if (p.endsWith("/threads")) return json({ data: { threads: [{ id, title: "队列测试", kind: "codex", status: "active" }] } });
  if (p.endsWith("/queue")) return route.continue();
  if (p.endsWith("/media")) { await new Promise(r => media.push(r)); return route.continue().catch(() => {}); }
  if (p.endsWith("/threads/" + id)) {
    if (!historyDone) await new Promise(r => { historyRelease = r; });
    historyDone = true;
    return json({ data: { thread: { id, title: "队列测试", kind: "codex", status: { type: "active" }, cwd: "C:/Fixture" }, turns: [] } });
  }
  return json({});
});
try {
  await page.goto(address + "/?thread=" + id);
  await page.waitForSelector(".queued-message");
  assert.equal(historyDone, false);
  assert.equal(await page.locator(".queue-image-slot").count(), 2);
  assert.equal(await page.locator(".queue-images img").count(), 0);
  checks.push("real metadata endpoint renders queue before delayed history and images");
  historyRelease();
  await page.waitForFunction(() => !document.querySelector(".queue-steer").disabled);
  assert.equal(await page.locator(".queue-images img").count(), 0);
  checks.push("controls enabled while images still held");
  while (!media.length) await new Promise(r => setTimeout(r, 10));
  media.splice(0).forEach(r => r());
  await page.waitForFunction(() => document.querySelectorAll(".queue-images img").length === 2);
  await page.locator(".queue-images img").first().click();
  await page.waitForSelector("#image-viewer[open]");
  await page.locator('[aria-label="关闭图片预览"]').click();
  checks.push("authenticated media endpoint, original bytes and image enlargement");
  for (const [width, height] of [[1440, 960], [390, 844], [320, 568], [844, 390]]) {
    await page.setViewportSize({ width, height });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.screenshot({ path: path.join(dir, "queue-" + width + ".png") });
  }
  checks.push("desktop and mobile geometry");
  const url = address + "/api/threads/" + id + "/queue";
  const headers = { "X-Bridge-CSRF": secret };
  assert.equal((await fetch(url)).status, 403);
  const legacy = await (await fetch(url + "?images=multi-v1", { headers })).json();
  const compact = await (await fetch(url + "?images=multi-v1&previews=refs-v1", { headers })).json();
  assert.equal(JSON.stringify(compact).includes("base64"), false);
  assert.equal(legacy.revision, compact.revision);
  assert.equal(compact.source, "official-disk");
  const ref = compact.messages[0].imageRefs[0];
  const bytes = Buffer.from(await (await fetch(address + "/api/threads/" + id + "/media?id=" + ref.id, { headers })).arrayBuffer());
  assert.deepEqual(bytes, Buffer.from(png.split(",")[1], "base64"));
  checks.push("CSRF retained, source retained, original image unchanged");
  await page.evaluate(fs.readFileSync(path.join(ROOT, "scripts/fixtures/queue-preview.js"), "utf8"));
  const lifecycle = await page.evaluate(() => window.runQueuePreviewProbe());
  assert.deepEqual(errors, []);
  const report = { passed: true, scope: "isolated production UI/server fixtures; no official task writes", checks, lifecycle, bytes: { legacy: Buffer.byteLength(JSON.stringify(legacy)), metadata: Buffer.byteLength(JSON.stringify(compact)) }, errors };
  fs.writeFileSync(path.join(dir, "report.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ ...report, reportDirectory: dir }, null, 2));
} finally {
  historyRelease?.(); events.forEach(r => r()); media.forEach(r => r());
  await browser.close(); server.closeAllConnections(); await new Promise(r => server.close(r));
}
