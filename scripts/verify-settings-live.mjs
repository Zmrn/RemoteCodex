// Explicitly changes and restores model/effort on one registered, idle Probe.
// Does not send messages, change permissions, or automate the official window.
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { assertProbeTarget } from "../src/probe-safety.mjs";
import { fileURLToPath } from "node:url";
const [flag, id] = process.argv.slice(2);
if (flag !== "--apply-to-probe" || !/^[a-f0-9-]{36}$/.test(id ?? ""))
  throw Error(
    "Usage: node scripts/verify-settings-live.mjs --apply-to-probe PROBE_ID",
  );
const { chromium } = await import(
  process.env.REMOTE_BRIDGE_PLAYWRIGHT || "playwright-core"
);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const base = "http://127.0.0.1:43127";
const html = await (await fetch(base)).text();
const headers = {
  "X-Bridge-CSRF": html.match(/name="bridge-csrf"\s+content="([^"]+)"/)[1],
};
const get = async (route) => {
  const response = await fetch(base + "/api" + route, { headers });
  if (!response.ok) throw Error("Read failed: " + response.status);
  return response.json();
};
const [status, catalog, agents, initial] = await Promise.all([
  get("/status"),
  get("/models"),
  get("/agents"),
  get("/threads/" + id),
]);
assert.equal(
  agents.selectedId,
  "local",
  "Select the local device before this test",
);
assert.ok(status.connected);
assertProbeTarget(status, id);
assert.equal(initial.data.thread.status.type, "idle");
const original = initial.live?.state?.latestThreadSettings;
assert.ok(
  original?.model && original?.effort,
  "Need restorable explicit model and effort",
);
const originalModel = catalog.models.find((m) => m.id === original.model);
assert.ok(originalModel?.efforts.includes(original.effort));
const alternative = catalog.models.find(
  (m) => m.id !== original.model && m.efforts.includes(original.effort),
);
const alternateEffort = alternative?.efforts.find(
  (e) => e !== original.effort && originalModel.efforts.includes(e),
);
assert.ok(alternative && alternateEffort);
const fingerprint = (s) =>
  createHash("sha256")
    .update(
      JSON.stringify({
        permissions: s.permissions,
        activePermissionProfile: s.activePermissionProfile,
        sandboxPolicy: s.sandboxPolicy,
        approvalPolicy: s.approvalPolicy,
      }),
    )
    .digest("hex");
const report = {
  scope:
    "official owner settings through own UI; registered idle Probe only; model/effort restored; no model messages",
  threadId: id,
  officialPid: status.officialPid,
  owner: initial.live.owner,
  original: { model: original.model, effort: original.effort },
  requests: [],
  checks: {},
  errors: [],
};
const browser = await chromium.launch({
  executablePath:
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  headless: true,
});
const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
page.on("pageerror", (e) => report.errors.push(e.message));
await page.route(base + "/api/**", async (route) => {
  const r = route.request(),
    p = new URL(r.url()).pathname;
  if (r.method() === "POST") {
    if (
      ![
        "/api/agents/select",
        `/api/agents/local/bridge/threads/${id}/follow`,
        `/api/agents/local/bridge/threads/${id}/settings`,
      ].includes(p)
    )
      throw Error("Refusing unexpected live write: " + p);
    if (p.endsWith("/settings")) {
      const body = r.postDataJSON();
      assert.ok(
        Object.keys(body.settings).every((key) =>
          ["model", "effort"].includes(key),
        ),
      );
      report.requests.push({
        requestId: body.requestId,
        settings: body.settings,
        route: p,
      });
    }
  }
  return route.continue();
});
const menu = page.locator("#settings-menu");
async function settingsNow() {
  const r = await get("/threads/" + id);
  assert.equal(r.data.thread.status.type, "idle");
  assert.equal(r.live.owner, initial.live.owner);
  return r;
}
async function choose(kind, value) {
  await page.keyboard.press("Escape");
  await page.waitForFunction(
    () => !document.querySelector("#model-display").disabled,
  );
  await page.locator(`#${kind}-display`).click();
  await page.waitForFunction(() =>
    document.querySelector("#settings-menu").querySelector("button"),
  );
  const response = page.waitForResponse(
    (r) =>
      r.request().method() === "POST" &&
      new URL(r.url()).pathname.endsWith("/settings"),
  );
  if (kind === "model") await menu.locator(`[data-value="${value}"]`).click();
  else {
    const state = await settingsNow();
    const efforts = catalog.models.find(
      (m) => m.id === state.live.state.latestThreadSettings.model,
    ).efforts;
    await page.locator("#effort-slider").evaluate((el, index) => {
      el.value = String(index);
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    }, efforts.indexOf(value));
  }
  const r = await (await response).json();
  assert.equal(r.status, "accepted");
  assert.equal(r.result.ownerClientId, initial.live.owner);
  await page.waitForFunction(
    () => !document.querySelector("#model-display").disabled,
  );
  const observed = (await settingsNow()).live.state.latestThreadSettings;
  assert.equal(observed[kind], value);
}
let failure;
try {
  await page.goto(base + "/?ui=0.6.2&thread=" + id);
  await page.waitForFunction(() =>
    document.querySelector("#metadata").textContent.includes("读取时间:"),
  );
  await page.locator("#model-display").click();
  await menu.locator(`[data-value="${original.model}"]`).waitFor();
  assert.equal(
    await menu.locator('[role="menuitemradio"]').count(),
    catalog.models.length + 1,
  );
  assert.equal(await page.locator("dialog[open]").count(), 0);
  await menu.screenshot({
    path: path.join(root, "evidence/ui-v6.2-live-model-menu.png"),
  });
  report.checks.liveCatalogDropdown = true;
  await choose("model", alternative.id);
  report.changed = { model: alternative.id, effort: original.effort };
  await choose("effort", alternateEffort);
  report.changed.effort = alternateEffort;
  report.checks.realOwnerModelAndEffortAccepted = true;
} catch (e) {
  failure = e;
} finally {
  try {
    const now = (await settingsNow()).live.state.latestThreadSettings;
    assert.ok(
      [original.model, alternative.id].includes(now.model),
      "Probe settings changed outside test; do not overwrite",
    );
    assert.ok(
      [original.effort, alternateEffort].includes(now.effort),
      "Probe effort changed outside test; do not overwrite",
    );
    if (now.model !== original.model) await choose("model", original.model);
    if (now.effort !== original.effort) await choose("effort", original.effort);
    const final = await settingsNow();
    const s = final.live.state.latestThreadSettings;
    assert.equal(s.model, original.model);
    assert.equal(s.effort, original.effort);
    assert.equal(fingerprint(s), fingerprint(original));
    assert.deepEqual(
      final.data.turns.map((t) => t.id),
      initial.data.turns.map((t) => t.id),
    );
    report.checks.originalSettingsRestored = true;
    report.checks.permissionsAndTurnIdsUnchanged = true;
    report.restored = { model: s.model, effort: s.effort };
  } catch (e) {
    failure ??= e;
    report.restoreError = e.message;
  }
  report.status = failure ? "failed" : "passed";
  if (failure) report.failure = failure.message;
  report.observedAt = new Date().toISOString();
  fs.writeFileSync(
    path.join(root, "evidence/ui-v6.2-settings-live.json"),
    JSON.stringify(report, null, 2),
  );
  await browser.close();
  console.log(JSON.stringify(report, null, 2));
}
if (failure) throw failure;
