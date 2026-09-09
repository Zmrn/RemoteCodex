// Installed UI and official task reads only. No private message bodies saved.
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { ROOT } from "../src/bridge.mjs";
const { chromium } = await import(process.env.REMOTE_BRIDGE_PLAYWRIGHT || "playwright-core");
const [id] = process.argv.slice(2);
assert.match(id ?? "", /^[a-f0-9-]{36}$/);
const runtime = JSON.parse(fs.readFileSync(path.join(process.env.LOCALAPPDATA, "RemoteCodex/data/server.json")));
const address = runtime.address;
assert.match(address, /^http:\/\/127\.0\.0\.1:\d+$/);
const html = await (await fetch(address)).text();
const csrf = html.match(/name="bridge-csrf"\s+content="([^"]+)"/)[1];
const instance = await (await fetch(address + "/api/instance", { headers: { "X-Bridge-CSRF": csrf } })).json();
assert.equal(instance.instanceId, runtime.instanceId);
assert.equal(instance.version, JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"))).version);
const browser = await chromium.launch({ executablePath: "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", headless: true });
const page = await browser.newPage({ viewport: { width: 1300, height: 900 } });
const errors = [], blocked = [];
page.on("pageerror", e => errors.push(e.message));
try {
  await page.route(address + "/api/**", async route => {
    const request = route.request(), p = new URL(request.url()).pathname;
    if (p === "/api/agents/select") return route.fulfill({ contentType: "application/json", body: "{}" });
    if (request.method() !== "GET" && !/\/(follow|connect|activity)$/.test(p)) {
      blocked.push(p); return route.abort();
    }
    if (p === "/api/agents") {
      const response = await route.fetch(), data = await response.json();
      assert.ok(data.agents.some(a => a.id === "local"));
      return route.fulfill({ response, json: { ...data, selectedId: "local" } });
    }
    return route.continue();
  });
  await page.goto(address + "/?thread=" + id);
  await page.waitForFunction(() => document.querySelectorAll("#messages [data-item-id]").length > 0);
  assert.match(await page.locator("#history-notice").textContent(), /已先显示可读内容/);
  const digest = async () => createHash("sha256").update(await page.locator("#messages").textContent()).digest("hex");
  const hash = await digest(), count = await page.locator("#messages [data-item-id]").count();
  await page.locator("#older").click();
  await page.waitForFunction(() => document.querySelector("#older").textContent.includes("重试"));
  assert.match(await page.locator("#history-notice").textContent(), /已保留当前内容/);
  assert.equal(await digest(), hash);
  await page.evaluate(() => document.querySelector("#refresh").click());
  await page.waitForFunction(() => !document.querySelector("#older").disabled);
  assert.equal(await digest(), hash);
  assert.equal(await page.locator("#older").isVisible(), true);
  assert.deepEqual(errors, []); assert.deepEqual(blocked, []);
  const result = { result: "PASS", version: instance.version, observedAt: new Date().toISOString(), readableItems: count,
    reducedNoticeVisible: true, olderFailurePreservedMessages: true, refreshPreservedMessages: true,
    retryVisible: true, persistedSelectionWrites: 0, taskMutations: 0, pageErrors: errors };
  fs.mkdirSync(path.join(ROOT, "evidence"), { recursive: true });
  fs.writeFileSync(path.join(ROOT, "evidence/history-read-installed.json"), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
} finally { await browser.close(); }
