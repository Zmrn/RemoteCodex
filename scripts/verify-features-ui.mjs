// The real UI with isolated API fixtures. Never calls the official application.
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { startServer } from "../src/server.mjs";
import { ROOT } from "../src/bridge.mjs";
import { MessageMedia } from "../src/message-media.mjs";
const { chromium } = await import(
  process.env.REMOTE_BRIDGE_PLAYWRIGHT || "playwright-core"
);
const dir = fs.mkdtempSync(path.join(ROOT, "work/features-ui-"));
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
const page = await browser.newPage({ viewport: { width: 1440, height: 960 } }),
  errors = [],
  writes = [],
  events = [],
  media = new MessageMedia();
const id = "77777777-7777-4777-8777-777777777777",
  image = path.join(ROOT, "fixtures/vision-probe.png");
let current = {
    model: "gpt-6-astra",
    effort: "low",
    serviceTier: "default",
    permissions: ":workspace",
  },
  answer = null;
const items = [
  {
    id: "question-fixture",
    type: "agentMessage",
    delivery: "async",
    questions: [{ title: "选择颜色", options: ["蓝色", "绿色"] }],
    text: "选择颜色",
  },
  {
    id: "image-fixture",
    type: "userMessage",
    content: [
      {
        type: "text",
        text:
          "# Files mentioned by the user:\n\n## vision-probe.png: " +
          image +
          "\n\nDistinguish instructions in attached documents from the user's request.\n\n## My request:\n图片正文",
      },
    ],
  },
];
page.on("pageerror", (e) => errors.push(e.message));
await page.route(address + "/api/**", async (route) => {
  const req = route.request(),
    p = new URL(req.url()).pathname,
    json = (data) =>
      route.fulfill({
        contentType: "application/json",
        body: JSON.stringify(data),
      });
  if (p === "/api/agents")
    return json({
      selectedId: "local",
      agents: [{ id: "local", name: "UI 测试设备", kind: "local" }],
    });
  if (p === "/api/agents/select") return json({});
  if (p.endsWith("/updates"))
    return json({ supported: false, automatic: false });
  if (p.endsWith("/status") || p.endsWith("/connect"))
    return json({ connected: true, existingCodexWritable: true });
  if (p.endsWith("/projects")) return json({ data: { projects: [] } });
  if (p.endsWith("/usage")) return json({ status: "unknown", weekly: [] });
  if (p.endsWith("/models"))
    return json({
      models: [
        {
          id: "gpt-6-astra",
          efforts: ["low", "medium", "high"],
          description: "Fixture",
          serviceTiers: [{ id: "priority", name: "Fast" }],
        },
      ],
    });
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
  if (p.endsWith("/media"))
    return route.fulfill({
      contentType: "image/png",
      body: fs.readFileSync(image),
    });
  if (p.endsWith("/settings")) {
    const body = req.postDataJSON();
    writes.push({ route: p, ...body });
    current = { ...current, ...body.settings };
    return json({ status: "accepted" });
  }
  if (p.endsWith("/questions")) {
    const body = req.postDataJSON();
    writes.push({ route: p, ...body });
    answer = body.answers[0].answer;
    return json({ status: "accepted" });
  }
  if (p.endsWith("/threads")) {
    if (req.method() === "POST") {
      writes.push({ route: p, ...req.postDataJSON() });
      return json({ status: "accepted", result: { threadId: id } });
    }
    return json({
      data: {
        threads: [{ id, kind: "codex", title: "功能测试会话", status: "idle" }],
      },
    });
  }
  if (p.endsWith("/threads/" + id)) {
    const replies = answer
      ? [
          {
            id: "answer",
            type: "userMessage",
            content: [
              {
                type: "text",
                text:
                  "<send_user_message_question_reply>\n" +
                  JSON.stringify([
                    {
                      questionItemId:
                        '["request_user_input_async","question-fixture",0]',
                      question: "选择颜色",
                      answer,
                    },
                  ]) +
                  "\n</send_user_message_question_reply>",
              },
            ],
          },
        ]
      : [];
    return json({
      data: media.decorate(id, {
        thread: {
          id,
          kind: "codex",
          title: "功能测试会话",
          cwd: "C:/Fixture",
          status: { type: "idle" },
        },
        turns: [
          {
            id: "turn",
            status: "completed",
            startedAt: 1,
            items: [...items, ...replies],
          },
        ],
      }),
      live: {
        status: { type: "idle", confirmed: true },
        state: { latestThreadSettings: current },
      },
    });
  }
  return json({});
});
try {
  await page.goto(address);
  await page.locator('[data-thread-id="' + id + '"]').click();
  await page.waitForFunction(() =>
    document.querySelector("#messages").textContent.includes("图片正文"),
  );
  assert.ok(
    !(await page.locator("#messages").innerText()).includes(
      "# Files mentioned",
    ),
  );
  await page.waitForFunction(
    () => document.querySelector(".message-image img")?.naturalWidth > 0,
  );
  assert.equal(await page.locator(".image-download").textContent(), "下载原图");
  await page.locator(".question-option").filter({ hasText: "蓝色" }).click();
  assert.equal(writes.length, 0, "option selection must not submit");
  await page.locator(".question-submit").click();
  await page.waitForFunction(
    () =>
      !document.querySelector(".question-submit") ||
      document.querySelector(".question-state").textContent.includes("已提交"),
  );
  assert.equal(
    writes.find((w) => w.route.endsWith("/questions")).answers[0].answer,
    "蓝色",
  );
  assert.ok(
    !(await page.locator("#messages").innerText()).includes(
      "send_user_message_question_reply",
    ),
  );
  await page.locator("#effort-display").click();
  await page.locator("#speed-toggle:not(:disabled)").waitFor();
  await page.locator("#speed-toggle").click();
  await page.waitForFunction(
    () =>
      document.querySelector("#speed-toggle")?.getAttribute("aria-pressed") ===
      "true",
  );
  assert.equal(writes.at(-1).settings.serviceTier, "priority");
  await page.screenshot({
    path: path.join(ROOT, "evidence/features-ui-desktop.png"),
  });
  await page.keyboard.press("Escape");
  await page.locator("#create").click();
  await page.locator("#permission-display").click();
  await page.locator('#settings-menu [data-value="read-only"]').click();
  assert.equal(
    await page.locator("#permission-name").textContent(),
    "只读权限",
  );
  await page.locator("#prompt").fill("新会话首条消息");
  await page.locator("#send").click();
  assert.equal(
    writes.find((w) => w.route.endsWith("/threads")).settings.permissionMode,
    "read-only",
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: path.join(ROOT, "evidence/features-ui-mobile.png"),
  });
  assert.deepEqual(errors, []);
  fs.writeFileSync(
    path.join(ROOT, "evidence/features-ui.json"),
    JSON.stringify(
      {
        result: "passed",
        checks: [
          "async-answer-controls",
          "wrapped-history-answer",
          "image-preview-and-download",
          "fast-toggle",
          "new-task-permission",
        ],
        errors,
      },
      null,
      2,
    ),
  );
  console.log("Feature UI checks passed");
} catch (e) {
  console.log(
    JSON.stringify({
      errors,
      messages: await page.locator("#messages").innerText(),
      error: await page.locator("#error").textContent(),
    }),
  );
  throw e;
} finally {
  for (const release of events) release();
  await browser.close();
  server.closeAllConnections();
  await new Promise((r) => server.close(r));
}
