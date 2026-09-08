// Real UI, isolated HTTP fixtures. No official task messages or settings.
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { ROOT } from "../src/bridge.mjs";
import { startServer } from "../src/server.mjs";
const { chromium } = await import(
  process.env.REMOTE_BRIDGE_PLAYWRIGHT || "playwright-core"
);
const dir = fs.mkdtempSync(path.join(ROOT, "work/theme-composer-"));
fs.writeFileSync(path.join(dir, "update-settings.json"), '{"automatic":false}');
const { server, address } = await startServer({
  port: 0,
  bridge: { dataDir: dir, on() {}, off() {}, connect: async () => {} },
});
const browser = await chromium.launch({
  executablePath:
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  headless: true,
});
const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
const ids = [
  "77777777-7777-4777-8777-777777777777",
  "88888888-8888-4888-8888-888888888888",
];
const long = Array.from(
  { length: 18 },
  (_, i) => `${i + 1}. 这是一段用于验证输入框自动增高和发送后回缩的较长文字。`,
).join("\n");
const errors = [],
  events = [],
  writes = [],
  checks = [];
let failSend = false,
  queue = [],
  revision = 1;
page.on("pageerror", (e) => errors.push(e.message));
await page.route(address + "/api/**", async (route) => {
  const req = route.request(),
    p = new URL(req.url()).pathname;
  const json = (data, status = 200) =>
    route.fulfill({
      status,
      contentType: "application/json",
      body: JSON.stringify(data),
    });
  if (p === "/api/agents")
    return json({
      selectedId: "local",
      agents: [{ id: "local", name: "这台电脑", kind: "local" }],
    });
  if (p.endsWith("/status") || p.endsWith("/connect"))
    return json({ connected: true, existingCodexWritable: true });
  if (p.endsWith("/usage"))
    return json({
      status: "available",
      weekly: [{ label: "Codex", limitId: "codex", remainingPercent: 68 }],
    });
  if (p.endsWith("/models"))
    return json({
      models: [
        {
          id: "gpt-6-astra",
          efforts: ["low", "medium", "high"],
          serviceTiers: [{ id: "priority", name: "Fast" }],
        },
      ],
    });
  if (p.endsWith("/updates"))
    return json({
      supported: false,
      automatic: false,
      currentVersion: "fixture",
      phase: "idle",
    });
  if (p === "/api/local-access")
    return json({
      addresses: ["100.70.8.9"],
      host: "100.70.8.9",
      port: 43128,
      enabled: false,
      listening: null,
    });
  if (p.endsWith("/events")) {
    await new Promise((r) => events.push(r));
    return route.abort().catch(() => {});
  }
  if (p.endsWith("/projects")) return json({ data: { projects: [] } });
  if (p.endsWith("/queue")) {
    if (req.method() === "POST") {
      const body = req.postDataJSON();
      writes.push(body);
      revision++;
      if (body.action === "enqueue")
        queue.push({ id: body.requestId, text: body.prompt, editable: true });
      if (body.action === "take") {
        const draft = queue.find((m) => m.id === body.messageId);
        queue = [];
        return json({
          status: "accepted",
          result: {
            disposition: "draft",
            draft,
            recoveryId: "fixture-recovery",
          },
        });
      }
      return json({ status: "accepted", result: {} });
    }
    return json({
      confirmed: true,
      revision: String(revision),
      messages: queue,
      recoveries: [],
    });
  }
  if (
    p.endsWith("/messages") ||
    (p.endsWith("/threads") && req.method() === "POST")
  ) {
    writes.push(req.postDataJSON());
    return failSend
      ? json({ error: "测试：提交结果未知" }, 502)
      : json({ status: "accepted", result: { threadId: ids[0] } });
  }
  if (p.endsWith("/threads"))
    return json({
      data: {
        threads: ids.map((id, i) => ({
          id,
          kind: "codex",
          title: i ? "运行中的演示任务" : "RemoteCodex 深色主题",
          status: i ? "active" : "idle",
        })),
      },
    });
  const id = ids.find((id) => p.endsWith("/threads/" + id));
  if (id)
    return json({
      data: {
        thread: {
          id,
          kind: "codex",
          title: id === ids[0] ? "RemoteCodex 深色主题" : "运行中的演示任务",
          status: { type: id === ids[0] ? "idle" : "active" },
        },
        turns: [
          {
            id: "fixture-turn",
            status: id === ids[0] ? "completed" : "inProgress",
            items: [
              {
                id: "user",
                type: "userMessage",
                content: [
                  {
                    type: "text",
                    text: "深色主题应该清晰，也要与官方窗口容易区分。",
                  },
                ],
              },
              {
                id: "reply",
                type: "agentMessage",
                text: "已切换为深蓝灰色主题。\n\n- 侧栏、菜单和设备设置保持一致。\n- 长消息发送成功后，输入框恢复初始高度。\n\n```js\nconst connected = true;\n```\n[查看使用说明](https://example.com)",
              },
            ],
          },
        ],
      },
      live: {
        status: {
          type: id === ids[0] ? "completed" : "running",
          confirmed: true,
        },
        state: {
          latestThreadSettings: {
            model: "gpt-6-astra",
            effort: "medium",
            permissions: ":workspace",
          },
        },
      },
    });
  return json({});
});
const height = () =>
  page.locator("#prompt").evaluate((el) => el.getBoundingClientRect().height);
