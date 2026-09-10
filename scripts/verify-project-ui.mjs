// Production UI with isolated endpoint fixtures. Never sends to official tasks.
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { startServer } from "../src/server.mjs";
import { ROOT } from "../src/bridge.mjs";
const { chromium } = await import(process.env.REMOTE_BRIDGE_PLAYWRIGHT || "playwright-core");
const dir = fs.mkdtempSync(path.join(ROOT, "work/project-ui-"));
fs.writeFileSync(path.join(dir, "update-settings.json"), '{"automatic":false}');
const { server, address } = await startServer({ port: 0, bridge: { dataDir: dir, on() {}, off() {}, connect: async () => {}, disconnect() {} } });
const browser = await chromium.launch({ executablePath: "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
const errors = [], events = [], sent = [];
const id = "44444444-4444-4444-8444-444444444444";
let available = true, capable = true, created = false, fail = false;
page.on("pageerror", e => errors.push(e.message));
await page.route(address + "/api/**", async route => {
  const req = route.request(), p = new URL(req.url()).pathname;
  const laptop = p.includes("/agents/laptop/");
  const json = (data, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(data) }).catch(() => {});
  if (p === "/api/agents") return json({ selectedId: "local", agents: [{ id: "local", kind: "local", host: "fixture", name: "测试电脑" }, { id: "laptop", kind: "remote", host: "100.64.0.2", port: 43128, name: "测试笔记本" }] });
  if (p.endsWith("/events")) { await new Promise(r => events.push(r)); return route.abort().catch(() => {}); }
  if (p.endsWith("/updates")) return json({ supported: false, automatic: false });
  if (p.endsWith("/status") || p.endsWith("/connect")) return json({ connected: true, existingCodexWritable: true, projectCreation: capable ? { local: true } : undefined });
  if (p.endsWith("/projects")) return json({ data: { projects: available ? [
    { projectId: laptop ? "laptop-project" : "local-project", projectKind: "local", hostId: "local", label: laptop ? "笔记本项目" : "N3", path: laptop ? "D:\\Projects\\Laptop" : "E:\\Project\\ninja3" },
    { projectId: "cloud", projectKind: "chatgpt", label: "Work project" },
    { projectId: "remote-host", projectKind: "remote", hostId: "other", label: "Other host" },
  ] : [] } });
  if (p.endsWith("/usage")) return json({ status: "unknown", weekly: [] });
  if (p.endsWith("/models")) return json({ models: [{ id: "fixture", efforts: ["low"] }] });
  if (p.endsWith("/threads") && req.method() === "POST") {
    sent.push(req.postDataJSON());
    if (fail) return json({ error: "所选项目暂不可用，未创建" }, 400);
    created = true; return json({ status: "accepted", result: { threadId: id } });
  }
  if (p.endsWith("/threads")) return json({ data: { threads: created ? [{ id, kind: "codex", title: "Project fixture", status: "idle", projectId: "local-project" }] : [] } });
  if (p.endsWith("/threads/" + id)) return json({ data: { thread: { id, kind: "codex", title: "Project fixture", status: { type: "idle" } }, turns: [{ id: "turn", status: "completed", items: [{ type: "agentMessage", text: "Project fixture reply" }] }] } });
  if (p.endsWith("/queue")) return json({ confirmed: true, messages: [], recoveries: [] });
  return json({});
});
const choose = async project => { await page.locator("#project-display").click(); await page.locator('#project-options [data-project="' + project + '"]').click(); };
const ready = () => page.waitForFunction(() => !document.querySelector("#project-display").disabled);
const selectDevice = async label => { await page.locator("#footer-agent").click(); await page.locator("#agents button").filter({ hasText: label }).click(); await ready(); };
try {
  await page.goto(address); await ready();
  assert.equal(await page.locator("#project-name").textContent(), "无项目");
  await page.locator("#project-display").click();
  await page.locator("#project-search").fill("n3");
  assert.equal(await page.locator("#project-options button").count(), 2);
  assert.equal(await page.locator("#project-menu:popover-open").count(), 1);
  assert.equal(await page.locator('#project-options [data-project="cloud"]').count(), 0);
  await page.locator('#project-options [data-project="local-project"]').click();
  assert.equal(await page.locator("#project-name").textContent(), "N3");
  assert.equal(await page.locator("#project-location").innerText(), "本地");
  await page.locator("#prompt").fill("project draft");
  await page.locator("#project-display").click(); await page.locator("#project-display").click();
  assert.equal(await page.locator("#project-menu:popover-open").count(), 0);
  await page.evaluate(() => window.remoteCodexSaveDrafts()); await page.reload(); await ready();
  assert.equal(await page.locator("#project-name").textContent(), "N3");
  assert.equal(await page.locator("#prompt").inputValue(), "project draft");
  await selectDevice("测试笔记本");
  assert.equal(await page.locator("#project-name").textContent(), "无项目");
  await choose("laptop-project");
  await selectDevice("测试电脑");
  await page.waitForFunction(() => document.querySelector('#project-name').textContent === 'N3');
  assert.equal(await page.locator("#project-name").textContent(), "N3");
  available = false; await page.locator("#refresh").click();
  await page.waitForFunction(() => document.querySelector("#project-name").textContent === "所选项目不可用");
  assert.equal(await page.locator("#send").isDisabled(), true);
  assert.equal(await page.locator("#prompt").inputValue(), "project draft");
  available = true; capable = false; await page.locator("#refresh").click();
  await page.waitForFunction(() => document.querySelector("#writable").textContent.includes("先更新"));
  assert.equal(await page.locator("#send").isDisabled(), true);
  await choose(""); assert.equal(await page.locator("#send").isDisabled(), false);
  capable = true; await page.locator("#refresh").click();
  await page.waitForFunction(() => !document.querySelector("#project-display").title.includes("更新"));
  await choose("local-project");
  fail = true; await page.locator("#send").click();
  await page.waitForFunction(() => document.querySelector("#error").textContent.includes("未创建"));
  assert.equal(await page.locator("#prompt").inputValue(), "project draft");
  assert.equal(await page.locator("#project-name").textContent(), "N3");
  fail = false; await page.locator("#send").click();
  await page.waitForFunction(() => document.querySelector("#messages").textContent.includes("Project fixture reply"));
  assert.deepEqual(sent.at(-1).project, { projectId: "local-project", environment: "local" });
  assert.equal(sent.at(-1).mode, "codex");
  assert.equal(await page.locator("#creation-context").isVisible(), false);
  await page.locator("#create").click();
  assert.equal(await page.locator("#project-name").textContent(), "N3");
  await page.locator("#project-display").click();
  await page.screenshot({ path: path.join(dir, "desktop.png") });
  for (const viewport of [{ width: 390, height: 844 }, { width: 844, height: 390 }]) {
    await page.keyboard.press("Escape"); await page.setViewportSize(viewport);
    await page.locator("#project-display").click();
    const box = await page.locator("#project-menu").boundingBox();
    assert.ok(box.x >= 0 && box.y >= 0 && box.x + box.width <= viewport.width && box.y + box.height <= viewport.height + 1);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.screenshot({ path: path.join(dir, viewport.width < viewport.height ? "portrait.png" : "landscape.png") });
  }
  await page.keyboard.press("Escape"); await page.setViewportSize({ width: 1440, height: 960 });
  await page.locator("#mode-picker").click(); await page.locator('[data-mode="chat"]').click();
  await page.waitForFunction(() => document.body.dataset.mode === "chat");
  assert.equal(await page.locator("#creation-context").isVisible(), false);
  assert.deepEqual(errors, []);
  fs.writeFileSync(path.join(dir, "result.json"), JSON.stringify({ passed: true, sent: sent.length, checks: ["search and popover clicks", "device isolation", "reload recovery", "missing project", "old agent gate", "failed submit draft", "project ID payload", "task project inheritance", "portrait and landscape", "Chat isolation"], errors }, null, 2));
  console.log("PASS project UI", dir);
} catch (error) {
  console.log(JSON.stringify({ errors, ui: await page.locator("#error").textContent(), connection: await page.locator("#connection").textContent() }));
  await page.screenshot({ path: path.join(dir, "failure.png") });
  throw error;
} finally { for (const release of events) release(); await browser.close(); server.closeAllConnections(); await new Promise(r => server.close(r)); }
