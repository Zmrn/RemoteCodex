// Real UI and real streaming HTTP, with isolated task fixtures only.
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import assert from "node:assert/strict";
import { ROOT } from "../src/bridge.mjs";
const { chromium } = await import(
  process.env.REMOTE_BRIDGE_PLAYWRIGHT || "playwright-core"
);
const ids = [
  "77777777-7777-4777-8777-777777777777",
  "88888888-8888-4888-8888-888888888888",
];
const streams = new Map(),
  errors = [],
  checks = [],
  writes = [];
let active = 0,
  peak = 0,
  reads = 0,
  aborted = 0,
  delay = 2000,
  interval = 650;
let selectionFailure = false,
  readFailure = false,
  revision = 0;
const status = () => ({
  connected: true,
  existingCodexWritable: true,
  threads: {},
});
const server = http.createServer(async (req, res) => {
  const p = new URL(req.url, "http://fixture").pathname;
  const json = (data, code = 200) => {
    res.writeHead(code, { "content-type": "application/json" });
    res.end(JSON.stringify(data));
  };
  if (!p.startsWith("/api/")) {
    const file = p === "/" ? "index.html" : p.slice(1);
    if (!/^[\w.-]+$/.test(file)) return res.end();
    const types = {
      ".html": "text/html",
      ".js": "text/javascript",
      ".mjs": "text/javascript",
      ".css": "text/css",
      ".svg": "image/svg+xml",
    };
    res.setHeader(
      "content-type",
      types[path.extname(file)] || "application/octet-stream",
    );
    return res.end(
      fs
        .readFileSync(path.join(ROOT, "public", file))
        .toString()
        .replace("__BRIDGE_CSRF__", "fixture-only")
        .replace("__BRIDGE_VERSION__", "fixture"),
    );
  }
  if (p === "/api/agents")
    return json({
      selectedId: "local",
      agents: [
        { id: "local", kind: "local", name: "本机测试", host: "fixture" },
        {
          id: "laptop",
          kind: "remote",
          name: "笔记本测试",
          host: "100.70.8.9",
          port: 43128,
        },
      ],
    });
  if (p === "/api/agents/select")
    return selectionFailure
      ? json({ error: "fixture selection failed" }, 500)
      : json({});
  if (p.endsWith("/updates"))
    return json({ supported: false, currentVersion: "fixture" });
  if (p.endsWith("/activity")) return json({});
  const agent = /\/agents\/([^/]+)/.exec(p)?.[1];
  if (p.endsWith("/status") || p.endsWith("/connect")) return json(status());
  if (p.endsWith("/projects")) return json({ data: { projects: [] } });
  if (p.endsWith("/usage")) return json({ status: "available", weekly: [] });
  if (p.endsWith("/queue"))
    return json({
      confirmed: true,
      revision: "1",
      messages: [],
      recoveries: [],
    });
  if (p.endsWith("/follow")) return json({});
  if (p.endsWith("/events")) {
    res.writeHead(200, { "content-type": "text/event-stream" });
    res.write(
      `data: ${JSON.stringify({ kind: "resync-required", ...status() })}\n\n`,
    );
    streams.set(agent, res);
    const tick = () =>
      res.write(
        `data: ${JSON.stringify({ kind: "thread-state", threadId: ids[0], status: { type: "running", confirmed: true } })}\n\n`,
      );
    let timer = setInterval(tick, interval);
    req.on("close", () => {
      clearInterval(timer);
      if (streams.get(agent) === res) streams.delete(agent);
    });
    return;
  }
  if (p.endsWith("/threads") && req.method === "GET")
    return json({
      data: {
        threads: ids.map((id, i) => ({
          id,
          kind: "codex",
          title: agent + " fixture " + i,
          status: "active",
        })),
      },
    });
  const id = ids.find((id) => p.endsWith("/threads/" + id));
  if (id && req.method === "GET") {
    const n = ++reads,
      rev = revision;
    if (agent === "laptop") {
      active++;
      peak = Math.max(peak, active);
    }
    let finished = false;
    const timer = setTimeout(
      () => {
        finished = true;
        if (readFailure)
          return json({ error: "fixture content unavailable" }, 502);
        json({
          source: "fixture",
          observedAt: String(n),
          data: {
            thread: {
              id,
              kind: "codex",
              title: agent + " fixture " + ids.indexOf(id),
              status: { type: "active" },
            },
            page: { nextCursor: null },
            turns: [
              {
                id: "fixture-turn",
                status: "inProgress",
                items: [
                  {
                    id: "fixture-message",
                    type: "agentMessage",
                    text: `${agent} content ${ids.indexOf(id)} revision ${rev}`,
                  },
                ],
              },
            ],
          },
          live: { status: { type: "running", confirmed: true }, state: {} },
        });
      },
      agent === "laptop" ? delay : 30,
    );
    res.on("close", () => {
      clearTimeout(timer);
      if (agent === "laptop") {
        active--;
        if (!finished) aborted++;
      }
    });
    return;
  }
  if (req.method === "POST") writes.push(p);
  json({});
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const address = "http://127.0.0.1:" + server.address().port;
const browser = await chromium.launch({
  executablePath:
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  headless: true,
});
const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
page.on("pageerror", (e) => errors.push(e.message));
const device = async (name) => {
  await page.locator("#footer-agent").click();
  await page.locator("#agent-menu button").filter({ hasText: name }).click();
};
const thread = async (id) =>
  page.locator(`.thread-card[data-thread-id="${id}"]`).first().click();
const connected = () =>
  page.waitForFunction(
    () =>
      document.querySelector("#connection").textContent === "已连接官方桌面",
  );
try {
  await page.goto(address);
  await connected();
  await device("笔记本测试");
  await connected();
  await thread(ids[0]);
  await page.waitForFunction(
    () =>
      document
        .querySelector("#messages")
        .textContent.includes("laptop content 0"),
    {},
    { timeout: 6000 },
  );
  assert.equal(
    peak,
    1,
    "slow live reads must not overlap or discard every response",
  );
  checks.push(
    "slow responses render during continuous owner events; at most one content read",
  );
  await page.waitForFunction(() =>
    document
      .querySelector("#messages")
      .textContent.includes("laptop content 0"),
  );
  // While the next slow response is pending, switch away and verify browser abort propagation.
  while (!active) await new Promise((r) => setTimeout(r, 30));
  const start = Date.now();
  await device("本机测试");
  await connected();
  await thread(ids[1]);
  await page.waitForFunction(() =>
    document.querySelector("#messages").textContent.includes("local content 1"),
  );
  assert.ok(Date.now() - start < 2000);
  assert.ok(aborted > 0);
  assert.equal(active, 0);
  checks.push(
    "device switch aborts old reads and connects locally within two seconds",
  );
  await device("笔记本测试");
  await connected();
  await thread(ids[0]);
  while (!active) await new Promise((r) => setTimeout(r, 30));
  await thread(ids[1]);
  await page.waitForFunction(
    () =>
      document
        .querySelector("#messages")
        .textContent.includes("laptop content 1"),
    {},
    { timeout: 5000 },
  );
  assert.ok(
    !(await page.locator("#messages").innerText()).includes("laptop content 0"),
  );
  checks.push("task switch cancels stale content without mixing tasks");
  streams.get("laptop").destroy();
  await page.waitForFunction(
    () => document.querySelector("#connection").textContent === "连接中断",
  );
  revision = 2;
  interval = 100;
  await connected();
  await page.waitForFunction(
    () =>
      document.querySelector("#messages").textContent.includes("revision 2"),
    {},
    { timeout: 6000 },
  );
  assert.equal(await page.locator("#prompt").isDisabled(), false);
  checks.push(
    "SSE reconnection restores confirmed connection and missed messages",
  );
  streams.get("laptop").write('data: {"kind":"connection-interrupted"}\n\n');
  await page.waitForFunction(
    () => document.querySelector("#connection").textContent === "连接中断",
  );
  revision = 4;
  streams.get("laptop").write('data: {"kind":"connected"}\n\n');
  await connected();
  await page.waitForFunction(
    () =>
      document.querySelector("#messages").textContent.includes("revision 4"),
    {},
    { timeout: 6000 },
  );
  checks.push(
    "official IPC reconnect recovers through the existing SSE stream",
  );
  await thread(ids[0]);
  await page.waitForFunction(
    () =>
      document
        .querySelector("#messages")
        .textContent.includes("laptop content 0"),
    {},
    { timeout: 5000 },
  );
  const before = reads;
  revision = 3;
  await page.waitForFunction(
    () =>
      document.querySelector("#messages").textContent.includes("revision 3"),
    {},
    { timeout: 6000 },
  );
  assert.ok(reads > before);
  checks.push("high-frequency events cannot postpone refresh indefinitely");
  readFailure = true;
  await thread(ids[1]);
  await page.waitForFunction(
    () => !document.querySelector("#error").hidden,
    {},
    { timeout: 5000 },
  );
  assert.match(await page.locator("#task-state").innerText(), /未知/);
  assert.equal(await page.locator("#task-state").isVisible(), true);
  assert.equal(await page.locator("#connection").innerText(), "已连接官方桌面");
  readFailure = false;
  await page.locator("#refresh").click();
  await page.waitForFunction(
    () =>
      document
        .querySelector("#messages")
        .textContent.includes("laptop content 1"),
    {},
    { timeout: 5000 },
  );
  checks.push(
    "content errors are visible and recoverable without disconnecting the device",
  );
  selectionFailure = true;
  await device("本机测试");
  await page.waitForFunction(
    () => document.querySelector("#connection").textContent === "连接中断",
  );
  assert.match(await page.locator("#error").innerText(), /selection failed/);
  checks.push(
    "selection failure exits the connecting state with an explicit error",
  );
  assert.deepEqual(writes, []);
  assert.deepEqual(errors, []);
  const report = {
    result: "passed",
    source: "isolated HTTP fixtures; no official task writes",
    checks,
    peak,
    aborted,
    errors,
    writes,
  };
  fs.mkdirSync(path.join(ROOT, "evidence"), { recursive: true });
  fs.writeFileSync(
    path.join(ROOT, "evidence/device-switch-ui.json"),
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report));
} finally {
  await browser.close();
  server.closeAllConnections();
  await new Promise((r) => server.close(r));
}
