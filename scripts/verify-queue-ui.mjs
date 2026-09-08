// UI interaction tests use isolated responses. Real owner evidence is verify-queue.mjs.
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
const { chromium } = await import(
  process.env.REMOTE_BRIDGE_PLAYWRIGHT || "playwright-core"
);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."),
  base = process.env.REMOTE_BRIDGE_URL || "http://127.0.0.1:43127",
  id = "77777777-7777-4777-8777-777777777777";
const developmentExcluded = process.argv.includes("--development-excluded");
const image =
  "data:image/png;base64," +
  fs
    .readFileSync(path.join(root, "fixtures/vision-probe.png"))
    .toString("base64");
let messages = [
    {
      id: "fixture-image",
      text: "请根据这张图片继续检查界面细节",
      imageDataUrl: image,
      editable: true,
    },
    {
      id: "fixture-text",
      text: "完成当前工作以后，再整理一份简短的测试说明",
      editable: true,
    },
  ],
  recoveries = [],
  rev = 1;
const report = {
    scope: "headless own UI; isolated responses only; no model calls",
    checks: {},
    viewports: [],
  },
  requests = [],
  errors = [],
  events = [];
const browser = await chromium.launch({
  executablePath:
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  headless: true,
});
const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
page.on("pageerror", (e) => errors.push(e.message));
const message = (text, key) => ({ id: key, text, editable: true });
await page.route(base + "/api/**", async (route) => {
  const r = route.request(),
    p = new URL(r.url()).pathname;
  const json = (data, status = 200) =>
    route.fulfill({
      status,
      contentType: "application/json",
      body: JSON.stringify(data),
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
    return json({
      connected: true,
      existingCodexWritable: true,
      readOnlyThreadIds: [],
      testExcludedThreadIds: developmentExcluded ? [id] : [],
      testThreads: developmentExcluded
        ? {}
        : { [id]: { title: "排队功能预览" } },
    });
  if (p.endsWith("/usage")) return json({ status: "unknown", weekly: [] });
  if (p.endsWith("/projects")) return json({ data: { projects: [] } });
  if (p.endsWith("/threads") && r.method() === "GET")
    return json({
      data: {
        threads: [
          { id, title: "排队功能预览", kind: "codex", status: "active" },
        ],
        pinnedThreads: [],
      },
    });
  if (p.endsWith("/threads/" + id))
    return json({
      data: {
        thread: {
          id,
          title: "排队功能预览",
          kind: "codex",
          status: { type: "active" },
          cwd: "C:/Fixture",
        },
        turns: [
          {
            id: "existing-turn",
            status: "inProgress",
            items: [
              {
                id: "instruction",
                type: "userMessage",
                content: [
                  {
                    type: "text",
                    text: "请检查这个界面的布局，完成后说明测试结果。",
                  },
                ],
              },
              {
                id: "reply",
                type: "agentMessage",
                text: "正在检查界面和交互。你可以继续发送后续要求，或调整当前任务的方向。",
              },
            ],
          },
        ],
      },
    });
  if (p.endsWith("/follow")) return json({});
  if (p.endsWith("/events")) {
    await new Promise((resolve) => events.push(resolve));
    return route.abort().catch(() => {});
  }
  if (p.endsWith("/queue")) {
    if (r.method() === "GET")
      return json({
        revision: String(rev),
        confirmed: true,
        messages,
        recoveries,
      });
    const b = r.postDataJSON();
    requests.push(b);
    let result = {};
    if (b.action === "ack-recovery") {
      recoveries = [];
      return json({ status: "accepted", result: {} });
    }
    assert.equal(b.revision, String(rev));
    rev++;
    if (b.action === "enqueue") {
      messages.push({
        ...message(b.prompt, b.requestId),
        imageDataUrl: b.imageDataUrl,
      });
      if (b.recoveryId) recoveries = [];
      result = { disposition: "queued", messageId: b.requestId };
    } else {
      const m = messages.find((m) => m.id === b.messageId);
      assert.ok(m);
      messages = messages.filter((m) => m.id !== b.messageId);
      if (b.action === "take") {
        result = { disposition: "draft", draft: m, recoveryId: b.requestId };
        recoveries = [{ draft: m, recoveryId: b.requestId, state: "draft" }];
      } else
        result = {
          disposition: b.action === "steer" ? "steered" : "removed",
          turnId: "existing-turn",
        };
    }
    return json({ status: "accepted", result });
  }
  throw Error("Unexpected API route: " + r.method() + " " + p);
});
try {
  await page.goto(base + "/?thread=" + id);
  await page.waitForSelector('[data-message-id="fixture-image"]');
  await page.locator("#prompt").fill("运行中发送的补充要求");
  assert.equal(await page.locator("#send").isDisabled(), false);
  assert.equal(await page.locator("#send").isVisible(), true);
  await page.locator("#prompt").press("Enter");
  await page.waitForFunction(
    () => document.querySelectorAll(".queued-message").length === 3,
  );
  assert.equal(await page.locator("#prompt").inputValue(), "");
  report.checks.runningEnterQueuesWithoutStartingAnotherTask = true;
  const row = page.locator('[data-message-id="fixture-image"]');
  await row.locator("summary").click();
  await row.locator(".queue-edit").click();
  await page.waitForFunction(
    () => document.querySelector("#image").files.length === 1,
  );
  assert.equal(
    await page.locator("#prompt").inputValue(),
    "请根据这张图片继续检查界面细节",
  );
  assert.equal(await row.count(), 0);
  report.checks.editWithdrawsAndRestoresImage = true;
  await page.locator("#prompt").fill("编辑后的图片要求");
  await page.locator("#prompt").press("Enter");
  await page.waitForFunction(
    () =>
      document.querySelectorAll(".queued-message").length === 3 &&
      document.querySelector("#prompt").value === "",
  );
  const posted = requests.find((r) => r.prompt === "编辑后的图片要求");
  assert.equal(posted.imageDataUrl, image);
  assert.ok(posted.recoveryId);
  assert.equal(recoveries.length, 0);
  report.checks.editedResubmitPreservesOriginalImage = true;
  await page.locator('[data-message-id="fixture-text"] .queue-steer').click();
  await page.waitForFunction(
    () => !document.querySelector('[data-message-id="fixture-text"]'),
  );
  assert.ok(requests.some((r) => r.action === "steer"));
  report.checks.steerButtonDispatchesExplicitly = true;
  if (developmentExcluded)
    report.checks.testExclusionDoesNotDisableUserSendEditOrSteer = true;
  for (const [width, height] of [
    [1440, 960],
    [390, 844],
    [320, 568],
    [844, 390],
  ]) {
    await page.setViewportSize({ width, height });
    const geometry = await page.evaluate(() => ({
      overflow: document.documentElement.scrollWidth > innerWidth,
      queue: document
        .querySelector("#message-queue")
        .getBoundingClientRect()
        .toJSON(),
      composer: document
        .querySelector("#form")
        .getBoundingClientRect()
        .toJSON(),
    }));
    assert.equal(geometry.overflow, false);
    assert.ok(geometry.composer.bottom <= height);
    assert.ok(geometry.queue.y >= 0);
    await page.locator(".queued-message").first().locator("summary").click();
    const edit = await page
      .locator(".queue-more[open] .queue-edit")
      .boundingBox();
    assert.ok(
      edit.x >= 0 && edit.x + edit.width <= width,
      JSON.stringify({
        width,
        edit,
        style: await page
          .locator(".queue-more[open] .queue-edit")
          .getAttribute("style"),
      }),
    );
    if ([1440, 390].includes(width))
      await page.screenshot({
        path: path.join(
          root,
          `evidence/ui-${developmentExcluded ? "v6.5" : "v6"}-queue-${width}.png`,
        ),
      });
    await page.keyboard.press("Escape");
    report.viewports.push({
      width,
      height,
      noOverflow: true,
      composerVisible: true,
      editMenuVisible: true,
    });
  }
  report.checks.responsiveQueue = true;
  assert.deepEqual(errors, []);
  report.status = "passed";
} catch (e) {
  report.status = "failed";
  report.failure = e.message;
  throw e;
} finally {
  events.forEach((r) => r());
  report.errors = errors;
  report.observedAt = new Date().toISOString();
  fs.writeFileSync(
    path.join(
      root,
      `evidence/ui-${developmentExcluded ? "v6.5" : "v6"}-queue-ui.json`,
    ),
    JSON.stringify(report, null, 2),
  );
  await browser.close();
  console.log(JSON.stringify(report, null, 2));
}
