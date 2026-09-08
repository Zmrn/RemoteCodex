// Isolated UI state transitions, followed by a read-only check of named local tasks.
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
const { chromium } = await import(
  process.env.REMOTE_BRIDGE_PLAYWRIGHT || "playwright-core"
);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const base = process.env.REMOTE_BRIDGE_URL || "http://127.0.0.1:43127";
const id = "77777777-7777-4777-8777-777777777777";
const completedId = "88888888-8888-4888-8888-888888888888";
const unknownId = "99999999-9999-4999-8999-999999999999";
const report = {
  scope: "own UI, isolated API and event fixtures; no model writes",
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
let runtime = { type: "running", confirmed: true },
  listStatus = "active",
  pendingList = null;
await page.addInitScript(() => {
  const original = window.fetch.bind(window);
  window.fetch = (url, options) => {
    if (String(url).endsWith("/events")) {
      const stream = new ReadableStream({
        start(controller) {
          window.emitBridgeEvent = (e) =>
            controller.enqueue(
              new TextEncoder().encode("data: " + JSON.stringify(e) + "\n\n"),
            );
          options.signal.addEventListener("abort", () => controller.close());
        },
      });
      return Promise.resolve(
        new Response(stream, {
          headers: { "Content-Type": "text/event-stream" },
        }),
      );
    }
    return original(url, options);
  };
});
await page.route(base + "/api/**", async (route) => {
  const p = new URL(route.request().url()).pathname;
  const json = (value) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(value),
    });
  if (p === "/api/agents")
    return json({
      selectedId: "local",
      agents: [
        { id: "local", kind: "local", name: "状态测试设备", host: "fixture" },
      ],
    });
  if (p === "/api/agents/select") return json({});
  if (p.endsWith("/status"))
    return json({
      connected: true,
      existingCodexWritable: true,
      threads: {
        [completedId]: { status: { type: "completed", confirmed: true } },
      },
    });
  if (p.endsWith("/usage")) return json({ status: "unknown", weekly: [] });
  if (p.endsWith("/projects")) return json({ data: { projects: [] } });
  if (p.endsWith("/threads")) {
    const data = {
      data: {
        threads: [
          { id, title: "运行中的任务", kind: "codex", status: listStatus },
          {
            id: completedId,
            title: "已完成的任务",
            kind: "codex",
            status: "idle",
          },
          {
            id: unknownId,
            title: "未加载的任务",
            kind: "codex",
            status: "notLoaded",
          },
        ],
      },
    };
    if (pendingList) {
      const pending = pendingList;
      pendingList = null;
      pending.started();
      await pending.wait;
    }
    return json(data);
  }
  if (p.endsWith("/follow")) return json({});
  if (p.endsWith("/queue"))
    return json({
      messages: [],
      recoveries: [],
      confirmed: true,
      revision: "fixture",
    });
  const match = /\/threads\/([\w-]+)$/.exec(p);
  if (match)
    return json({
      source: "isolated fixture",
      data: {
        thread: {
          id: match[1],
          title: match[1] === id ? "运行中的任务" : "已完成的任务",
          kind: "codex",
          cwd: "C:/Fixture",
          status: { type: match[1] === id ? listStatus : "idle" },
        },
        turns: [],
      },
      live: {
        status:
          match[1] === id ? runtime : { type: "completed", confirmed: true },
      },
    });
  throw Error("Unexpected fixture request: " + p);
});
const card = (task = id) =>
  page.locator(`.thread-card[data-thread-id="${task}"]`);
async function expectStatus(type, task = id) {
  await page.waitForFunction(
    ({ type, task }) =>
      document.querySelector(`.thread-card[data-thread-id="${task}"]`)?.dataset
        .status === type,
    { type, task },
  );
  assert.equal(
    await card(task).locator(".thread-dot.completed").count(),
    type === "completed" ? 1 : 0,
  );
  assert.equal(
    await card(task).locator(".thread-spinner").count(),
    type === "running" ? 1 : 0,
  );
}
async function emit(type, confirmed = true) {
  runtime = { type, confirmed };
  await page.evaluate(
    ({ id, status }) =>
      window.emitBridgeEvent({ kind: "thread-state", threadId: id, status }),
    { id, status: runtime },
  );
  await expectStatus(confirmed ? type : "unknown");
}
try {
  await page.goto(base + "/?ui=0.6.1");
  await expectStatus("running");
  await expectStatus("completed", completedId);
  await expectStatus("unknown", unknownId);
  report.checks.initialRunningCompletedUnknown = true;
  const spinner = await card().locator(".thread-spinner").elementHandle();
  const before = await spinner.evaluate((el) => getComputedStyle(el).transform);
  await page.waitForTimeout(170);
  assert.notEqual(
    await spinner.evaluate((el) => getComputedStyle(el).transform),
    before,
  );
  await emit("running");
  assert.ok(await spinner.evaluate((el) => el.isConnected));
  report.checks.rotationAndEventNodePreservation = true;
  for (const type of [
    "completed",
    "running",
    "waiting-approval",
    "waiting-user-input",
    "error",
    "interrupted",
  ])
    await emit(type);
  await emit("completed", false);
  report.checks.unselectedOwnerEventsAndUnconfirmedCompletion = true;
  await emit("running");
  await card(completedId).click();
  await expectStatus("completed", completedId);
  report.checks.readKeepsConfirmedCompletion = true;
  let release, started;
  const begun = new Promise((resolve) => (started = resolve));
  pendingList = {
    started,
    wait: new Promise((resolve) => (release = resolve)),
  };
  await page.locator("#refresh").click();
  await begun;
  await emit("completed");
  const response = page.waitForResponse((r) =>
    new URL(r.url()).pathname.endsWith("/threads"),
  );
  release();
  await response;
  await page.waitForTimeout(50);
  await expectStatus("completed");
  report.checks.lateListDoesNotOverwriteNewOwnerEvent = true;
  await emit("running");
  for (const [width, height] of [
    [1440, 960],
    [390, 844],
  ]) {
    await page.setViewportSize({ width, height });
    if (width === 390) await page.locator("#mobile-menu").click();
    assert.ok(await card().locator(".thread-spinner").isVisible());
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
    );
    await page.screenshot({
      path: path.join(root, `evidence/ui-v6.1-status-${width}.png`),
    });
  }
  report.checks.desktopAndMobileDrawer = true;
  await page.emulateMedia({ reducedMotion: "reduce" });
  assert.equal(
    await card()
      .locator(".thread-spinner")
      .evaluate((el) => getComputedStyle(el).animationName),
    "none",
  );
  report.checks.reducedMotionStillUsesRing = true;
  await page.evaluate(() =>
    window.emitBridgeEvent({ kind: "connection-interrupted" }),
  );
  await expectStatus("connection-interrupted");
  await expectStatus("connection-interrupted", completedId);
  report.checks.disconnectClearsCompletionAndRunning = true;
  assert.deepEqual(report.errors, []);
  report.status = "passed";
} catch (e) {
  report.status = "failed";
  report.failure = e.message;
  throw e;
} finally {
  report.observedAt = new Date().toISOString();
  fs.writeFileSync(
    path.join(root, "evidence/ui-v6.1-status-ui.json"),
    JSON.stringify(report, null, 2),
  );
  await browser.close();
  console.log(JSON.stringify(report, null, 2));
}
