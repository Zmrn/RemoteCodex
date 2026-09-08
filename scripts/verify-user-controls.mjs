// Inspects actual UI controls; never sends messages or edits the official queue.
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
const [id] = process.argv.slice(2);
if (!/^[a-f0-9-]{36}$/.test(id ?? ""))
  throw Error("Pass a task ID for read-only UI inspection");
const { chromium } = await import(
  process.env.REMOTE_BRIDGE_PLAYWRIGHT || "playwright-core"
);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const base = "http://127.0.0.1:43127";
const report = {
  scope:
    "real task UI inspection with a disposable, unsent browser draft; all task mutation requests blocked",
  threadId: id,
  checks: {},
  errors: [],
  blockedWrites: [],
};
const browser = await chromium.launch({
  executablePath:
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  headless: true,
});
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 960 },
  });
  page.on("pageerror", (e) => report.errors.push(e.message));
  await page.route("**/*", (route) => {
    const r = route.request(),
      url = new URL(r.url());
    const readOnlyPost = [
      "/api/agents/select",
      "/api/agents/local/bridge/connect",
      `/api/agents/local/bridge/threads/${id}/follow`,
    ].includes(url.pathname);
    if (url.origin !== base || (r.method() === "POST" && !readOnlyPost)) {
      report.blockedWrites.push(r.method() + " " + url.pathname);
      return route.abort();
    }
    return route.continue();
  });
  await page.goto(base + "/?ui=0.6.5&thread=" + id);
  await page.waitForFunction(
    (id) =>
      document.querySelector("#metadata").textContent.includes(id) &&
      !document.querySelector("#prompt").disabled,
    id,
  );
  const metadata = await page.evaluate(async (id) => {
    const headers = {
      "X-Bridge-CSRF": document.querySelector('meta[name="bridge-csrf"]')
        .content,
    };
    const get = async (p) => (await fetch("/api" + p, { headers })).json();
    const [s, r, q] = await Promise.all([
      get("/status"),
      get("/threads/" + id),
      get("/threads/" + id + "/queue"),
    ]);
    return {
      connected: s.connected,
      officialPid: s.officialPid,
      readOnly: s.readOnlyThreadIds?.includes(id),
      excludedFromTests: s.testExcludedThreadIds?.includes(id),
      runtime: r.data.thread.status,
      kind: r.data.thread.kind,
      queue: q.messages.map((m) => ({
        id: m.id,
        editable: m.editable,
        restriction: m.restriction,
      })),
      queueSource: q.source,
    };
  }, id);
  assert.equal(metadata.kind, "codex");
  assert.equal(metadata.readOnly, false);
  report.metadata = metadata;
  assert.ok(await page.locator("#prompt").isEnabled());
  await page.locator("#prompt").fill("仅检查本地输入控件，不发送");
  assert.ok(await page.locator("#send").isEnabled());
  report.checks.composerAndSendEnabled = true;
  if (metadata.runtime.type === "active") {
    assert.equal(
      await page.locator("#send").getAttribute("aria-label"),
      "加入队列",
    );
    report.checks.activeTaskOffersEnqueue = true;
  }
  await page.locator("#prompt").fill("");
  report.checks.draftClearedWithoutSending = true;
  report.visibleQueueButtons = await page
    .locator(".queued-message")
    .evaluateAll((rows) =>
      rows.map((row) => ({
        id: row.dataset.messageId,
        steerDisabled: row.querySelector(".queue-steer").disabled,
        deleteDisabled: row.querySelector(".queue-delete").disabled,
      })),
    );
  for (const row of report.visibleQueueButtons)
    assert.equal(row.deleteDisabled, false);
  assert.deepEqual(report.blockedWrites, []);
  assert.deepEqual(report.errors, []);
  report.status = "passed";
} catch (e) {
  report.status = "failed";
  report.failure = e.message;
  throw e;
} finally {
  report.observedAt = new Date().toISOString();
  fs.writeFileSync(
    path.join(root, "evidence/ui-v6.5-user-controls.json"),
    JSON.stringify(report, null, 2),
  );
  await browser.close();
  console.log(JSON.stringify(report, null, 2));
}
