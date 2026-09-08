// Read-only live UI verification plus clearly isolated device response fixtures.
// Never sends a task message, saves a real device, or operates the official window.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const { chromium } = await import(
  process.env.REMOTE_BRIDGE_PLAYWRIGHT || "playwright-core"
);
const base = "http://127.0.0.1:43127";
const out = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../evidence",
);
const report = {
  observedAt: new Date().toISOString(),
  scope:
    "Windows Edge headless; own prototype only; local quota live, other device responses simulated",
  checks: {},
  viewports: [],
};
const browser = await chromium.launch({
  executablePath:
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  headless: true,
});
const errors = [],
  forbidden = [];
const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
page.on("pageerror", (e) => errors.push(e.message));
await page.route("**/*", (route) => {
  const r = route.request();
  if (
    !r.url().startsWith(base + "/") ||
    (r.method() === "POST" && /\/threads/.test(r.url()))
  ) {
    forbidden.push(r.method() + " " + r.url());
    return route.abort();
  }
  return route.continue();
});
try {
  await page.goto(base + "/?ui=0.6.4");
  await page.waitForFunction(() =>
    document.querySelector("#agent-quota").textContent.includes("%"),
  );
  await page.waitForFunction(() => !document.querySelector("#prompt").disabled);
  report.liveUsage = await page.evaluate(async () => {
    const r = await fetch("/api/agents/local/bridge/usage", {
      headers: {
        "X-Bridge-CSRF": document.querySelector('meta[name="bridge-csrf"]')
          .content,
      },
    });
    if (!r.ok) throw Error("Live quota API failed");
    return r.json();
  });
  assert.equal(report.liveUsage.source, "official-desktop-app-tools-live");
  assert.equal(report.liveUsage.status, "available");
  report.checks.liveLocalWeeklyQuota = true;
  await page.locator("#prompt").fill("仅用于布局检查的未发送草稿");
  for (const [width, height, mobile] of [
    [1440, 960, false],
    [819, 900, true],
    [390, 844, true],
    [320, 568, true],
    [844, 390, false],
    [640, 360, false],
  ]) {
    await page.setViewportSize({ width, height });
    await page.waitForFunction(
      (m) => document.body.classList.contains("mobile-layout") === m,
      mobile,
    );
    assert.equal(await page.locator("#agent-menu").isVisible(), false);
    if (mobile) {
      await page.locator("#mobile-menu").click();
      await page.waitForFunction(
        () =>
          document.querySelector("#sidebar").getBoundingClientRect().x === 0,
      );
      assert.equal(await page.locator("#drawer-close").isVisible(), true);
    }
    const footer = await page.locator("#footer-agent").boundingBox();
    assert.ok(footer.y > height - 110 && footer.y + footer.height <= height);
    await page.locator("#footer-agent").click();
    assert.equal(await page.locator("#agent-menu").isVisible(), true);
    assert.equal(
      await page.locator("#footer-agent").getAttribute("aria-expanded"),
      "true",
    );
    const menu = await page.locator("#agent-menu").boundingBox();
    assert.ok(
      menu.y >= 0 && menu.x >= 0 && menu.x + menu.width <= width,
      JSON.stringify({ width, height, menu }),
    );
    assert.ok(menu.y + menu.height <= footer.y + 1);
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
    );
    // Internal nonfocusable targets must not dismiss the popup when its
    // currently focused device button blurs with relatedTarget === null.
    for (const target of [
      page.locator(".usage-heading strong"),
      page.locator(".usage-note").first(),
      page.locator("#usage-details progress").first(),
    ]) {
      await page.locator(".agent-card").first().focus();
      await target.click();
      assert.equal(await page.locator("#agent-menu").isVisible(), true);
    }
    await page.locator(".agent-card").first().focus();
    await page.locator("#agent-menu").click({ position: { x: 4, y: 24 } });
    assert.equal(await page.locator("#agent-menu").isVisible(), true);
    if (width === 1440) {
      await Promise.all([
        page.waitForResponse((r) => r.url().endsWith("/local/bridge/usage")),
        page.locator("#refresh-usage").click(),
      ]);
      await page.waitForFunction(
        () => !document.querySelector("#refresh-usage").disabled,
      );
      assert.equal(await page.locator("#agent-menu").isVisible(), true);
      await page.locator("#refresh-usage").focus();
      await page.keyboard.press("Tab");
      assert.equal(await page.locator("#agent-menu").isVisible(), false);
      await page.locator("#footer-agent").click();
      report.checks.internalRefreshAndKeyboardExit = true;
    }
    if ([1440, 390, 844].includes(width))
      await page.screenshot({
        path: path.join(out, `ui-v6.4-picker-${width}.png`),
        style: "#threads, #project-groups { visibility: hidden !important; }",
      });
    await page.keyboard.press("Escape");
    assert.equal(await page.locator("#agent-menu").isVisible(), false);
    assert.equal(
      await page
        .locator("#footer-agent")
        .evaluate((n) => n === document.activeElement),
      true,
    );
    if (mobile)
      assert.equal(
        await page.evaluate(() =>
          document.body.classList.contains("drawer-open"),
        ),
        true,
      );
    await page.keyboard.press("Enter");
    await page.locator('[data-agent-id="local"]').click();
    assert.equal(
      await page.locator("#prompt").inputValue(),
      "仅用于布局检查的未发送草稿",
    );
    await page.locator("#footer-agent").click();
    // The 2px sidebar edge is outside the popup, even on short landscape screens.
    await page.mouse.click(2, 80);
    assert.equal(await page.locator("#agent-menu").isVisible(), false);
    if (mobile) await page.locator("#drawer-close").click();
    report.viewports.push({
      width,
      height,
      mobile,
      footerAtBottom: true,
      popupAboveFooter: true,
      noHorizontalOverflow: true,
      escapeAndOutsideClose: true,
      sameDevicePreservesDraft: true,
      internalTextProgressAndBlankClicksStayOpen: true,
    });
  }
  report.checks.responsivePickerAndKeyboard = true;
  await page.close();

  // Isolated browser responses: no physical second computer or saved user data.
  const sim = await browser.newPage({ viewport: { width: 1440, height: 960 } });
  sim.on("pageerror", (e) => errors.push(e.message));
  let selected = "local",
    delayed = false,
    releaseUsage,
    quotaFail = false,
    holdEvents = [];
  const devices = [
    { id: "local", name: "模拟本机", kind: "local", host: "fixture-local" },
    {
      id: "fixture-remote",
      name: "模拟工作机",
      kind: "remote",
      host: "100.70.8.9",
      port: 43128,
    },
    {
      id: "fixture-offline",
      name: "模拟离线机",
      kind: "remote",
      host: "100.70.8.10",
      port: 43128,
    },
  ];
  await sim.route(base + "/api/**", async (route) => {
    const r = route.request(),
      u = new URL(r.url());
    const json = (body, status = 200) =>
      route.fulfill({
        status,
        contentType: "application/json",
        body: JSON.stringify(body),
      });
    if (u.pathname === "/api/agents")
      return json({ agents: devices, selectedId: selected });
    if (u.pathname === "/api/agents/select") {
      selected = r.postDataJSON().id;
      return json({ agents: devices, selectedId: selected });
    }
    if (
      u.pathname === "/api/agents/fixture-offline/bridge/status" ||
      u.pathname === "/api/agents/fixture-offline/bridge/connect"
    )
      return json({ error: "Simulated offline device" }, 502);
    if (u.pathname.endsWith("/status")) return json({ connected: true });
    if (u.pathname.endsWith("/projects"))
      return json({ data: { projects: [] } });
    if (u.pathname.endsWith("/threads") && r.method() === "GET")
      return json({ data: { threads: [], pinnedThreads: [] } });
    if (u.pathname.endsWith("/events")) {
      await new Promise((resolve) => holdEvents.push(resolve));
      return route.abort().catch(() => {});
    }
    if (u.pathname.endsWith("/usage")) {
      const local = u.pathname.includes("/local/");
      if (delayed && local) {
        delayed = false;
        await new Promise((resolve) => {
          releaseUsage = resolve;
        });
      }
      if (quotaFail) return json({ error: "Simulated quota failure" }, 502);
      return json({
        status: "available",
        source: "test-fixture-only",
        observedAt: new Date().toISOString(),
        weekly: [
          {
            limitId: "codex",
            label: "Codex",
            remainingPercent: local ? 61 : 22,
            resetsAt: 1789435536,
          },
        ],
      });
    }
    throw Error(
      "Unexpected simulated request: " + r.method() + " " + u.pathname,
    );
  });
  await sim.goto(base);
  await sim.waitForFunction(() =>
    document.querySelector("#agent-quota").textContent.includes("61%"),
  );
  delayed = true;
  await sim.locator("#footer-agent").click();
  await sim.waitForFunction(
    () => document.querySelector("#refresh-usage").disabled,
  );
  await sim.locator('[data-agent-id="fixture-remote"]').click();
  await sim.waitForFunction(() =>
    document.querySelector("#agent-quota").textContent.includes("22%"),
  );
  assert.ok(releaseUsage, "previous device request is pending");
  releaseUsage();
  await sim.waitForResponse((r) => r.url().endsWith("/local/bridge/usage"));
  await sim.evaluate(
    () =>
      new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))),
  );
  assert.ok((await sim.locator("#agent-quota").textContent()).includes("22%"));
  report.checks.fixtureDelayedPreviousDeviceIgnored = true;
  quotaFail = true;
  await sim.locator("#footer-agent").click();
  await sim.waitForFunction(() =>
    document.querySelector("#agent-quota").textContent.includes("未知"),
  );
  assert.ok(
    !(await sim.locator("#usage-details").textContent()).includes("22%"),
  );
  report.checks.fixtureFailedReadClearsPercentage = true;
  quotaFail = false;
  await sim.locator('[data-agent-id="fixture-offline"]').click();
  await sim.waitForFunction(() =>
    document.querySelector("#connection").textContent.includes("中断"),
  );
  assert.ok((await sim.locator("#agent-quota").textContent()).includes("未知"));
  await sim.locator("#footer-agent").click();
  await sim.locator('[data-agent-id="local"]').click();
  await sim.waitForFunction(() =>
    document.querySelector("#agent-quota").textContent.includes("61%"),
  );
  report.checks.fixtureOfflineUnknownAndReconnect = true;
  holdEvents.forEach((fn) => fn());
  await sim.close();
  assert.deepEqual(errors, []);
  assert.deepEqual(forbidden, []);
  report.checks.noTaskWritesOrExternalRequests = true;
  report.status = "passed";
} catch (e) {
  report.status = "failed";
  report.failure = e.message;
  throw e;
} finally {
  report.pageErrors = errors;
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(
    path.join(out, "ui-v6.4-picker.json"),
    JSON.stringify(report, null, 2),
  );
  await browser.close();
  console.log(JSON.stringify(report, null, 2));
}
