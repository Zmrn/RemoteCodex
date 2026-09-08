import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { Bridge, ROOT } from "../src/bridge.mjs";
import { startServer } from "../src/server.mjs";
const { chromium } = await import(
  process.env.REMOTE_BRIDGE_PLAYWRIGHT || "playwright-core"
);
const id = "99999999-9999-4999-8999-999999999999";
const dir = fs.mkdtempSync(path.join(ROOT, "test/scratch/pagination-ui-"));
fs.writeFileSync(path.join(dir, "update-settings.json"), '{"automatic":false}');
const bridge = new Bridge(dir);
bridge.connected = true;
bridge.owners = new Map();
let phase = "active",
  callCount = 0,
  failBefore = false;
const image = Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  Buffer.alloc(1000, 1),
]);
let items = Array.from({ length: 165 }, (_, i) => ({
  id: "m" + i,
  type: "agentMessage",
  text: "Message " + i + "\n\n" + ("visible content " + i + " ").repeat(15),
}));
items[50] = {
  id: "m50",
  type: "userMessage",
  content: [
    { type: "text", text: "Image at 50" },
    { type: "image", url: "data:image/png;base64," + image.toString("base64") },
  ],
};
bridge.desktop = {
  identity: { officialPid: 1 },
  catalog: [],
  call: async (method, args) => {
    if (method !== "read_thread")
      throw Error("Unexpected official tool: " + method);
    callCount++;
    return {
      thread: {
        id,
        kind: "codex",
        title: "Pagination fixture",
        status: { type: phase },
      },
      turns: [
        {
          id: "t1",
          startedAt: 1,
          status: phase === "active" ? "inProgress" : "completed",
          items: structuredClone(items),
        },
      ],
      page: { nextCursor: null },
    };
  },
};
bridge.projects = async () => ({ data: { projects: [] } });
bridge.threads = async () => ({
  data: {
    threads: [
      { id, kind: "codex", title: "Pagination fixture", status: "active" },
    ],
  },
});
bridge.models = async () => ({ models: [] });
bridge.connect = async () => {
  bridge.connected = true;
  return bridge.desktop.identity;
};
bridge.usage = async () => ({ status: "available", weekly: [] });
bridge.follow = async () => ({});
bridge.queue.read = () => ({
  confirmed: true,
  revision: "1",
  messages: [],
  recoveries: [],
});
bridge.disconnect = () => {
  bridge.connected = false;
};
const original = bridge.readPage.bind(bridge);
bridge.readPage = async (...args) => {
  if (args[1]) {
    await new Promise((r) => setTimeout(r, 150));
    if (failBefore) throw Error("fixture history failure");
  }
  return original(...args);
};
const instance = await startServer({ port: 0, bridge });
const address = "http://127.0.0.1:" + instance.server.address().port;
const browser = await chromium.launch({
  executablePath:
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  headless: true,
});
const page = await browser.newPage({ viewport: { width: 1300, height: 950 } });
const errors = [],
  requests = [],
  checks = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("request", (r) => {
  if (r.url().includes("/threads/" + id))
    requests.push(new URL(r.url()).search);
});
await page.route("**/api/**", (route) => {
  const r = route.request(),
    p = new URL(r.url()).pathname;
  if (
    r.method() === "POST" &&
    !p.endsWith("/follow") &&
    !p.endsWith("/connect") &&
    !p.endsWith("/activity") &&
    p !== "/api/agents/select"
  )
    return route.abort();
  return route.continue();
});
const messages = () => page.locator("#messages [data-item-id]").count();
const waitIdle = () =>
  page.waitForFunction(() => !document.querySelector("#older").disabled);
const anchor = () =>
  page.locator("#message-scroll").evaluate((scroll) => {
    const top = scroll.getBoundingClientRect().top;
    const item = [...document.querySelectorAll("[data-item-id]")].find(
      (e) => e.getBoundingClientRect().bottom > top + 5,
    );
    return {
      id: item.dataset.itemId,
      offset: item.getBoundingClientRect().top - top,
    };
  });
