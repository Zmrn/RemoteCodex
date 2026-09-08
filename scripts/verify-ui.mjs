// Operates only this prototype UI. --write creates a dedicated official Probe.
if (!process.argv.includes("--write") && !process.argv.includes("--resume"))
  throw Error(
    "Use --write (new model task) or --resume (existing evidence; no model sends).",
  );
const { chromium } = await import(
  process.env.REMOTE_BRIDGE_PLAYWRIGHT || "playwright-core"
);
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { assertProbeTarget } from "../src/probe-safety.mjs";
const base = "http://127.0.0.1:43127",
  out = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../evidence",
  );
fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch({
  executablePath:
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  headless: true,
});
const page = await browser.newPage({ viewport: { width: 1616, height: 1106 } });
const errors = [],
  external = [],
  posts = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("request", (r) => {
  if (
    !r.url().startsWith(base + "/") &&
    !r.url().startsWith("blob:") &&
    !r.url().startsWith("data:")
  )
    external.push(r.url());
  if (
    r.method() === "POST" &&
    /\/bridge\/threads$/.test(new URL(r.url()).pathname)
  )
    posts.push(r.url());
});
const result = {
  observedAt: new Date().toISOString(),
  scope:
    "real Windows browser UI + official local desktop; viewport simulation, not Android APK",
  checks: {},
  viewports: [],
};
let remoteId;
const api = (route, body) =>
  page.evaluate(
    async ({ route, body }) => {
      const r = await fetch(route, {
        method: body === undefined ? "GET" : "POST",
        headers: {
          "X-Bridge-CSRF": document.querySelector("meta[name=bridge-csrf]")
            .content,
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      if (!r.ok) throw Error("HTTP " + r.status);
      return r.json();
    },
    { route, body },
  );
try {
  if (process.argv.includes("--resume")) {
    Object.assign(
      result,
      JSON.parse(
        fs.readFileSync(path.join(out, "ui-v3-verification.json"), "utf8"),
      ),
    );
    result.viewports = [];
    result.resumedAt = new Date().toISOString();
    await page.goto(base);
    await page.locator('[data-thread-id="' + result.threadId + '"]').click();
    await page.waitForFunction(
      () =>
        [...document.querySelectorAll(".assistant-message")].some((n) =>
          n.textContent.includes("UI_LAYOUT_SECOND_OK"),
        ),
      {},
      { timeout: 30000 },
    );
  } else {
    await page.goto(base);
    await page.waitForSelector(".thread-card");
    await page.locator("#create").click();
    assert.equal(await page.locator("dialog[open]").count(), 0);
    assert.equal(posts.length, 0);
    assert.equal(
      await page
        .locator("#prompt")
        .evaluate((n) => n === document.activeElement),
      true,
    );
    await page.locator("#prompt").fill("未发送草稿");
    await page.locator("#prompt").press("Shift+Enter");
    assert.ok((await page.locator("#prompt").inputValue()).includes("\n"));
    assert.equal(posts.length, 0);
    await page
      .locator("#prompt")
      .dispatchEvent("keydown", { key: "Enter", isComposing: true });
    assert.equal(posts.length, 0);
    result.checks.newConversationInlineAndDoesNotCreateUntilSend = true;
    result.checks.shiftEnterAndImeDoNotSend = true;
    await page
      .locator("#prompt")
      .fill(
        "请用三条简短的 Markdown 列表描述：切换设备、同步官方对话、下载原图。开头写 UI_LAYOUT_FIRST_OK。不要调用工具或修改文件。",
      );
    const createdResponse = page.waitForResponse(
      (r) =>
        r.url() === base + "/api/agents/local/bridge/threads" &&
        r.request().method() === "POST",
    );
    await page.locator("#prompt").press("Enter");
    const created = await (await createdResponse).json();
    assert.equal(created.status, "accepted");
    result.threadId = created.result.threadId;
    assertProbeTarget(
      await api("/api/agents/local/bridge/status"),
      result.threadId,
    );
    assert.equal(posts.length, 1);
    console.log("INLINE_CREATE_ACCEPTED", result.threadId);
    await page.waitForFunction(
      () =>
        [...document.querySelectorAll(".assistant-message")].some((n) =>
          n.textContent.includes("UI_LAYOUT_FIRST_OK"),
        ),
      {},
      { timeout: 90000 },
    );
    await page.waitForFunction(
      () => document.getElementById("image").disabled === false,
      {},
      { timeout: 30000 },
    );
    assert.ok((await page.locator(".assistant-message li").count()) >= 3);
    result.checks.nativeCreateAndMarkdownReply = true;
    await page.screenshot({ path: path.join(out, "ui-v3-desktop-chat.png") });
    await page
      .locator("#prompt")
      .fill(
        "只回复 UI_LAYOUT_SECOND_OK，然后另起一行重复上一条回复的英文标记。不要调用工具。",
      );
    await page.locator("#prompt").press("Enter");
    await page.waitForFunction(
      () =>
        [...document.querySelectorAll(".assistant-message")].some(
          (n) =>
            n.textContent.includes("UI_LAYOUT_SECOND_OK") &&
            n.textContent.includes("UI_LAYOUT_FIRST_OK"),
        ),
      {},
      { timeout: 90000 },
    );
    result.checks.sameOfficialConversationSecondTurn = true;
    const read = await api(
      "/api/agents/local/bridge/threads/" + result.threadId,
    );
    result.turns = read.data.turns.map((t) => ({
      id: t.id,
      status: t.status,
      startedAt: t.startedAt,
      reply: t.items
        .filter((i) => i.type === "agentMessage")
        .map((i) => i.text),
    }));
    assert.equal(read.data.thread.id, result.threadId);
  }
  await page.locator("#prompt").fill("横竖屏切换保留这条未发送草稿");
  for (const [width, height, mobile] of [
    [390, 844, true],
    [844, 390, false],
    [760, 900, true],
    [1100, 800, false],
    [667, 375, false],
    [320, 640, true],
    [600, 400, false],
    [1440, 960, false],
  ]) {
    await page.setViewportSize({ width, height });
    await page.waitForFunction(
      (m) => document.body.classList.contains("mobile-layout") === m,
      mobile,
    );
    await page.waitForFunction((m) => {
      const b = document.getElementById("sidebar").getBoundingClientRect();
      return m ? b.right <= 0 : b.x === 0;
    }, mobile);
    assert.equal(
      await page.locator("#prompt").inputValue(),
      "横竖屏切换保留这条未发送草稿",
    );
    assert.equal(
      await page
        .locator(".thread-card.selected")
        .first()
        .getAttribute("data-thread-id"),
      result.threadId,
    );
    assert.ok(
      (await page.locator("#messages").textContent()).includes(
        "UI_LAYOUT_SECOND_OK",
      ),
    );
    const geometry = await page.evaluate(() => ({
      overflow: document.documentElement.scrollWidth > innerWidth,
      sidebarX: document.getElementById("sidebar").getBoundingClientRect().x,
      composer: document
        .getElementById("form")
        .getBoundingClientRect()
        .toJSON(),
      send: document.getElementById("send").getBoundingClientRect().toJSON(),
    }));
    assert.equal(geometry.overflow, false, `${width} viewport overflow`);
    assert.ok(
      geometry.composer.bottom <= height + 1,
      `${width} composer offscreen`,
    );
    assert.ok(
      geometry.send.right <= width && geometry.send.left >= 0,
      `${width} send offscreen`,
    );
    if (mobile) assert.ok(geometry.sidebarX < 0);
    else assert.equal(geometry.sidebarX, 0);
    result.viewports.push({
      width,
      height,
      mobile,
      noHorizontalOverflow: true,
      composerVisible: true,
      draftPreserved: true,
      conversationPreserved: true,
    });
    if (width === 390)
      await page.screenshot({ path: path.join(out, "ui-v3-mobile-chat.png") });
    if (width === 844)
      await page.screenshot({ path: path.join(out, "ui-v3-landscape.png") });
  }
  result.checks.resizingPreservesConversationAndDraft = true;
  console.log("VIEWPORT_MATRIX_PASS");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator("#mobile-menu").click();
  await page.waitForFunction(
    () => document.getElementById("sidebar").getBoundingClientRect().x === 0,
  );
  const deviceAtBottom = await page.evaluate(
    () =>
      document.getElementById("footer-agent").getBoundingClientRect().bottom >
      innerHeight - 40,
  );
  assert.equal(deviceAtBottom, true);
  await page.locator("#footer-agent").click();
  await page.locator("#add-agent").click();
  await page.locator("#agent-name").fill("Responsive-Offline-Probe");
  await page.locator("#agent-host").fill("100.100.100.102");
  await page.locator("#save-agent").click();
  await page.waitForFunction(
    () => !document.getElementById("agent-dialog").open,
  );
  const devices = await api("/api/agents");
  remoteId = devices.agents.find(
    (a) => a.name === "Responsive-Offline-Probe",
  ).id;
  await page.locator("#footer-agent").click();
  await page.locator('[data-agent-id="' + remoteId + '"]').click();
  await page.waitForFunction(() =>
    document.getElementById("connection").textContent.includes("中断"),
  );
  assert.equal(await page.locator("#messages").textContent(), "");
  assert.equal(await page.locator("#send").isDisabled(), true);
  assert.equal(
    await page.evaluate(() => document.body.classList.contains("drawer-open")),
    false,
  );
  await page.locator("#mobile-menu").click();
  await page.waitForFunction(
    () => document.getElementById("sidebar").getBoundingClientRect().x === 0,
  );
  await page.locator("#footer-agent").click();
  await page.locator('[data-agent-id="local"]').click();
  await page.waitForFunction(
    () => document.querySelectorAll(".thread-card").length > 0,
  );
  assert.equal(
    await page.evaluate(() => document.body.classList.contains("drawer-open")),
    false,
  );
  await api("/api/agents/remove", { id: remoteId });
  remoteId = null;
  result.checks.mobileDeviceManagementAndSwitching = true;
  await page.locator("#mobile-menu").click();
  await page.waitForFunction(
    () => document.getElementById("sidebar").getBoundingClientRect().x === 0,
  );
  await page.keyboard.press("Escape");
  assert.equal(
    await page.evaluate(() => document.body.classList.contains("drawer-open")),
    false,
  );
  result.checks.mobileDrawerKeyboardAndAutoClose = true;
  await page.locator("#mobile-new").click();
  await page.waitForFunction(() => document.getElementById("toast").hidden);
  await page.screenshot({ path: path.join(out, "ui-v3-mobile-new.png") });
  const safe = await page.evaluate(async () => {
    const { markdown } = await import("/ui.mjs");
    const n = markdown(
      "<img src=x onerror=alert(1)>\n\n[unsafe](javascript:alert(1))\n\n- **safe**",
    );
    return {
      images: n.querySelectorAll("img").length,
      links: n.querySelectorAll("a").length,
      bold: n.querySelector("strong").textContent,
    };
  });
  assert.deepEqual(safe, { images: 0, links: 0, bold: "safe" });
  result.checks.markdownRejectsHtmlAndUnsafeLinks = true;
  result.pageErrors = errors;
  result.externalRequests = external;
  assert.equal(errors.length, 0);
  assert.equal(external.length, 0);
  result.checks.noPageErrorsOrExternalRequests = true;
  result.finishedAt = new Date().toISOString();
  console.log("UI_V3_PASS", JSON.stringify(result.checks));
} finally {
  if (remoteId)
    await api("/api/agents/remove", { id: remoteId }).catch(() => {});
  fs.writeFileSync(
    path.join(out, "ui-v3-verification.json"),
    JSON.stringify(result, null, 2),
  );
  await browser.close();
}
