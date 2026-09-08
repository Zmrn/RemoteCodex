// Real Windows EXE upgrade against the signed tx release. Isolated data, no task writes.
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const [oldFile, newFile] = process.argv.slice(2).map((p) => path.resolve(p));
assert.ok(
  oldFile && newFile,
  "Usage: node scripts/verify-updates.mjs OLD_EXE NEW_EXE",
);
const { chromium } = await import(
  process.env.REMOTE_BRIDGE_PLAYWRIGHT || "playwright-core"
);
const evidence = path.join(root, "evidence");
fs.mkdirSync(evidence, { recursive: true });
const sandbox = fs.mkdtempSync(path.join(root, "work/update-verification-"));
const report = {
  scope:
    "Real portable EXE and tx resource service; isolated local data; no official mutations or Tailscale control listener",
  checks: {},
  sandbox,
};
const checks = report.checks,
  services = [];
const hash = (b) => createHash("sha256").update(b).digest("hex");
const api = async (address, route, body) => {
  const html = await (
    await fetch(address + "/", { signal: AbortSignal.timeout(5000) })
  ).text();
  const csrf = /name="bridge-csrf" content="([a-f0-9]+)"/.exec(html)?.[1];
  assert.ok(csrf, "CSRF must be present");
  const r = await fetch(address + "/api" + route, {
    method: body === undefined ? "GET" : "POST",
    headers: { "X-Bridge-CSRF": csrf, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(30000),
  });
  if (!r.ok) throw Error("API " + route + " failed: " + r.status);
  return r.json();
};
async function until(fn, description, timeout = 22 * 60000) {
  const start = Date.now();
  let latest;
  while (Date.now() - start < timeout) {
    try {
      latest = await fn();
      if (latest) return latest;
    } catch (e) {
      if (e.fatal) throw e;
    }
    await sleep(750);
  }
  throw Error("Timeout: " + description);
}
const run = async (s, args = []) =>
  new Promise((resolve, reject) => {
    const child = spawn(s.exe, ["--headless", "--home", s.home, ...args], {
      windowsHide: true,
      stdio: "ignore",
      timeout: 100000,
      env: { ...process.env, PATH: path.join(process.env.WINDIR, "System32") },
    });
    child.once("error", reject);
    child.once("exit", (code) =>
      code === 0 ? resolve() : reject(Error("Test launcher exit: " + code)),
    );
  });
async function start(name) {
  const dir = path.join(sandbox, name),
    home = path.join(dir, "独立 数据目录"),
    exe = path.join(dir, "Remote Codex.exe");
  fs.mkdirSync(path.join(home, "data"), { recursive: true });
  fs.copyFileSync(oldFile, exe);
  fs.writeFileSync(
    path.join(home, "data/update-settings.json"),
    JSON.stringify({ automatic: false }),
  );
  const s = { exe, home };
  services.push(s);
  await run(s);
  const record = JSON.parse(
    fs.readFileSync(path.join(home, "data/server.json")),
  );
  s.address = record.address;
  assert.equal(record.remoteAddress, null);
  assert.equal((await api(s.address, "/instance")).version, "0.8.0");
  console.log(name + ": isolated EXE started");
  return s;
}
async function updated(s) {
  await until(async () => {
    const file = path.join(s.home, "data/updates/result.json");
    if (!fs.existsSync(file)) return false;
    const r = JSON.parse(fs.readFileSync(file));
    if (r.status !== "updated")
      throw Object.assign(Error(JSON.stringify(r)), { fatal: true });
    return (await api(s.address, "/instance")).version === "0.8.1";
  }, "EXE replaced and new bridge ready");
  const result = JSON.parse(
    fs.readFileSync(path.join(s.home, "data/updates/result.json")),
  );
  assert.equal(result.status, "updated");
  assert.equal(hash(fs.readFileSync(s.exe)), hash(fs.readFileSync(newFile)));
  assert.equal(
    JSON.parse(fs.readFileSync(path.join(s.home, "data/server.json")))
      .remoteAddress,
    null,
  );
  return result;
}
let browser;
try {
  const original = await api("http://127.0.0.1:43127", "/status");
  report.officialPid = original.officialPid;
  const s = await start("手动更新"),
    initial = await api(s.address, "/instance");
  const status = await api(s.address, "/status");
  assert.equal(status.connected, true);
  const taskList = (await api(s.address, "/threads")).data.threads;
  checks.officialRead = { connected: true, count: taskList.length };
  browser = await chromium.launch({
    executablePath:
      "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
    headless: true,
  });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1060 },
    permissions: ["clipboard-read", "clipboard-write"],
  });
  const page = await context.newPage(),
    errors = [],
    blocked = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route("**/api/**", (route) => {
    const r = route.request(),
      p = new URL(r.url()).pathname;
    if (
      r.method() !== "GET" &&
      /\/threads(?:$|\/.*\/(?:messages|interrupt|queue|settings|open)$)/.test(p)
    ) {
      blocked.push(p);
      return route.abort();
    }
    return route.continue();
  });
  const edit = async () => {
    await page.locator("#footer-agent").click();
    await page.locator("#edit-agent").click();
    await page.waitForFunction(
      () => document.querySelector("#local-host").options.length > 0,
    );
  };
  await page.goto(s.address);
  await page.waitForFunction(() => !document.querySelector("#prompt").disabled);
  await edit();
  const access = await api(s.address, "/local-access");
  assert.ok(access.addresses.length > 0);
  assert.equal(await page.locator("#local-host").inputValue(), access.host);
  assert.equal(await page.locator("#local-enabled").isChecked(), false);
  const fixtureKey = "RemoteCodex-Test-" + randomUUID();
  await page.locator("#agent-name").fill("Update Probe Device");
  await page.locator("#local-port").fill("43129");
  await page.locator("#generate-local-key").click();
  assert.match(await page.locator("#local-key").inputValue(), /^[a-f0-9]{64}$/);
  await page.locator("#local-key").fill(fixtureKey);
  await page.locator("#copy-local-key").click();
  assert.equal(
    await page.evaluate(() => navigator.clipboard.readText()),
    fixtureKey,
  );
  // Keep screenshots free of any real key or conversation content.
  await page.locator("#local-key").evaluate((e) => (e.type = "password"));
  await page.locator("#copy-local-address").click();
  assert.equal(
    await page.evaluate(() => navigator.clipboard.readText()),
    access.host + ":43129",
  );
  await page
    .locator("#agent-dialog")
    .screenshot({ path: path.join(evidence, "device-settings-desktop.png") });
  await page.setViewportSize({ width: 390, height: 844 });
  const geometry = await page.locator("#agent-dialog").evaluate((e) => ({
    width: e.getBoundingClientRect().width,
    height: e.getBoundingClientRect().height,
    viewportWidth: innerWidth,
    viewportHeight: innerHeight,
    overflow: e.scrollHeight > e.clientHeight,
  }));
  assert.ok(geometry.width <= 390 && geometry.height <= 844);
  await page
    .locator("#agent-dialog")
    .screenshot({ path: path.join(evidence, "device-settings-mobile.png") });
  await page.locator("#save-agent").click();
  await page.waitForFunction(
    () => !document.querySelector("#agent-dialog").open,
  );
  const saved = await api(s.address, "/local-access");
  assert.equal(saved.port, 43129);
  assert.equal(saved.enabled, false);
  assert.equal(saved.listening, null);
  assert.equal((await api(s.address, "/pairing-key", {})).key, fixtureKey);
  assert.ok(
    !fs
      .readFileSync(path.join(s.home, "data/remote-access.json"), "utf8")
      .includes(fixtureKey),
  );
  checks.deviceSettings = {
    tailscaleIp: access.host,
    port: saved.port,
    generatedKey: true,
    customKeySaved: true,
    clipboard: true,
    DPAPI: true,
    loopbackOnly: true,
    mobile: geometry,
  };
  await page.setViewportSize({ width: 1440, height: 1060 });
  const draft = "未发送的升级恢复测试草稿 " + randomUUID();
  const png = fs.readFileSync(path.join(root, "public/app-icon-192.png"));
  await page.locator("#prompt").fill(draft);
  await page.locator("#image").setInputFiles({
    name: "update-test.png",
    mimeType: "image/png",
    buffer: png,
  });
  await edit();
  await page.locator("#check-updates").click();
  await page.waitForFunction(
    () => !document.querySelector("#install-update").disabled,
  );
  assert.match(await page.locator("#update-status").textContent(), /0\.8\.1/);
  const oldCsrf = await page
    .locator("meta[name=bridge-csrf]")
    .getAttribute("content");
  await page.locator("#install-update").click();
  console.log("manual: signed download and installation requested through UI");
  const result = await updated(s);
  await page.waitForFunction(
    (csrf) => document.querySelector("meta[name=bridge-csrf]").content !== csrf,
    oldCsrf,
    { timeout: 60000 },
  );
  await page.waitForFunction(
    (text) => document.querySelector("#prompt").value === text,
    draft,
  );
  const restored = await page.locator("#image").evaluate(async (e) => {
    const f = e.files[0];
    return f
      ? {
          name: f.name,
          bytes: Array.from(new Uint8Array(await f.arrayBuffer())),
        }
      : null;
  });
  assert.equal(restored.name, "update-test.png");
  assert.equal(hash(Buffer.from(restored.bytes)), hash(png));
  assert.notEqual(
    (await api(s.address, "/instance")).instanceId,
    initial.instanceId,
  );
  assert.equal((await api(s.address, "/pairing-key", {})).key, fixtureKey);
  assert.equal((await api(s.address, "/local-access")).port, 43129);
  assert.equal(
    (await api(s.address, "/agents")).agents.find((a) => a.id === "local").name,
    "Update Probe Device",
  );
  assert.equal(
    (await api(s.address, "/status")).officialPid,
    original.officialPid,
  );
  assert.deepEqual(errors, []);
  assert.deepEqual(blocked, []);
  checks.manualUpdate = {
    result,
    sameLoopbackPort: true,
    exeHashMatches: true,
    textDraftRestored: true,
    imageBytesRestored: true,
    deviceAndKeyPreserved: true,
    pageErrors: errors,
    taskWrites: blocked.length,
  };
  console.log(
    "manual: 0.8.1 running; text, original image bytes and device configuration preserved",
  );
  await browser.close();
  browser = null;
  await run(s, ["--stop"]);
  const auto = await start("自动更新");
  const clientId = randomUUID();
  const timer = setInterval(
    () =>
      api(auto.address, "/updates/activity", {
        id: clientId,
        busy: true,
      }).catch(() => {}),
    3000,
  );
  try {
    await api(auto.address, "/updates/activity", { id: clientId, busy: true });
    await api(auto.address, "/updates/settings", { automatic: true });
    await until(
      async () => (await api(auto.address, "/updates")).phase === "waiting",
      "automatic update waits for draft",
    );
    assert.equal((await api(auto.address, "/instance")).version, "0.8.0");
    await api(auto.address, "/updates/settings", { automatic: false });
    await until(
      async () => (await api(auto.address, "/updates")).phase === "available",
      "automatic update cancelled",
    );
    assert.equal((await api(auto.address, "/instance")).version, "0.8.0");
  } finally {
    clearInterval(timer);
  }
  await api(auto.address, "/updates/activity", { id: clientId, busy: false });
  await api(auto.address, "/updates/settings", { automatic: true });
  console.log(
    "automatic: busy deferral and cancellation passed; installing after idle",
  );
  const automaticResult = await updated(auto);
  assert.equal((await api(auto.address, "/updates")).automatic, true);
  assert.equal(
    (await api(auto.address, "/status")).officialPid,
    original.officialPid,
  );
  checks.automaticUpdate = {
    result: automaticResult,
    busyDeferral: true,
    cancellation: true,
    installedWithoutInstallRequest: true,
    exeHashMatches: true,
  };
  assert.equal(
    (await api("http://127.0.0.1:43127", "/status")).officialPid,
    original.officialPid,
  );
  checks.originalOfficialAndBridgeUnaffected = true;
  report.result = "passed";
  console.log(
    "automatic: passed; original desktop and preview bridge unchanged",
  );
} catch (error) {
  report.result = "failed";
  report.error = error.message;
  throw error;
} finally {
  if (browser) await browser.close();
  for (const s of services) await run(s, ["--stop"]).catch(() => {});
  fs.writeFileSync(
    path.join(evidence, "update-verification.json"),
    JSON.stringify(report, null, 2),
  );
  console.log(
    JSON.stringify({
      result: report.result,
      checks: Object.keys(checks),
      evidence: "evidence/update-verification.json",
    }),
  );
}
