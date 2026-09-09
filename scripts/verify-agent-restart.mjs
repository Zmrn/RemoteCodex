// Real shared UI, HTTP and Windows DPAPI across terminated server processes.
// Only synthetic devices in a private directory; never attach an official owner.
import fs from "node:fs";
import path from "node:path";
import { fork } from "node:child_process";
import { once } from "node:events";
import { pathToFileURL, fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
if (process.argv[2] === "--worker") {
  const [source, dir, port] = process.argv.slice(3);
  const { startServer } = await import(pathToFileURL(path.join(source, "src/server.mjs")));
  const app = await startServer({ port: Number(port), bridge: {
    dataDir: dir, on() {}, off() {}, async connect() {}, disconnect() {},
  } });
  process.send({ address: app.address });
} else {
  fs.mkdirSync(path.join(root, "work"), { recursive: true });
  const dir = fs.mkdtempSync(path.join(root, "work/agent-restart-"));
  fs.writeFileSync(path.join(dir, "update-settings.json"), '{"automatic":false}');
  const installed = path.join(process.env.LOCALAPPDATA, "RemoteCodex/data");
  const digest = file => fs.existsSync(file) ? createHash("sha256").update(fs.readFileSync(file)).digest("hex") : null;
  const productionFiles = ["agents.json", "agents.json.bak", "remote-access.json"].map(n => path.join(installed, n));
  const productionBefore = productionFiles.map(digest);
  const { chromium } = await import(process.env.REMOTE_BRIDGE_PLAYWRIGHT || "playwright-core");
  const browser = await chromium.launch({ executablePath: "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", headless: true });
  const page = await browser.newPage({ viewport: { width: 1200, height: 820 } });
  const errors = [], checks = [];
  page.on("pageerror", e => errors.push(e.message));
  let worker, address, port = 0;
  const currentSource = process.env.REMOTE_BRIDGE_CURRENT_ROOT || root;
  async function start(source) {
    worker = fork(fileURLToPath(import.meta.url), ["--worker", source, dir, String(port)], {
      windowsHide: true, stdio: ["ignore", "ignore", "pipe", "ipc"],
      env: { ...process.env, REMOTE_BRIDGE_DATA_DIR: dir, REMOTE_BRIDGE_PORTABLE: "0" },
    });
    worker.stderr.resume();
    const result = await Promise.race([
      once(worker, "message").then(([value]) => value),
      once(worker, "exit").then(() => { throw Error("Isolated server exited before startup"); }),
      new Promise((_, reject) => { const t = setTimeout(() => reject(Error("Isolated startup timed out")), 20000); t.unref(); }),
    ]);
    address = result.address;
    port = new URL(address).port;
  }
  async function stop() {
    if (!worker || worker.exitCode !== null) return;
    const exited = once(worker, "exit");
    worker.kill();
    await exited;
    worker = null;
  }
  const registry = () => JSON.parse(fs.readFileSync(path.join(dir, "agents.json")));
  try {
    await start(process.env.REMOTE_BRIDGE_PREVIOUS_ROOT || root);
    await page.route(address + "/api/**", async route => {
      const p = new URL(route.request().url()).pathname;
      if (["/api/agents", "/api/agents/select", "/api/agents/remove"].includes(p)) return route.continue();
      let result = {};
      if (/\/(status|connect)$/.test(p)) result = { connected: true, threads: {} };
      else if (p.endsWith("/threads")) result = { data: { threads: [] } };
      else if (p.endsWith("/projects")) result = { data: { projects: [] } };
      else if (p.endsWith("/usage")) result = { status: "unavailable", weekly: [] };
      else if (p.endsWith("/updates")) result = { supported: false };
      else if (p.endsWith("/events")) return route.fulfill({ contentType: "text/event-stream", body: ": fixture\n\n" });
      return route.fulfill({ contentType: "application/json", body: JSON.stringify(result) });
    });
    await page.goto(address);
    await page.locator("#footer-agent").click();
    await page.locator("#add-agent").click();
    await page.locator("#agent-name").fill("公司测试电脑");
    await page.locator("#agent-host").fill("100.70.8.20");
    await page.locator("#agent-key").fill("synthetic-restart-test-key-only-1234");
    await page.locator("#save-agent").click();
    await page.waitForFunction(() => !document.querySelector("#agent-dialog").open);
    const original = registry().items;
    assert.equal(original.length, 2);
    const id = original.find(a => a.kind === "remote").id;
    await page.locator("#footer-agent").click();
    await page.locator(`[data-agent-id="${id}"]`).click();
    await page.waitForFunction(() => document.querySelector("#agent-title").textContent === "公司测试电脑");
    await page.waitForFunction(() => document.querySelector("#connection").textContent === "已连接官方桌面");
    checks.push("UI saves a real DPAPI-encrypted synthetic remote device and selects it");
    for (let i = 0; i < 2; i++) {
      await stop();
      await start(currentSource);
      await page.reload();
      await page.waitForFunction(() => document.querySelector("#agent-title").textContent === "公司测试电脑");
      await page.waitForFunction(() => document.querySelector("#connection").textContent === "已连接官方桌面");
      assert.deepEqual(registry().items, original);
      assert.equal(registry().selectedId, id);
    }
    checks.push("upgrade to current source and a second hard restart retain stable IDs, names, endpoints, encrypted keys and selection");
    // Verify the UI's explicit removal remains authoritative after another restart.
    await page.locator("#footer-agent").click();
    await page.locator("#edit-agent").click();
    await page.locator("#remove-agent").click();
    await page.waitForFunction(() => !document.querySelector("#agent-dialog").open);
    await stop();
    await start(currentSource);
    await page.reload();
    await page.waitForFunction(() => document.querySelectorAll("#agents button").length === 1);
    assert.equal(registry().items.length, 1);
    checks.push("explicit UI removal stays deleted across restart");
    assert.deepEqual(errors, []);
    assert.deepEqual(productionFiles.map(digest), productionBefore);
    checks.push("installed device registries and local access configuration remain byte-for-byte unchanged");
    const report = { result: "passed", source: "isolated Windows Node processes, real UI/HTTP/DPAPI, no official owner", previousSource: process.env.REMOTE_BRIDGE_PREVIOUS_ROOT ? "installed previous runtime" : "current source", currentSource: process.env.REMOTE_BRIDGE_CURRENT_ROOT ? "packaged runtime" : "current source", checks, errors };
    fs.mkdirSync(path.join(root, "evidence"), { recursive: true });
    fs.writeFileSync(path.join(root, "evidence/agent-restart.json"), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report));
  } finally { await browser.close(); await stop(); }
}