try {
  await page.goto(address + "/?thread=" + id);
  await page.waitForFunction(() =>
    document.querySelector("#messages").textContent.includes("Message 164"),
  );
  await waitIdle();
  assert.equal(await messages(), 40);
  assert.equal(
    await page
      .locator("#messages")
      .textContent()
      .then((t) => t.includes("Message 0\n")),
    false,
  );
  assert.equal(
    requests.some((q) => q.includes("before=")),
    false,
  );
  checks.push(
    "initial page contains only latest 40 items; no automatic full-history download",
  );
  // Move near the top but keep an explicit anchor before page insertion.
  await page.locator("#message-scroll").evaluate((e) => {
    e.scrollTop = 80;
  });
  const before = await anchor();
  await page.waitForFunction(
    () => document.querySelectorAll("[data-item-id]").length === 80,
  );
  await waitIdle();
  const after = await anchor();
  assert.equal(after.id, before.id);
  assert.ok(Math.abs(after.offset - before.offset) < 3);
  assert.equal(await messages(), 80);
  checks.push(
    "scrolling upward loads one older segment and preserves visible message and offset",
  );
  phase = "idle";
  await page.locator("#refresh").click();
  await waitIdle();
  assert.equal(await messages(), 80);
  assert.ok(
    await page
      .locator("#messages")
      .textContent()
      .then((t) => t.includes("Message 85")),
  );
  checks.push("head refresh preserves older pages and latest state");
  // More than one page arrives while viewer is disconnected; head has no overlap.
  items.push(
    ...Array.from({ length: 90 }, (_, i) => ({
      id: "m" + (165 + i),
      type: "agentMessage",
      text: "Message " + (165 + i),
    })),
  );
  await page.locator("#refresh").click();
  await page.waitForFunction(() =>
    document.querySelector("#messages").textContent.includes("Message 254"),
  );
  await page.waitForFunction(
    () =>
      document.querySelector('[data-item-id="m164"]') &&
      document.querySelector('[data-item-id="m165"]'),
  );
  await new Promise((r) => setTimeout(r, 1200));
  await waitIdle();
  assert.equal(await messages(), 170);
  assert.equal(
    new Set(
      await page
        .locator("[data-item-id]")
        .evaluateAll((es) => es.map((e) => e.dataset.itemId)),
    ).size,
    170,
  );
  checks.push(
    "missed updates spanning multiple pages are backfilled without duplicates or gaps",
  );
  const count = await messages();
  failBefore = true;
  await page.locator("#message-scroll").evaluate((e) => {
    e.scrollTop = 0;
  });
  await page.waitForFunction(() =>
    document
      .querySelector("#error")
      .textContent.includes("fixture history failure"),
  );
  assert.equal(await messages(), count);
  assert.equal(await page.locator("#prompt").isDisabled(), false);
  failBefore = false;
  await page.locator("#older").click();
  await page.waitForFunction(
    (n) => document.querySelectorAll("[data-item-id]").length > n,
    count,
  );
  await waitIdle();
  checks.push(
    "failed older-page request keeps visible content/input; manual retry resumes cursor",
  );
  const beforeRestart = await messages();
  bridge.connected = false;
  bridge.pages.snapshots.clear();
  bridge.emitEvent("connection-interrupted", { reason: "fixture restart" });
  await page.waitForFunction(() =>
    document.querySelector("#connection").textContent.includes("自动重连"),
  );
  await page.waitForFunction(
    () =>
      document.querySelector("#connection").textContent === "已连接官方桌面",
  );
  await waitIdle();
  assert.equal(await messages(), beforeRestart);
  // New cursors may overlap visible history; merge it once, then reach older content.
  for (let i = 0; i < 8 && (await messages()) < items.length; i++) {
    await page.locator("#message-scroll").evaluate((e) => {
      e.scrollTop = 0;
    });
    await page.locator("#older").click();
    await waitIdle();
  }
  assert.equal(await messages(), items.length);
  assert.equal(
    new Set(
      await page
        .locator("[data-item-id]")
        .evaluateAll((es) => es.map((e) => e.dataset.itemId)),
    ).size,
    items.length,
  );
  assert.equal(await page.locator("#error").isVisible(), false);
  checks.push(
    "server restart replaces expired cursors while retaining history; scrolling reaches every original item once",
  );
  // The official read tool remains on t1 while its verified owner has t2.
  bridge.live.set(id, {
    state: {
      id,
      threadRuntimeStatus: { type: "active" },
      turnHistory: {
        history: {
          entitiesByKey: {
            t2: {
              turnId: "t2",
              turnStartedAtMs: 2000,
              status: "inProgress",
              items: [
                {
                  id: "new-owner-user",
                  type: "userMessage",
                  content: [{ type: "text", text: "Continue this same task" }],
                },
                {
                  id: "new-owner-reply",
                  type: "agentMessage",
                  text: "Latest reply from the official owner",
                },
              ],
            },
          },
        },
      },
    },
  });
  bridge.emitEvent("thread-state", {
    threadId: id,
    status: { type: "running", confirmed: true },
  });
  await page.waitForFunction(() =>
    document.querySelector('[data-item-id="new-owner-reply"]'),
  );
  assert.equal(
    await page.locator('[data-item-id="new-owner-user"]').count(),
    1,
  );
  assert.equal(
    await page.locator('[data-item-id="new-owner-reply"]').count(),
    1,
  );
  assert.equal(await messages(), items.length + 2);
  assert.equal(
    await page.locator(".turn").last().getAttribute("data-turn-id"),
    "t2",
  );
  checks.push(
    "owner-only new turn appears through live refresh while older messages remain once, in order",
  );
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    true,
  );
  checks.push("mobile portrait stays within viewport");
  assert.deepEqual(errors, []);
  const result = {
    result: "passed",
    checks,
    errors,
    officialReadCalls: callCount,
    viewRequests: requests.length,
  };
  fs.mkdirSync(path.join(ROOT, "evidence"), { recursive: true });
  fs.writeFileSync(
    path.join(ROOT, "evidence/pagination-ui.json"),
    JSON.stringify(result, null, 2),
  );
  console.log(JSON.stringify(result));
} finally {
  await browser.close();
  instance.server.closeAllConnections();
  await new Promise((r) => instance.server.close(r));
}
