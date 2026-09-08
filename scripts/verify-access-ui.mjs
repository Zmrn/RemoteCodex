// Isolated UI fixtures only: does not open a Tailscale port or read a real key.
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { ROOT } from "../src/bridge.mjs";
import { startServer } from "../src/server.mjs";
const { chromium } = await import(
  process.env.REMOTE_BRIDGE_PLAYWRIGHT || "playwright-core"
);
const dir = fs.mkdtempSync(path.join(ROOT, "work/access-ui-"));
fs.writeFileSync(path.join(dir, "update-settings.json"), '{"automatic":false}');
const { server, address } = await startServer({
  port: 0,
  bridge: { dataDir: dir, connect: async () => {}, on() {}, off() {} },
});
const browser = await chromium.launch({
  executablePath:
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  headless: true,
});
const page = await browser.newPage({ viewport: { width: 1280, height: 960 } });
const errors = [],
  writes = [],
  events = [];
const agents = [{ id: "local", name: "这台电脑", kind: "local" }];
let access = {
  addresses: ["100.70.8.9"],
  host: "100.70.8.9",
  port: 43210,
  enabled: false,
  hasKey: true,
  listening: null,
  error: "",
};
page.on("pageerror", (e) => errors.push(e.message));
await page.route(address + "/api/**", async (route) => {
  const req = route.request(),
    p = new URL(req.url()).pathname;
  const json = (data) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(data),
    });
  if (p === "/api/remote-info") return json(access);
  if (p === "/api/local-access") {
    if (req.method() === "POST") {
      const body = req.postDataJSON();
      writes.push({ route: p, ...body });
      access = {
        ...access,
        ...body,
        listening: body.enabled
          ? { address: body.host, port: body.port }
          : null,
      };
    }
    return json(access);
  }
  if (p === "/api/agents") return json({ agents, selectedId: "local" });
  if (p === "/api/agents/select") return json({});
  if (p.endsWith("/status") || p.endsWith("/connect"))
    return json({ connected: true, existingCodexWritable: true });
  if (p.endsWith("/updates"))
    return json({
      supported: false,
      automatic: false,
      currentVersion: "fixture",
      phase: "idle",
    });
  if (p.endsWith("/projects")) return json({ data: { projects: [] } });
  if (p.endsWith("/threads")) return json({ data: { threads: [] } });
  if (p.endsWith("/events")) {
    await new Promise((r) => events.push(r));
    return route.abort().catch(() => {});
  }
  return json({});
});
try {
  await page.goto(address);
  await page.locator("#remote-setup").click();
  await page.waitForFunction(() =>
    document.querySelector("#remote-info").textContent.includes("43210"),
  );
  assert.match(await page.locator("#remote-info").textContent(), /尚未监听/);
  assert.match(
    await page.locator("#remote-info").textContent(),
    /仅复制密钥不会开启接入/,
  );
  assert.equal(writes.length, 0);
  await page.locator("#configure-local-access").click();
  await page.waitForFunction(
    () => document.querySelector("#local-host").value === "100.70.8.9",
  );
  assert.equal(await page.locator("#local-access-fields").isVisible(), true);
  assert.equal(await page.locator("#local-enabled").isChecked(), false);
  assert.equal(writes.length, 0, "opening settings must not enable access");
  await page.locator("#local-port").fill("43211");
  await page.locator("#local-enabled").check();
  await page.locator("#save-agent").click();
  await page.waitForFunction(
    () => !document.querySelector("#agent-dialog").open,
  );
  assert.deepEqual(
    writes.map((w) => ({ host: w.host, port: w.port, enabled: w.enabled })),
    [{ host: "100.70.8.9", port: 43211, enabled: true }],
  );
  await page.locator("#remote-setup").click();
  await page.waitForFunction(() =>
    document
      .querySelector("#remote-info")
      .textContent.includes("远程接入已开启"),
  );
  assert.match(
    await page.locator("#remote-info").textContent(),
    /100\.70\.8\.9:43211/,
  );
  await page
    .locator("#setup-dialog")
    .screenshot({ path: path.join(ROOT, "evidence/access-ui-enabled.png") });
  await page.locator("#setup-dialog .close-dialog").click();
  access = { ...access, enabled: false, listening: null };
  await page.locator("#help").click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForFunction(() =>
    document.querySelector("#remote-info").textContent.includes("尚未监听"),
  );
  await page.locator("#configure-local-access").scrollIntoViewIfNeeded();
  await page
    .locator("#setup-dialog")
    .screenshot({
      path: path.join(ROOT, "evidence/access-ui-disabled-mobile.png"),
    });
  assert.deepEqual(errors, []);
  const result = {
    result: "passed",
    source: "isolated UI fixtures",
    checks: [
      "configured-port-visible-when-disabled",
      "actual-listening-endpoint-visible",
      "setup-opens-local-editor",
      "no-enabling-until-explicit-save",
      "mobile-status-readable",
    ],
    errors,
  };
  fs.writeFileSync(
    path.join(ROOT, "evidence/access-ui.json"),
    JSON.stringify(result, null, 2),
  );
  console.log(JSON.stringify(result));
} finally {
  for (const release of events) release();
  await browser.close();
  server.closeAllConnections();
  await new Promise((r) => server.close(r));
}
