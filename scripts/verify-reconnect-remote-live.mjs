// Read-only two-device checks using the running bridge and real owner snapshots.
// Only /follow (subscribe) and /connect are permitted; task mutations are blocked.
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { ROOT } from "../src/bridge.mjs";
const { chromium } = await import(
  process.env.REMOTE_BRIDGE_PLAYWRIGHT || "playwright-core"
);
const runtime = JSON.parse(
  fs.readFileSync(
    path.join(process.env.LOCALAPPDATA, "RemoteCodex/data/server.json"),
  ),
);
const address = runtime.address;
const html = await (await fetch(address)).text();
const csrf = html.match(/name="bridge-csrf"\s+content="([^"]+)"/)[1];
const headers = { "X-Bridge-CSRF": csrf };
const data = await (await fetch(address + "/api/agents", { headers })).json();
const [remoteId, ...targets] = process.argv.slice(2);
const sourceOverride = process.env.REMOTE_BRIDGE_UI_SOURCE_TEST === "1";
const switchDuringRead = process.env.REMOTE_BRIDGE_SWITCH_DURING_READ === "1";
const laptop = data.agents.find(
  (a) => a.id === remoteId && a.kind === "remote",
);
assert.ok(
  laptop,
  "Usage: node scripts/verify-device-switch-live.mjs SAVED_AGENT_ID TASK_ID [TASK_ID]",
);
assert.ok(targets.length && targets.every((id) => /^[a-f0-9-]{36}$/.test(id)));
const browser = await chromium.launch({
  executablePath:
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  headless: true,
});
const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
const errors = [],
  checks = [],
  blocked = [],
  transfers = [],
  aborted = [];
let failure = null;
page.on("pageerror", (e) => errors.push(e.message));
page.on("requestfailed", (req) => {
  if (/\/threads\/[\w-]+$/.test(new URL(req.url()).pathname))
    aborted.push({
      path: new URL(req.url()).pathname,
      error: req.failure()?.errorText,
    });
});
page.on("requestfinished", async (req) => {
  const url = new URL(req.url());
  if (/\/threads\/[\w-]+$/.test(url.pathname)) {
    const response = await req.response(),
      sizes = await req.sizes().catch(() => ({}));
    transfers.push({
      path: url.pathname,
      http: response.status(),
      encoding: response.headers()["content-encoding"] ?? null,
      wireBytes: sizes.responseBodySize,
    });
  }
});
// Serve current source over the existing local runtime without replacing its
// installed files. Fixture only the selection preference to leave it unchanged.
await page.route(address + "/**", async (route) => {
  const req = route.request(),
    p = new URL(req.url()).pathname;
  if (p === "/api/agents/select")
    return route.fulfill({ contentType: "application/json", body: "{}" });
  if (
    req.method() === "POST" &&
    !(/\/(follow|connect)$/.test(p) || p === "/api/updates/activity")
  ) {
    blocked.push(p);
    return route.fulfill({
      status: 403,
      contentType: "application/json",
      body: '{"error":"read-only validation"}',
    });
  }
  if (sourceOverride && p === "/")
    return route.fulfill({
      contentType: "text/html",
      body: fs
        .readFileSync(path.join(ROOT, "public/index.html"), "utf8")
        .replace("__BRIDGE_CSRF__", csrf)
        .replace("__BRIDGE_VERSION__", runtime.version),
    });
  if (sourceOverride && /^\/[\w-]+\.(js|mjs|css)$/.test(p))
    return route.fulfill({
      contentType: p.endsWith("css") ? "text/css" : "text/javascript",
      body: fs.readFileSync(path.join(ROOT, "public", p.slice(1)), "utf8"),
    });
  return route.continue();
});
const device = async (name) => {
  await page.locator("#footer-agent").click();
  await page.locator("#agent-menu button").filter({ hasText: name }).click();
};
const connected = () =>
  page.waitForFunction(
    () =>
      document.querySelector("#connection").textContent === "已连接官方桌面",
    {},
    { timeout: 25000 },
  );
try {
  await page.goto(address);
  await connected();
  if (data.selectedId !== laptop.id) {
    await device(laptop.name);
    await connected();
  }
  const id = targets[0];
  await page.locator(`.thread-card[data-thread-id="${id}"]`).first().click();
  await page.waitForFunction(
    () => document.querySelectorAll("#messages .message").length > 0,
    {},
    { timeout: 30000 },
  );
  const before = await (
    await fetch(address + "/api/agents/" + remoteId + "/bridge/status", {
      headers,
    })
  ).json();
  const beforeContent = await page.locator("#messages").innerText();
  await page
    .locator("#prompt")
    .fill("Remote reconnect validation: unsent draft");
  await page.context().setOffline(true);
  // Aborts only this test browser's viewing stream, not either bridge or the task.
  await page.locator("#reconnect").click();
  await page.waitForFunction(() =>
    document.querySelector("#connection").textContent.includes("自动重连"),
  );
  assert.match(await page.locator("#task-state").innerText(), /未知/);
  assert.equal(await page.locator("#messages").innerText(), beforeContent);
  await new Promise((r) => setTimeout(r, 2500));
  const started = Date.now();
  await page.context().setOffline(false);
  await connected();
  await page.waitForFunction(
    () => !document.querySelector("#prompt").disabled,
    {},
    { timeout: 30000 },
  );
  assert.equal(
    await page.locator("#prompt").inputValue(),
    "Remote reconnect validation: unsent draft",
  );
  const after = await (
    await fetch(address + "/api/agents/" + remoteId + "/bridge/status", {
      headers,
    })
  ).json();
  assert.equal(after.officialPid, before.officialPid);
  assert.equal(after.connected, true);
  assert.deepEqual(blocked, []);
  assert.deepEqual(errors, []);
  const report = {
    result: "passed",
    observedAt: new Date().toISOString(),
    localVersion: runtime.version,
    sourceOverride,
    source:
      "real saved laptop through Tailscale; isolated browser network outage",
    remoteId,
    taskId: id,
    officialPid: after.officialPid,
    recoveredMs: Date.now() - started,
    retainedContent: true,
    retainedDraft: true,
    sameOfficialProcess: true,
    blocked,
    errors,
    taskMutations: 0,
  };
  fs.mkdirSync(path.join(ROOT, "evidence"), { recursive: true });
  fs.writeFileSync(
    path.join(ROOT, "evidence/reconnect-remote-live.json"),
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report));
} finally {
  await browser.close();
}
