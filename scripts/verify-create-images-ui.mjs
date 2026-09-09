import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { Bridge, ROOT } from "../src/bridge.mjs";
import { startServer } from "../src/server.mjs";
const { chromium } = await import(process.env.REMOTE_BRIDGE_PLAYWRIGHT || "playwright-core");
const dir = fs.mkdtempSync(path.join(ROOT, "work/create-images-ui-")), b = new Bridge(dir);
fs.writeFileSync(path.join(dir, "update-settings.json"), '{"automatic":false}');
b.connect = async () => {}; b.disconnect = () => {};
const { server, address } = await startServer({ port: 0, bridge: b });
const browser = await chromium.launch({ executablePath: "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", headless: true });
const results = [], errors = [];
try {
  for (const [width,height] of [[1440,960],[390,844],[844,390]]) {
    const page = await browser.newPage({ viewport: { width,height } }); page.on("pageerror", e => errors.push(e.message));
    await page.addInitScript({ path: path.join(ROOT, "scripts/fixtures/create-images.js") });
    await page.goto(address); results.push({ width,height, ...await page.evaluate(() => window.createImageFixture.run()) });
    await page.screenshot({ path: path.join(dir, "create-" + width + ".png") }); await page.close();
  }
  assert.deepEqual(errors, []); fs.writeFileSync(path.join(dir,"report.json"), JSON.stringify({ results,errors },null,2)); console.log(JSON.stringify({ passed:true,results,directory:dir }));
} finally { await browser.close(); server.closeAllConnections(); await new Promise(r => server.close(r)); clearInterval(b.subscriptionTimer); }
