// Isolated responses exercise selection and writes without touching official tasks.
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
const { chromium } = await import(
  process.env.REMOTE_BRIDGE_PLAYWRIGHT || "playwright-core"
);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const base = "http://127.0.0.1:43127",
  id = "77777777-7777-4777-8777-777777777777",
  unloaded = "88888888-8888-4888-8888-888888888888";
const models = [
  "gpt-6-astra",
  "gpt-5.6-sol",
  "gpt-5.6-terra",
  "gpt-5.6-luna",
  "gpt-5.5",
  "gpt-5.4-mini",
  "gpt-5.3-codex-spark",
].map((id) => ({
  id,
  description: "Fixture model",
  efforts:
    id === "gpt-5.3-codex-spark"
      ? ["low", "medium", "high", "xhigh"]
      : ["low", "medium", "high", "xhigh", "max", "ultra"],
}));
let current = {
    model: "gpt-6-astra",
    effort: "xhigh",
    permissions: ":workspace",
  },
  modelGate,
  settingsGate;
const requests = [],
  events = [];
const report = {
  scope:
    "own UI with isolated API fixtures; zero official model calls/settings writes",
  checks: {},
  viewports: [],
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
  const json = (value, status = 200) =>
    route.fulfill({
      status,
      contentType: "application/json",
      body: JSON.stringify(value),
    });
  if (p === "/api/agents")
    return json({
      selectedId: "local",
      agents: [
        { id: "local", name: "UI 测试设备", kind: "local", host: "fixture" },
      ],
    });
  if (p === "/api/agents/select") return json({});
  if (p.endsWith("/status"))
    return json({ connected: true, existingCodexWritable: true });
  if (p.endsWith("/projects")) return json({ data: { projects: [] } });
  if (p.endsWith("/usage")) return json({ status: "unknown", weekly: [] });
  if (p.endsWith("/models")) {
    if (modelGate) {
      const gate = modelGate;
      modelGate = null;
      gate.started();
      await gate.wait;
    }
    return json({ models });
  }
  if (p.endsWith("/events")) {
    await new Promise((resolve) => events.push(resolve));
    return route.abort().catch(() => {});
  }
  if (p.endsWith("/follow")) return json({});
  if (p.endsWith("/queue"))
    return json({
      confirmed: true,
      messages: [],
      recoveries: [],
      revision: "fixture",
    });
  if (p.endsWith("/settings")) {
    const body = r.postDataJSON();
    requests.push({ route: p, ...body });
    if (settingsGate) {
      const gate = settingsGate;
      settingsGate = null;
      gate.started();
      await gate.wait;
    }
    const { permissionMode, ...model } = body.settings;
    current = {
      ...current,
      ...model,
      ...(permissionMode
        ? {
            permissions: {
              "read-only": ":read-only",
              workspace: ":workspace",
              full: ":danger-full-access",
            }[permissionMode],
          }
        : {}),
    };
    return json({ status: "accepted", result: { threadId: id } });
  }
  if (p.endsWith("/threads")) {
    if (r.method() === "POST") {
      requests.push({ route: p, ...r.postDataJSON() });
      return json({ status: "accepted", result: { threadId: id } });
    }
    return json({
      data: {
        threads: [
          { id, kind: "codex", title: "设置下拉菜单测试", status: "idle" },
          {
            id: unloaded,
            kind: "codex",
            title: "未加载的测试会话",
            status: "notLoaded",
          },
        ],
      },
    });
  }
  const match = /\/threads\/([\w-]+)$/.exec(p);
  if (match)
    return json({
      source: "isolated fixture",
      data: {
        thread: {
          id: match[1],
          kind: "codex",
          title: match[1] === id ? "设置下拉菜单测试" : "未加载的测试会话",
          cwd: "C:/Fixture",
          status: { type: match[1] === id ? "idle" : "notLoaded" },
        },
        turns: [],
      },
      live:
        match[1] === id
          ? {
              status: { type: "completed", confirmed: true },
              state: { latestThreadSettings: current },
            }
          : null,
    });
  throw Error("Unexpected API route " + p);
});
const menu = page.locator("#settings-menu");
async function open(kind) {
  await page
    .locator(
      `#${kind === "permission" ? "permission" : kind === "effort" ? "effort" : "model"}-display`,
    )
    .click();
  await page.waitForFunction((kind) => {
    const menu = document.querySelector("#settings-menu");
    return (
      menu.matches(":popover-open") &&
      menu.dataset.kind === kind &&
      menu.querySelector("button:not(:disabled)")
    );
  }, kind);
  assert.equal(await page.locator("dialog[open]").count(), 0);
}
async function closed() {
  await page.waitForFunction(
    () => !document.querySelector("#settings-menu").matches(":popover-open"),
  );
}
async function displayed(text) {
  await page.waitForFunction(
    (text) =>
      document.querySelector("#model-display").textContent.includes(text),
    text,
  );
}
async function selectTask(task) {
  if (
    await page
      .locator("body")
      .evaluate((el) => el.classList.contains("mobile-layout"))
  )
    await page.locator("#mobile-menu").click();
  await page.locator(`.thread-card[data-thread-id="${task}"]`).click();
  await page.waitForFunction(() =>
    document.querySelector("#metadata").textContent.includes("读取时间:"),
  );
}
function gate() {
  let release, started;
  const begun = new Promise((r) => (started = r));
  return {
    started,
    wait: new Promise((r) => (release = r)),
    begun,
    release: () => release(),
  };
}
try {
  await page.goto(base + "/?ui=0.6.2");
  await page.waitForFunction(() => !document.querySelector("#prompt").disabled);
  await page.locator("#prompt").fill("保留这条未发送的草稿");
  await open("model");
  assert.equal(await menu.locator('[role="menuitemradio"]').count(), 8);
  assert.equal(
    await menu.locator('[data-value=""]').getAttribute("aria-checked"),
    "true",
  );
  await menu.locator('[data-value="gpt-5.6-sol"]').click();
  await closed();
  await displayed("GPT-5.6 Sol");
  assert.equal(
    await page.locator("#prompt").inputValue(),
    "保留这条未发送的草稿",
  );
  await open("effort");
  await menu.getByRole("button", { name: "设为高", exact: true }).click();
  await page.waitForFunction(() =>
    document.querySelector("#effort-display").textContent.includes("高"),
  );
  assert.equal(requests.length, 0);
  await page.keyboard.press("Escape");
  await closed();
  assert.equal(
    await page.evaluate(() => document.activeElement.id),
    "effort-display",
  );
  await page.locator("#prompt").press("Enter");
  await displayed("GPT-6 Astra");
  assert.deepEqual(requests[0].settings, {
    model: "gpt-5.6-sol",
    effort: "high",
  });
  report.checks.newTaskPreselectionPreservesDraftAndSendSettings = true;
  await open("model");
  assert.equal(
    await menu
      .locator('[data-value="gpt-6-astra"]')
      .getAttribute("aria-checked"),
    "true",
  );
  await menu.locator('[data-value="gpt-5.6-luna"]').click();
  await closed();
  await displayed("GPT-5.6 Luna");
  assert.deepEqual(requests.at(-1).settings, {
    model: "gpt-5.6-luna",
    effort: "xhigh",
  });
  assert.ok(requests.at(-1).route.includes(id));
  report.checks.loadedSelectionUsesSameTaskSettingsEndpoint = true;
  await open("effort");
  await page.locator("#effort-slider").press("ArrowLeft");
  await page.waitForFunction(
    () => document.querySelector("#effort-display").textContent.trim() === "高",
  );
  assert.equal(current.effort, "high");
  await menu.getByRole("button", { name: "恢复打开菜单时的强度" }).click();
  await page.waitForFunction(
    () =>
      document.querySelector("#effort-display").textContent.trim() === "极高",
  );
  assert.equal(current.effort, "xhigh");
  report.checks.supportedEffortSliderAndRestore = true;
  await page.keyboard.press("Escape");
  await open("permission");
  await menu.locator('[data-value="read-only"]').click();
  await closed();
  assert.deepEqual(requests.at(-1).settings, { permissionMode: "read-only" });
  assert.equal(current.permissions, ":read-only");
  report.checks.permissionMenuUsesRealProfiles = true;
  await open("model");
  await page.locator("#prompt").click();
  await closed();
  await open("model");
  await page.keyboard.press("Home");
  assert.equal(
    await page.evaluate(() => document.activeElement.dataset.value),
    "",
  );
  await page.keyboard.press("End");
  assert.equal(
    await page.evaluate(() => document.activeElement.dataset.value),
    "gpt-5.3-codex-spark",
  );
  await page.keyboard.press("Escape");
  await closed();
  report.checks.outsideClickEscapeAndKeyboard = true;
  await open("model");
  await page.locator("#model-display").click();
  await closed();
  report.checks.triggerClickTogglesMenu = true;
  for (const [width, height] of [
    [1440, 960],
    [390, 844],
    [320, 568],
    [844, 390],
  ]) {
    await page.setViewportSize({ width, height });
    for (const kind of ["model", "effort", "permission"]) {
      await open(kind);
      const box = await menu.boundingBox();
      assert.ok(
        box.x >= 0 &&
          box.y >= 0 &&
          box.x + box.width <= width &&
          box.y + box.height <= height,
        JSON.stringify({ kind, width, height, box }),
      );
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth > innerWidth,
        ),
        false,
      );
      if ([1440, 390].includes(width))
        await page.screenshot({
          path: path.join(root, `evidence/ui-v6.2-${kind}-${width}.png`),
        });
      await page.keyboard.press("Escape");
    }
    report.viewports.push({ width, height, menusWithinViewport: true });
  }
  report.checks.responsiveThreeMenus = true;
  await page.setViewportSize({ width: 1440, height: 960 });
  await selectTask(unloaded);
  await page.waitForFunction(() =>
    document.querySelector("#model-display").textContent.includes("默认"),
  );
  await page.locator("#permission-display").click();
  await menu.locator('[data-value="full"]').waitFor();
  assert.ok(await menu.locator('[data-value="full"]').isDisabled());
  assert.equal(await menu.locator("button:not(:disabled)").count(), 0);
  await page.keyboard.press("Escape");
  report.checks.unloadedPermissionsRemainUnavailable = true;
  const delayed = gate();
  modelGate = delayed;
  await page.locator("#model-display").click();
  await delayed.begun;
  await page.locator("#create").click();
  delayed.release();
  await closed();
  await page.waitForTimeout(100);
  assert.equal(
    await page.locator("#model-display").textContent(),
    "桌面默认模型",
  );
  report.checks.staleCatalogCannotReopenForAnotherTask = true;
  await selectTask(id);
  await displayed("GPT-5.6 Luna");
  const pending = gate();
  settingsGate = pending;
  await open("model");
  await menu.locator('[data-value="gpt-5.6-sol"]').click();
  await pending.begun;
  assert.ok(await page.locator("#prompt").isDisabled());
  await page.locator("#create").click();
  await open("model");
  pending.release();
  await page.waitForTimeout(150);
  assert.ok(await menu.evaluate((el) => el.matches(":popover-open")));
  assert.equal(
    await page.locator("#model-display").textContent(),
    "桌面默认模型",
  );
  assert.equal(
    requests.at(-1).route,
    `/api/agents/local/bridge/threads/${id}/settings`,
  );
  report.checks.pendingWriteStaysOnOriginalTaskAndPreservesNewMenu = true;
  await page.keyboard.press("Escape");
  await selectTask(id);
  await displayed("GPT-5.6 Sol");
  await open("effort");
  await menu.getByRole("button", { name: "设为超高", exact: true }).click();
  await page.waitForFunction(
    () =>
      document.querySelector("#effort-display").textContent.trim() === "超高",
  );
  await page.keyboard.press("Escape");
  await open("model");
  await menu.locator('[data-value="gpt-5.3-codex-spark"]').click();
  await closed();
  assert.deepEqual(requests.at(-1).settings, {
    model: "gpt-5.3-codex-spark",
    effort: "medium",
  });
  report.checks.modelSwitchNeverCarriesUnsupportedEffort = true;
  assert.deepEqual(report.errors, []);
  report.status = "passed";
} catch (e) {
  report.status = "failed";
  report.failure = e.message;
  throw e;
} finally {
  events.forEach((r) => r());
  report.observedAt = new Date().toISOString();
  fs.writeFileSync(
    path.join(root, "evidence/ui-v6.2-settings-ui.json"),
    JSON.stringify(report, null, 2),
  );
  await browser.close();
  console.log(JSON.stringify(report, null, 2));
}