async function select(id) {
  await page.waitForFunction(
    () =>
      document.body.classList.contains("mobile-layout") ===
      matchMedia(
        "(max-width:819px) and (orientation:portrait), (max-width:599px), (max-width:819px) and (min-height:501px)",
      ).matches,
  );
  if (
    await page
      .locator("body")
      .evaluate((el) => el.classList.contains("mobile-layout"))
  )
    await page.locator("#mobile-menu").click();
  await page.locator(`[data-thread-id="${id}"]`).click();
  await page.waitForFunction(() =>
    document.querySelector("#metadata").textContent.includes("读取时间:"),
  );
  await page.locator("#prompt:not(:disabled)").waitFor();
}
async function assertDark(selector) {
  const colors = await page.locator(selector).evaluate((el) => {
    const s = getComputedStyle(el);
    return { background: s.backgroundColor, color: s.color };
  });
  const rgb = (s) =>
    s
      .match(/[\d.]+/g)
      .slice(0, 3)
      .map(Number);
  assert.ok(
    Math.max(...rgb(colors.background)) < 90,
    `${selector} should be dark: ${JSON.stringify(colors)}`,
  );
  assert.ok(
    Math.min(...rgb(colors.color)) > 100,
    `${selector} text should remain readable`,
  );
}
try {
  await page.goto(address + "/?thread=" + ids[0]);
  await page.waitForFunction(() =>
    document.querySelector("#metadata").textContent.includes("读取时间:"),
  );
  for (const viewport of [
    { width: 1440, height: 960 },
    { width: 390, height: 844 },
    { width: 844, height: 390 },
  ]) {
    await page.setViewportSize(viewport);
    await select(ids[0]);
    const baseline = await height();
    await page.locator("#prompt").fill(long);
    assert.ok((await height()) > baseline + 20);
    await page.locator("#send").click();
    await page.waitForFunction(
      () =>
        document.querySelector("#prompt").value === "" &&
        !document.querySelector("#prompt").disabled,
    );
    assert.ok(
      Math.abs((await height()) - baseline) < 1,
      "accepted send must shrink",
    );
    failSend = true;
    await page.locator("#prompt").fill(long);
    await page.locator("#send").click();
    await page.waitForFunction(() =>
      document
        .querySelector("#error")
        .textContent.includes("测试：提交结果未知"),
    );
    assert.equal(await page.locator("#prompt").inputValue(), long);
    assert.ok((await height()) > baseline + 20);
    failSend = false;
    await select(ids[1]);
    assert.ok(
      Math.abs((await height()) - baseline) < 1,
      "empty task must not keep another task's height",
    );
    await select(ids[0]);
    assert.equal(await page.locator("#prompt").inputValue(), long);
    assert.ok((await height()) > baseline + 20);
    await page.locator("#prompt").fill("");
    await select(ids[1]);
    await page.locator("#prompt").fill(long);
    await page.locator("#send").click();
    await page.waitForFunction(
      () =>
        document.querySelector("#prompt").value === "" &&
        !document.querySelector("#prompt").disabled,
    );
    assert.ok(Math.abs((await height()) - baseline) < 1, "enqueue must shrink");
    await page.locator(".queue-more summary").click();
    await page.locator(".queue-edit").click();
    await page.waitForFunction(
      () =>
        document.querySelector("#prompt").value.length > 100 &&
        !document.querySelector("#prompt").disabled,
    );
    assert.equal(await page.locator("#prompt").inputValue(), long);
    assert.ok((await height()) > baseline + 20, "taken draft must expand");
    await page.locator("#prompt").fill("");
    assert.ok(Math.abs((await height()) - baseline) < 1);
    checks.push({
      viewport,
      baseline,
      acceptedSend: true,
      uncertainSendPreserved: true,
      queueAndTakenDraft: true,
      taskSwitch: true,
    });
  }
  await page.setViewportSize({ width: 1440, height: 960 });
  await select(ids[0]);
  await page.locator("#create").click();
  const freshBaseline = await height();
  await page.locator("#prompt").fill(long + "\n新会话验证");
  await page.locator("#send").click();
  await page.waitForFunction(
    () =>
      document.querySelector("#prompt").value === "" &&
      !document.querySelector("#prompt").disabled,
  );
  assert.ok(
    Math.abs((await height()) - freshBaseline) < 1,
    "new task send must shrink",
  );
  checks.push({ newTaskSend: true });
  await assertDark(".conversation");
  await assertDark(".composer");
  await page.screenshot({
    path: path.join(ROOT, "evidence/dark-theme-desktop.png"),
  });
  await page.locator("#effort-display").click();
  await page.locator("#effort-slider").waitFor();
  await assertDark("#settings-menu");
  await page.screenshot({
    path: path.join(ROOT, "evidence/dark-theme-menu.png"),
  });
  await page.keyboard.press("Escape");
  await page.locator("#footer-agent").click();
  await assertDark("#agent-menu");
  await page.locator("#edit-agent").click();
  await page.waitForFunction(
    () => document.querySelector("#local-host").options.length > 0,
  );
  await assertDark("#agent-dialog");
  await assertDark("#agent-name");
  await page
    .locator("#agent-dialog")
    .screenshot({ path: path.join(ROOT, "evidence/dark-theme-device.png") });
  await page.locator("#agent-dialog .close-dialog").first().click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: path.join(ROOT, "evidence/dark-theme-mobile.png"),
  });
  assert.deepEqual(errors, []);
  const report = {
    result: "passed",
    source: "isolated UI fixtures; zero official task writes",
    checks,
    theme: [
      "desktop",
      "mobile",
      "landscape",
      "model-menu",
      "device-dialog",
      "form-controls",
    ],
    errors,
  };
  fs.writeFileSync(
    path.join(ROOT, "evidence/theme-composer-ui.json"),
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report));
} finally {
  for (const release of events) release();
  await browser.close();
  server.closeAllConnections();
  await new Promise((r) => server.close(r));
}
