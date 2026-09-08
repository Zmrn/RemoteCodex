// Inspect the actual portable service UI; block task writes and official navigation.
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { chromium } = await import(process.env.REMOTE_BRIDGE_PLAYWRIGHT || "playwright-core");
const { address } = JSON.parse(fs.readFileSync(path.join(root, "evidence/portable-verification.json"), "utf8"));
assert.equal(new URL(address).hostname, "127.0.0.1");
const browser = await chromium.launch({ executablePath: "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
const errors = [];
page.on("pageerror", error => errors.push(error.message));
await page.route("**/api/**", route => {
  const request = route.request(), endpoint = new URL(request.url()).pathname;
  const allowed = ["/api/agents/select", "/api/agents/local/bridge/connect"].includes(endpoint) || /^\/api\/agents\/local\/bridge\/threads\/[a-f0-9-]+\/follow$/.test(endpoint);
  if (request.method() !== "GET" && !allowed) return route.abort();
  return route.continue();
});
try {
  await page.goto(address + "/?ui=0.7.0");
  await page.locator("#prompt").waitFor({ state: "visible" });
  await page.waitForFunction(() => !document.querySelector("#prompt").disabled);
  assert.match(await page.locator("#setup-dialog").textContent(), /RemoteCodex-0\.7\.0-windows-x64\.exe --agent-address/);
  await page.screenshot({ path: path.join(root, "evidence/portable-ui.png") });
  const result = { title: await page.title(), composerEditable: await page.locator("#prompt").isEditable(), portableConnectionHelp: true, pageErrors: errors };
  assert.deepEqual(errors, []);
  fs.writeFileSync(path.join(root, "evidence/portable-ui.json"), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
} finally { await browser.close(); }
