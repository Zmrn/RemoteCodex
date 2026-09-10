// Production shared UI; all API traffic and images are isolated fixtures.
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { startServer } from "../src/server.mjs";
import { ROOT } from "../src/bridge.mjs";
const { chromium } = await import(process.env.REMOTE_BRIDGE_PLAYWRIGHT || "playwright-core");
fs.mkdirSync(path.join(ROOT, "work"), { recursive: true });
const dir = fs.mkdtempSync(path.join(ROOT, "work/image-steer-ui-"));
fs.writeFileSync(path.join(dir, "update-settings.json"), '{"automatic":false}');
const { server, address } = await startServer({ port: 0, bridge: { dataDir: dir, on() {}, off() {}, connect: async () => {}, disconnect() {} } });
const browser = await chromium.launch({ executablePath: "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const id = "77777777-7777-4777-8777-777777777777", chatId = "77777777-7777-4777-8777-777777777778";
const bytes = fs.readFileSync(path.join(ROOT, "fixtures/multi-image-a.png"));
const writes = [], images = [], errors = [], events = [], checks = [];
let active = true, supported = true, turn = "current-turn", showImages = true, outcome = "accepted", pendingSend;
page.on("pageerror", error => errors.push(error.message));
const status = () => ({ connected: true, existingCodexWritable: true, multiImageInput: true,
  steer: { supported }, interrupt: { supported: true }, chat: { read: true, sendText: true } });
await page.route(address + "/api/**", async route => {
  const request = route.request(), url = new URL(request.url()), p = url.pathname, remote = p.includes("/agents/remote/");
  const json = (data, code = 200) => route.fulfill({ status: code, contentType: "application/json", body: JSON.stringify(data) }).catch(() => {});
  if (p === "/api/agents") return json({ selectedId: "local", agents: [
    { id: "local", kind: "local", name: "测试电脑", host: "fixture" },
    { id: "remote", kind: "remote", name: "另一设备", host: "100.64.0.2", port: 43128 },
  ] });
  if (p.endsWith("/events")) { await new Promise(resolve => events.push(resolve)); return route.abort().catch(() => {}); }
  if (p.endsWith("/status") || p.endsWith("/connect")) return json(status());
  if (p.endsWith("/updates")) return json({ supported: false });
  if (p.endsWith("/projects")) return json({ data: { projects: [] } });
  if (p.endsWith("/models")) return json({ models: [{ id: "fixture", efforts: ["low"] }] });
  if (p.endsWith("/usage")) return json({ status: "unknown", weekly: [] });
  if (p.endsWith("/media")) {
    const entry = { remote, id: url.searchParams.get("id"), done: false };
    images.push(entry);
    const value = await new Promise(resolve => { entry.finish = value => { entry.done = true; resolve(value); }; });
    return route.fulfill({ status: value === "http-error" ? 503 : 200, contentType: "image/png",
      body: value === "valid" ? bytes : Buffer.from("invalid image") }).catch(() => {});
  }
  if (request.method() === "POST" && (p.endsWith("/messages") || p.endsWith("/queue"))) {
    const body = request.postDataJSON(); writes.push({ p, body });
    if (outcome === "pending") await new Promise(resolve => { pendingSend = resolve; });
    if (outcome === "rejected") return json({ error: "运行轮次已变化，未发送" }, 400);
    return json({ status: outcome === "unknown" ? "outcome-unknown" : "accepted", result: { threadId: id } });
  }
  if (p.endsWith("/queue")) return json({ confirmed: true, revision: "fixture-revision", messages: [], recoveries: [] });
  if (p.endsWith("/threads")) return json({ data: { threads: [
    { id, kind: "codex", title: "测试任务", status: active ? "active" : "idle" },
    { id: chatId, kind: "chatgpt", title: "Chat 测试任务", status: "idle" },
  ] } });
  if (p.endsWith("/threads/" + id) || p.endsWith("/threads/" + chatId)) {
    const chat = p.endsWith(chatId);
    return json({ data: { thread: { id: chat ? chatId : id, kind: chat ? "chatgpt" : "codex", title: "测试任务", status: { type: !chat && active ? "active" : "idle" } },
      turns: [{ id: turn, status: !chat && active ? "inProgress" : "completed", items: [{ id: "reply", type: "agentMessage", text: (remote ? "远端" : "本机") + "测试正文",
        bridgeDisplay: { text: (remote ? "远端" : "本机") + "测试正文", images: !chat && showImages ? [{ id: "fixture-image", name: "loading-fixture.png" }] : [] } }] }] },
      live: { activeTurnId: active ? turn : null, status: { type: active ? "running" : "idle", confirmed: true }, state: {} } });
  }
  return json({});
});
const until = async condition => { for (let n = 0; n < 150; n++) { if (await condition()) return; await new Promise(resolve => setTimeout(resolve, 20)); } throw Error("Fixture condition timed out"); };
const ready = () => page.waitForFunction(() => !document.querySelector("#prompt").disabled);
const imageState = state => page.locator('.message-image .image-load-state[data-state="' + state + '"]');
const refresh = async () => { await page.locator("#refresh").click(); await ready(); };
const switchDevice = async text => { await page.locator("#footer-agent").click(); await page.locator("#agents button").filter({ hasText: text }).click(); await ready(); await page.locator('.thread-card[data-thread-id="' + id + '"]').click(); await ready(); };
try {
  await page.goto(address);
  await page.locator('.thread-card[data-thread-id="' + id + '"]').click(); await ready();
  await until(() => images.length === 1);
  assert.equal(await imageState("loading").isVisible(), true);
  assert.equal(await page.locator(".message-image img").evaluate(i => getComputedStyle(i).opacity), "0");
  assert.equal(await imageState("error").count(), 0);
  await page.screenshot({ path: path.join(dir, "image-loading.png") });
  images[0].finish("http-error"); await imageState("error").waitFor();
  await imageState("error").getByRole("button", { name: "重试" }).click();
  await until(() => images.length === 2); assert.equal(await imageState("loading").isVisible(), true);
  images[1].finish("corrupt"); await imageState("error").waitFor();
  await imageState("error").getByRole("button", { name: "重试" }).click();
  await until(() => images.length === 3); images[2].finish("valid");
  await page.waitForFunction(() => document.querySelector(".message-image img")?.naturalWidth > 0 && !document.querySelector(".message-image img").classList.contains("image-pending"));
  assert.equal(await imageState("loading").count(), 0);
  assert.equal(await page.locator(".message-image .image-download").isVisible(), true);
  await refresh(); await ready(); assert.equal(images.length, 3, "reuse successful download");
  await page.locator(".message-image img").click();
  await page.locator("#image-viewer img").evaluate(i => i.decode());
  await page.keyboard.press("Escape"); checks.push("loading, HTTP error, corrupt decode, explicit retries, cached refresh and zoom");
  await switchDevice("另一设备");
  await until(() => images.length === 4); assert.equal(images[3].remote, true);
  await switchDevice("测试电脑"); images[3].finish("http-error");
  await page.waitForFunction(() => document.querySelector("#messages").textContent.includes("本机测试正文"));
  assert.equal(await imageState("error").count(), 0); checks.push("same media ID isolated across devices; late failure cannot replace current preview");
  for (const viewport of [{ width: 320, height: 568 }, { width: 390, height: 844 }, { width: 844, height: 390 }]) {
    await page.setViewportSize(viewport);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  }
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.locator("#prompt").fill("queued text"); await page.locator("#prompt").press("Enter");
  await until(() => writes.length === 1); assert.equal(writes[0].body.action, "enqueue");
  await page.waitForFunction(() => document.querySelector("#prompt").value === "");
  await page.locator("#prompt").fill("direct direction");
  await page.locator("#prompt").press("Control+Enter");
  await until(() => writes.length === 2);
  assert.equal(writes[1].body.delivery, "steer"); assert.equal(writes[1].body.expectedTurnId, turn);
  assert.ok(writes[1].p.endsWith("/messages")); await page.waitForFunction(() => document.querySelector("#prompt").value === "");
  checks.push("Enter queues, Ctrl+Enter sends direct steering");
  await page.locator("#prompt").fill("keep this draft");
  await page.locator("#prompt").press("Shift+Enter");
  await page.locator("#prompt").evaluate(input => {
    for (const extra of [{ isComposing: true }, { keyCode: 229 }, { repeat: true }]) input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", ctrlKey: true, bubbles: true, ...extra }));
  });
  assert.equal(writes.length, 2); assert.ok((await page.locator("#prompt").inputValue()).includes("\n"));
  outcome = "unknown";
  await page.locator("#image").setInputFiles([path.join(ROOT, "fixtures/multi-image-a.png"), path.join(ROOT, "fixtures/multi-image-b.png")]);
  await page.locator("#prompt").press("Control+Enter"); await until(() => writes.length === 3);
  await page.waitForFunction(() => document.querySelector("#error").textContent.includes("未知"));
  assert.equal(writes[2].body.imageDataUrls.length, 2);
  assert.equal(await page.locator("#attachment img").count(), 2);
  await page.reload(); await ready();
  await page.locator("#prompt").press("Control+Enter"); await until(() => writes.length === 4);
  assert.equal(writes[3].body.requestId, writes[2].body.requestId, "reload retains the request identity after unknown response");
  await ready(); outcome = "rejected";
  await page.locator("#prompt").press("Control+Enter"); await until(() => writes.length === 5);
  await page.waitForFunction(() => document.querySelector("#error").textContent.includes("轮次已变化"));
  assert.equal(await page.locator("#attachment img").count(), 2);
  checks.push("IME/Shift+Enter/key repeat; unknown/rejected submissions preserve text, both images and retry identity");
  supported = false; await refresh();
  await page.locator("#prompt").press("Control+Enter");
  await page.waitForFunction(() => document.querySelector("#error").textContent.includes("先更新目标设备"));
  assert.equal(writes.length, 5, "old bridge must not receive an unintended enqueue");
  supported = true; active = false; showImages = false; outcome = "accepted"; await refresh();
  await page.locator("#prompt").fill("idle send"); await page.locator("#prompt").press("Control+Enter");
  await until(() => writes.length === 6); assert.equal(writes[5].body.delivery, undefined);
  await page.waitForFunction(() => document.querySelector("#prompt").value === "");
  checks.push("old target blocked; idle Ctrl+Enter remains a normal send");
  await page.locator("#mode-picker").click(); await page.locator('[data-mode="chat"]').click();
  await page.locator('.thread-card[data-thread-id="' + chatId + '"]').click(); await ready();
  await page.locator("#prompt").fill("Chat normal"); await page.locator("#prompt").press("Control+Enter");
  await until(() => writes.length === 7); assert.equal(writes[6].body.mode, "chat"); assert.equal(writes[6].body.delivery, undefined);
  checks.push("Chat uses its own normal message path");
  active = true;
  await page.locator("#mode-picker").click(); await page.locator('[data-mode="codex"]').click();
  await page.locator('.thread-card[data-thread-id="' + id + '"]').click(); await ready();
  await page.locator("#prompt").fill("protected before send");
  await page.evaluate(() => {
    window.originalTransaction = IDBDatabase.prototype.transaction;
    IDBDatabase.prototype.transaction = function (stores, mode, ...args) {
      if (mode === "readwrite") throw Error("fixture draft storage unavailable");
      return window.originalTransaction.call(this, stores, mode, ...args);
    };
  });
  await page.locator("#prompt").press("Control+Enter");
  await page.waitForFunction(() => document.querySelector("#error").textContent.includes("storage unavailable"));
  assert.equal(writes.length, 7); assert.equal(await page.locator("#prompt").inputValue(), "protected before send");
  await page.evaluate(() => { IDBDatabase.prototype.transaction = window.originalTransaction; });
  outcome = "pending";
  await page.locator("#prompt").press("Control+Enter"); await until(() => pendingSend);
  assert.equal(writes.length, 8); assert.ok(writes[7].p.includes("/agents/local/"));
  await switchDevice("另一设备"); await page.locator("#prompt").fill("other device draft");
  outcome = "accepted"; pendingSend(); pendingSend = null;
  await until(async () => (await page.locator("#toast").textContent()).includes("原设备") || (await page.locator("#toast").textContent()).includes("测试电脑"));
  assert.equal(await page.locator("#prompt").inputValue(), "other device draft");
  await switchDevice("测试电脑");
  assert.equal(await page.locator("#prompt").inputValue(), "");
  checks.push("draft storage failure blocks dispatch; device switch preserves the other device's draft after a delayed acknowledgement");
  assert.deepEqual(errors, []);
  fs.writeFileSync(path.join(dir, "result.json"), JSON.stringify({ passed: true, checks, writes: writes.length, imageRequests: images.length, errors }, null, 2));
  console.log(JSON.stringify({ passed: true, checks, dir }));
} catch (error) {
  console.log(JSON.stringify({ errors, writes: writes.map(x => ({ route: x.p, delivery: x.body.delivery, action: x.body.action })), images: images.map(({ remote, done }) => ({ remote, done })), ui: await page.locator("#error").textContent() }));
  await page.screenshot({ path: path.join(dir, "failure.png") }); throw error;
} finally {
  for (const entry of images) if (!entry.done) entry.finish("http-error");
  pendingSend?.(); for (const done of events) done();
  await browser.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
}
