// Explicit local Probe test. Never writes to the development task or other tasks.
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Bridge, ROOT } from "../src/bridge.mjs";
import { liveTurns } from "../src/state.mjs";
import { startServer } from "../src/server.mjs";
if (!process.argv.includes("--create-probe"))
  throw Error(
    "Use --create-probe to authorize a dedicated real task with two low-cost turns",
  );
const { chromium } = await import(
  process.env.REMOTE_BRIDGE_PLAYWRIGHT || "playwright-core"
);
const b = new Bridge(
  fs
    .readFileSync(path.join(ROOT, "work/feature-probe-home.txt"), "utf8")
    .trim(),
);
const report = {
  time: new Date().toISOString(),
  source: "official-desktop-owner-IPC + local UI",
  checks: {},
  requests: [],
  errors: [],
};
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const summarize = (settings) => {
  const s = settings && {
    ...settings,
    permissions: settings.permissions ?? settings.activePermissionProfile?.id,
  };
  return Object.fromEntries(
    [
      "model",
      "effort",
      "serviceTier",
      "permissions",
      "approvalPolicy",
      "sandboxPolicy",
    ]
      .filter((k) => s?.[k] !== undefined)
      .map((k) => [k, s[k]]),
  );
};
async function until(fn, timeout = 90000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const value = await fn();
    if (value) return value;
    await pause(700);
  }
  throw Error("Timed out waiting for official state");
}
let server, browser, page, id, initial, failure;
try {
  await b.connect();
  report.officialPid = b.desktop.identity.officialPid;
  const created = await b.createProbe(
    "running-settings-create-" + randomUUID(),
    "这是运行中设置测试。请调用 clock.sleep 等待 45 秒，然后只回复 RUNNING_SETTINGS_OK。不要访问文件、网络或其他工具。",
    { model: "gpt-6-astra", effort: "low", permissionMode: "read-only" },
  );
  id = report.threadId = created.result.threadId;
  b.guardProbe(id);
  console.log(JSON.stringify({ stage: "created", threadId: id }));
  const request = b.desktop.ipc.request.bind(b.desktop.ipc);
  b.desktop.ipc.request = async (method, params, options) => {
    if (
      /^thread-follower-(update-thread-settings|start-turn|steer-turn|interrupt-turn)$/.test(
        method,
      )
    ) {
      b.guardProbe(params.conversationId);
      assert.equal(params.conversationId, id);
      report.requests.push({
        method,
        threadId: id,
        targetClientId: options?.targetClientId,
        ...(params.threadSettings
          ? { settings: summarize(params.threadSettings) }
          : {}),
      });
    }
    return request(method, params, options);
  };
  await b.follow(id);
  initial = await until(async () => {
    const r = await b.read(id),
      turn = liveTurns(r.live?.state).at(-1);
    return r.data.thread.status.type === "active" &&
      turn?.status === "inProgress" &&
      turn.params &&
      r.live?.state.latestThreadSettings
      ? r
      : null;
  });
  const first = liveTurns(initial.live.state).at(-1);
  report.owner = initial.live.owner;
  report.firstTurnId = first.turnId;
  report.initialSettings = summarize(initial.live.state.latestThreadSettings);
  report.firstTurnSettings = summarize(first.params);
  const started = await startServer({ port: 0, bridge: b });
  server = started.server;
  browser = await chromium.launch({
    executablePath:
      "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
    headless: true,
  });
  page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
  page.on("pageerror", (e) => report.errors.push(e.message));
  // Only settings and follow may be posted by this UI test.
  await page.route(started.address + "/api/**", async (route) => {
    const req = route.request(),
      p = new URL(req.url()).pathname;
    if (
      req.method() === "POST" &&
      ![
        "/api/agents/select",
        "/api/updates/activity",
        `/api/agents/local/bridge/threads/${id}/follow`,
        `/api/agents/local/bridge/threads/${id}/settings`,
      ].includes(p)
    ) {
      report.errors.push("Unexpected UI write: " + p);
      return route.abort();
    }
    return route.continue();
  });
  await page.goto(started.address + "/?thread=" + id);
  await page.waitForFunction(() =>
    document.querySelector("#metadata").textContent.includes("读取时间:"),
  );
  async function activeState() {
    const r = await b.read(id);
    assert.equal(
      r.data.thread.status.type,
      "active",
      "test requires running official task",
    );
    assert.equal(r.live.owner, report.owner);
    const turn = liveTurns(r.live.state).at(-1);
    assert.equal(
      turn.turnId,
      first.turnId,
      "settings must not start another turn",
    );
    assert.equal(turn.status, "inProgress");
    assert.deepEqual(
      summarize(turn.params),
      report.firstTurnSettings,
      "current turn parameters unchanged",
    );
    return r;
  }
  async function choose(kind, selector, expected) {
    await page.keyboard.press("Escape");
    await page.locator(`#${kind}-display:not(:disabled)`).waitFor();
    await activeState();
    await page.locator(`#${kind}-display`).click();
    const [response] = await Promise.all([
      page.waitForResponse(
        (r) =>
          r.request().method() === "POST" &&
          new URL(r.url()).pathname.endsWith("/settings"),
      ),
      page.locator(selector).click(),
    ]);
    const result = await response.json();
    assert.equal(result.status, "accepted", JSON.stringify(result));
    assert.equal(result.result.ownerClientId, report.owner);
    assert.equal(result.result.appliesTo, "next-turn");
    await page.locator(`#${kind}-display:not(:disabled)`).waitFor();
    const observed = await until(async () => {
      const r = await activeState();
      return Object.entries(expected).every(
        ([k, v]) => summarize(r.live.state.latestThreadSettings)[k] === v,
      )
        ? r
        : null;
    }, 10000);
    report.checks[kind + "-" + Object.values(expected).join("-")] = {
      status: observed.data.thread.status.type,
      turnId: first.turnId,
      settings: summarize(observed.live.state.latestThreadSettings),
      revision: observed.live.revision,
    };
  }
  await choose("permission", '#settings-menu [data-value="workspace"]', {
    permissions: ":workspace",
  });
  await choose("effort", '#settings-menu [aria-label="设为中"]', {
    effort: "medium",
  });
  await page.screenshot({
    path: path.join(ROOT, "evidence/running-settings-live-ui.png"),
  });
  await choose("effort", "#speed-toggle", { serviceTier: "priority" });
  await choose("effort", "#speed-toggle", { serviceTier: "default" });
  await choose("model", '#settings-menu [data-value="gpt-5.4-mini"]', {
    model: "gpt-5.4-mini",
  });
  assert.ok(
    report.requests.every(
      (r) => r.method === "thread-follower-update-thread-settings",
    ),
  );
  report.checks.onlySettingsRequestsDuringRunning = true;
  console.log(
    JSON.stringify({
      stage: "active-settings-verified",
      threadId: id,
      turnId: first.turnId,
    }),
  );
  await until(
    async () => (await b.codexThread(id)).thread.status.type === "idle",
  );
  const completed = await b.read(id),
    firstFinal = liveTurns(completed.live.state).find(
      (t) => t.turnId === first.turnId,
    );
  assert.equal(firstFinal.status, "completed");
  report.checks.currentTurnCompletedNaturally = true;
  b.guardProbe(id);
  await b.nativeSend(
    id,
    "running-settings-next-" + randomUUID(),
    "只回复 NEXT_SETTINGS_OK。不要调用工具，不要访问或修改任何文件。",
  );
  const next = await until(async () => {
    const r = await b.read(id),
      turn = liveTurns(r.live?.state).at(-1);
    return turn && turn.turnId !== first.turnId && turn.params ? turn : null;
  });
  report.nextTurnId = next.turnId;
  report.nextTurnSettings = summarize(next.params);
  assert.equal(next.params.model, "gpt-5.4-mini");
  assert.equal(next.params.effort, "medium");
  assert.equal(next.params.permissions, ":workspace");
  assert.equal(next.params.serviceTier, "default");
  await until(
    async () => (await b.codexThread(id)).thread.status.type === "idle",
  );
  const final = await b.read(id);
  assert.equal(
    liveTurns(final.live.state).find((t) => t.turnId === next.turnId).status,
    "completed",
  );
  report.checks.nextTurnUsedUpdatedSettings = true;
  assert.deepEqual(report.errors, []);
} catch (e) {
  failure = e;
  report.error = e.stack;
  if (page) {
    report.uiError = await page
      .locator("#error")
      .textContent()
      .catch(() => "unavailable");
    await page
      .screenshot({
        path: path.join(ROOT, "evidence/running-settings-failure.png"),
      })
      .catch(() => {});
  }
} finally {
  if (id && b.connected && initial) {
    try {
      b.guardProbe(id);
      await b.updateSettings(id, "running-settings-restore-" + randomUUID(), {
        model: "gpt-6-astra",
        effort: "low",
        permissionMode: "read-only",
        serviceTier: "default",
      });
      await until(async () => {
        const s = summarize(
          (await b.read(id)).live?.state.latestThreadSettings,
        );
        return (
          s?.model === "gpt-6-astra" &&
          s.effort === "low" &&
          s.permissions === ":read-only" &&
          s.serviceTier === "default"
        );
      }, 10000);
      report.checks.probeDefaultsRestored = true;
    } catch (e) {
      report.restoreError = e.message;
      failure ??= e;
    }
  }
  await browser?.close();
  b.disconnect();
  if (server) {
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
  }
  report.result = failure ? "failed" : "passed";
  fs.writeFileSync(
    path.join(ROOT, "evidence/running-settings-live.json"),
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report));
}
if (failure) process.exitCode = 1;
