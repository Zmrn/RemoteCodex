// Read-only: pass IDs of an already running task and an already completed Probe.
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
const [runningId, completedId] = process.argv.slice(2);
if (![runningId, completedId].every((id) => /^[a-f0-9-]{36}$/.test(id ?? "")))
  throw Error(
    "Usage: node scripts/verify-status-live.mjs RUNNING_ID COMPLETED_PROBE_ID",
  );
const { chromium } = await import(
  process.env.REMOTE_BRIDGE_PLAYWRIGHT || "playwright-core"
);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const browser = await chromium.launch({
  executablePath:
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  headless: true,
});
const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
const report = {
  scope:
    "real official desktop, read-only own UI; no model calls or official window automation",
  checks: {},
  errors: [],
};
page.on("pageerror", (e) => report.errors.push(e.message));
try {
  await page.goto("http://127.0.0.1:43127/?ui=0.6.1");
  await page.waitForFunction(
    ({ runningId, completedId }) =>
      document.querySelector(`.thread-card[data-thread-id="${runningId}"]`)
        ?.dataset.status === "running" &&
      document.querySelector(`.thread-card[data-thread-id="${completedId}"]`)
        ?.dataset.status === "completed",
    { runningId, completedId },
  );
  const snapshot = await page.evaluate(
    async (ids) => {
      const headers = {
        "X-Bridge-CSRF": document.querySelector('meta[name="bridge-csrf"]')
          .content,
      };
      const status = await (await fetch("/api/status", { headers })).json();
      const list = await (await fetch("/api/threads", { headers })).json();
      return {
        connected: status.connected,
        officialPid: status.officialPid,
        threads: ids.map((id) => ({
          id,
          queryStatus: [
            ...(list.data.pinnedThreads ?? []),
            ...list.data.threads,
          ].find((t) => t.id === id)?.status,
          live: status.threads[id],
          renderedStatus: document.querySelector(
            `.thread-card[data-thread-id="${id}"]`,
          ).dataset.status,
        })),
      };
    },
    [runningId, completedId],
  );
  assert.ok(snapshot.connected);
  assert.equal(snapshot.threads[0].live.status.type, "running");
  assert.equal(snapshot.threads[1].live.status.type, "completed");
  assert.ok(snapshot.threads.every((t) => t.live.status.confirmed));
  const running = page.locator(
    `.thread-card[data-thread-id="${runningId}"] .thread-spinner`,
  );
  assert.equal(await running.count(), 1);
  assert.equal(
    await running.evaluate((el) => getComputedStyle(el).animationName),
    "thread-spin",
  );
  report.snapshot = snapshot;
  report.checks.realOwnerRunningRingAndCompletedBlueDot = true;
  await page.locator(`.thread-card[data-thread-id="${completedId}"]`).click();
  await page.waitForFunction(() =>
    document.querySelector("#metadata").textContent.includes("读取时间:"),
  );
  assert.equal(
    await page
      .locator(`.thread-card[data-thread-id="${completedId}"]`)
      .getAttribute("data-status"),
    "completed",
  );
  assert.equal(
    await page
      .locator(
        `.thread-card[data-thread-id="${completedId}"] .thread-dot.completed`,
      )
      .count(),
    1,
  );
  report.checks.openCompletedProbePreservesDot = true;
  await page
    .locator(`.thread-card[data-thread-id="${runningId}"]`)
    .screenshot({
      path: path.join(root, "evidence/ui-v6.1-status-live-running.png"),
    });
  assert.deepEqual(report.errors, []);
  report.status = "passed";
} catch (e) {
  report.status = "failed";
  report.failure = e.message;
  throw e;
} finally {
  report.observedAt = new Date().toISOString();
  fs.writeFileSync(
    path.join(root, "evidence/ui-v6.1-status-live.json"),
    JSON.stringify(report, null, 2),
  );
  await browser.close();
  console.log(JSON.stringify(report, null, 2));
}
