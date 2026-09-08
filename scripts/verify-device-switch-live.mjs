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
  transfers = [];
page.on("pageerror", (e) => errors.push(e.message));
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
  for (const id of targets) {
    const t = Date.now();
    await page.locator(`.thread-card[data-thread-id="${id}"]`).first().click();
    await page.waitForFunction(
      (id) =>
        document.querySelector("#metadata").textContent.includes(id) &&
        document.querySelector("#messages").querySelectorAll(".turn").length >
          0,
      id,
      { timeout: 85000 },
    );
    const ui = await page.evaluate(() => ({
      turns: document.querySelectorAll("#messages .turn").length,
      textChars: document.querySelector("#messages").textContent.length,
      promptEnabled: !document.querySelector("#prompt").disabled,
      connection: document.querySelector("#connection").textContent,
    }));
    assert.ok(ui.turns > 0 && ui.textChars > 0);
    assert.equal(ui.promptEnabled, true);
    checks.push({
      kind: "remote-content",
      threadId: id,
      ms: Date.now() - t,
      ...ui,
    });
    console.log(JSON.stringify(checks.at(-1)));
  }
  const start = Date.now();
  await device(data.agents.find((a) => a.id === "local").name);
  await connected();
  await page.waitForFunction(
    () => document.querySelectorAll(".thread-card").length > 0,
  );
  checks.push({
    kind: "switch-back-local",
    ms: Date.now() - start,
    threadCards: await page.locator(".thread-card").count(),
  });
  assert.ok(Date.now() - start < 10000);
  assert.deepEqual(errors, []);
  assert.deepEqual(blocked, []);
  console.log(JSON.stringify({ checks, transfers, errors, blocked }));
} finally {
  fs.mkdirSync(path.join(ROOT, "evidence"), { recursive: true });
  fs.writeFileSync(
    path.join(ROOT, "evidence/device-switch-live.json"),
    JSON.stringify(
      {
        source:
          "real loopback service -> saved Tailscale device -> official desktop owner; preference writes suppressed",
        sourceOverride,
        version: runtime.version,
        checks,
        transfers,
        errors,
        blocked,
      },
      null,
      2,
    ),
  );
  await browser.close();
}
