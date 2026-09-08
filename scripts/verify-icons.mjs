import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
const { chromium } = await import(
  process.env.REMOTE_BRIDGE_PLAYWRIGHT || "playwright-core"
);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const report = {
  scope: "local assets and own headless browser; no model writes",
  checks: {},
  errors: [],
};
const base = "http://127.0.0.1:43127";
const browser = await chromium.launch({
  executablePath:
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  headless: true,
});
try {
  for (const [file, type] of [
    ["app-icon.svg", "image/svg+xml"],
    ["app-icon.ico", "image/x-icon"],
    ["app-icon-192.png", "image/png"],
    ["app-icon-512.png", "image/png"],
    ["app.webmanifest", "application/manifest+json"],
  ]) {
    const r = await fetch(`${base}/${file}?v=0.6.3`);
    assert.equal(r.status, 200);
    assert.ok(r.headers.get("content-type").startsWith(type));
    assert.deepEqual(
      Buffer.from(await r.arrayBuffer()),
      fs.readFileSync(path.join(root, "public", file)),
    );
  }
  report.checks.assetsServedWithCorrectTypes = true;
  assert.equal((await fetch(base + "/data/server.json")).status, 403);
  report.checks.privateDataRemainsInaccessible = true;
  const ico = fs.readFileSync(path.join(root, "public/app-icon.ico"));
  assert.equal(ico.readUInt16LE(2), 1);
  const sizes = [];
  for (let i = 0; i < ico.readUInt16LE(4); i++) {
    const at = 6 + 16 * i,
      size = ico[at] || 256,
      length = ico.readUInt32LE(at + 8),
      offset = ico.readUInt32LE(at + 12);
    assert.ok(offset + length <= ico.length);
    assert.equal(ico.subarray(offset + 1, offset + 4).toString(), "PNG");
    assert.equal(ico.readUInt32BE(offset + 16), size);
    sizes.push(size);
  }
  assert.deepEqual(sizes, [16, 24, 32, 48, 64, 128, 192, 256]);
  report.icoSizes = sizes;
  report.checks.multiSizeWindowsIcon = true;
  const page = await browser.newPage({
    viewport: { width: 1440, height: 960 },
  });
  page.on("pageerror", (e) => report.errors.push(e.message));
  await page.goto(base + "/?ui=0.6.3");
  await page.waitForFunction(() => {
    const icon = document.querySelector(".window-label img");
    return icon?.complete && icon.naturalWidth > 0;
  });
  assert.equal(await page.locator('link[rel="icon"]').count(), 2);
  const client = await page.context().newCDPSession(page);
  const manifest = await client.send("Page.getAppManifest");
  assert.equal(manifest.errors.length, 0);
  assert.equal(JSON.parse(manifest.data).icons.length, 2);
  await page
    .locator(".window-label")
    .screenshot({ path: path.join(root, "evidence/ui-v6.3-header-icon.png") });
  report.checks.webHeaderFaviconAndManifest = true;
  assert.deepEqual(report.errors, []);
  report.status = "passed";
} catch (e) {
  report.status = "failed";
  report.failure = e.message;
  throw e;
} finally {
  report.observedAt = new Date().toISOString();
  fs.writeFileSync(
    path.join(root, "evidence/ui-v6.3-icons.json"),
    JSON.stringify(report, null, 2),
  );
  await browser.close();
  console.log(JSON.stringify(report, null, 2));
}
