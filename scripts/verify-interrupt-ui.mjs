import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { Bridge, ROOT } from "../src/bridge.mjs";
import { startServer } from "../src/server.mjs";
const { chromium } = await import(process.env.REMOTE_BRIDGE_PLAYWRIGHT || "playwright-core");
const dir = fs.mkdtempSync(path.join(ROOT, "work/interrupt-ui-"));
fs.writeFileSync(path.join(dir, "update-settings.json"), '{"automatic":false}');
const b = new Bridge(dir); b.connect = async () => {}; b.disconnect = () => {};
const { server, address } = await startServer({ port: 0, bridge: b });
const browser = await chromium.launch({ executablePath: "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", headless: true });
const reports = [], errors = [];
try {
  for (const [width, height] of [[1440, 960], [390, 844], [844, 390]]) {
    const page = await browser.newPage({ viewport: { width, height } });
    page.on("pageerror", e => errors.push(e.message));
    await page.addInitScript({ path: path.join(ROOT, "scripts/fixtures/interrupt.js") });
    await page.goto(address);
    await page.waitForSelector('[data-thread-id="77777777-7777-4777-8777-777777777777"]', { state: "attached" });
    await page.evaluate(() => document.querySelector('[data-thread-id="77777777-7777-4777-8777-777777777777"]').click());
    await page.waitForFunction(() => !document.getElementById("interrupt").hidden && !document.getElementById("interrupt").disabled);
    await page.screenshot({ path: path.join(dir, "running-" + width + ".png") });
    reports.push({ width, height, ...await page.evaluate(() => window.interruptFixture.run()) });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.screenshot({ path: path.join(dir, "interrupt-" + width + ".png") });
    await page.close();
  }
  assert.deepEqual(errors, []);
  const report = { passed: true, scope: "production UI with isolated API fixtures; no real task writes", reports, errors };
  fs.writeFileSync(path.join(dir, "report.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ ...report, directory: dir }));
} finally { await browser.close(); server.closeAllConnections(); await new Promise(r => server.close(r)); clearInterval(b.subscriptionTimer); }
