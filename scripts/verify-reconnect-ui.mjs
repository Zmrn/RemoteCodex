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
  delay = 30,
  interval = 650;
let selectionFailure = false,
  readFailure = false,
  revision = 0;
const health = { local: true, laptop: true };
const connects = { local: 0, laptop: 0 },
  follows = { local: 0, laptop: 0 };
let outage = false,
  unavailable = false,
  silent = false;
const status = (agent = "local") => ({
  connected: health[agent],
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
  if (outage && agent === "laptop")
    return json({ error: "network unavailable" }, 503);
  if (p.endsWith("/status")) return json(status(agent));
  if (p.endsWith("/connect")) {
    connects[agent]++;
    if (unavailable && agent === "laptop")
      return json({ error: "desktop unavailable" }, 503);
    health[agent] = true;
    return json(status(agent));
  }
  if (p.endsWith("/projects")) return json({ data: { projects: [] } });
  if (p.endsWith("/usage")) return json({ status: "available", weekly: [] });
  if (p.endsWith("/queue"))
    return json({
      confirmed: true,
      revision: "1",
      messages: [],
      recoveries: [],
    });
  if (p.endsWith("/follow")) {
    follows[agent]++;
    return json({});
  }
  if (p.endsWith("/events")) {
    res.writeHead(200, { "content-type": "text/event-stream" });
    res.write(
      `data: ${JSON.stringify({ kind: "resync-required", ...status(agent) })}\n\n`,
    );
    streams.set(agent, res);
    const tick = () =>
      !silent &&
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
  health.laptop = false;
  unavailable = true;
  await device("笔记本测试");
  await page.waitForFunction(() =>
    document.querySelector("#connection").textContent.includes("自动重连"),
  );
  await new Promise((r) => setTimeout(r, 1400));
  assert.ok(
    connects.laptop >= 2,
    "initial failure retries /connect without a stream",
  );
  unavailable = false;
  await connected();
  checks.push("initial unavailable desktop recovers automatically");
  await thread(ids[0]);
  await page.waitForFunction(() =>
    document.querySelector("#messages").textContent.includes("revision 0"),
  );
  await page.locator("#prompt").fill("unsent draft kept through reconnect");
  await page
    .locator("#image")
    .setInputFiles({
      name: "probe.png",
      mimeType: "image/png",
      buffer: Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=",
        "base64",
      ),
    });
  const followBefore = follows.laptop;
  health.laptop = false;
  unavailable = true;
  streams.get("laptop").write('data: {"kind":"connection-interrupted"}\n\n');
  await page.waitForFunction(() =>
    document.querySelector("#connection").textContent.includes("自动重连"),
  );
  assert.match(await page.locator("#task-state").innerText(), /未知/);
  assert.match(await page.locator("#messages").innerText(), /revision 0/);
  revision = 1;
  unavailable = false;
  await connected();
  await page.waitForFunction(() =>
    document.querySelector("#messages").textContent.includes("revision 1"),
  );
  assert.ok(follows.laptop > followBefore);
  assert.equal(
    await page.locator("#prompt").inputValue(),
    "unsent draft kept through reconnect",
  );
  assert.equal(
    await page.locator("#image").evaluate((e) => e.files[0].name),
    "probe.png",
  );
  checks.push(
    "live SSE plus lost official IPC invokes connect and follow; draft and image survive",
  );
  outage = true;
  streams.get("laptop").destroy();
  await page.waitForFunction(() =>
    document.querySelector("#connection").textContent.includes("自动重连"),
  );
  await new Promise((r) => setTimeout(r, 1400));
  revision = 2;
  health.laptop = false;
  outage = false;
  await connected();
  await page.waitForFunction(() =>
    document.querySelector("#messages").textContent.includes("revision 2"),
  );
  checks.push(
    "network outage and remote restart recover missed messages in the same task",
  );
  // Production watchdog: keep TCP open but suppress every event and heartbeat.
  silent = true;
  const oldStream = streams.get("laptop");
  console.log("Testing production 45-second silent-stream watchdog...");
  const started = Date.now();
  while (streams.get("laptop") === oldStream && Date.now() - started < 58000)
    await new Promise((r) => setTimeout(r, 200));
  assert.notEqual(
    streams.get("laptop"),
    oldStream,
    "watchdog must reopen silent TCP",
  );
  silent = false;
  await connected();
  checks.push(
    "45-second heartbeat watchdog repairs silent TCP without waiting for an error",
  );
  health.laptop = false;
  unavailable = true;
  streams.get("laptop").write('data: {"kind":"connection-interrupted"}\n\n');
  await page.waitForFunction(() =>
    document.querySelector("#connection").textContent.includes("自动重连"),
  );
  await device("本机测试");
  await connected();
  const beforeSwitch = connects.laptop;
  await new Promise((r) => setTimeout(r, 2500));
  assert.equal(connects.laptop, beforeSwitch);
  assert.match(await page.locator("#agent-title").innerText(), /本机/);
  checks.push("switching devices cancels old reconnect timers");
  await device("笔记本测试");
  await page.waitForFunction(() =>
    document.querySelector("#connection").textContent.includes("自动重连"),
  );
  unavailable = false;
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await connected();
  await thread(ids[0]);
  await page.locator("#reconnect").click();
  await connected();
  assert.equal(
    await page.locator("#prompt").inputValue(),
    "unsent draft kept through reconnect",
  );
  checks.push(
    "online wake and manual reconnect preserve current task and draft",
  );
  health.laptop = false;
  unavailable = true;
  streams.get("laptop").write('data: {"kind":"connection-interrupted"}\n\n');
  await page.waitForFunction(() =>
    document.querySelector("#connection").textContent.includes("自动重连"),
  );
  await page.close();
  const beforeClose = connects.laptop;
  await new Promise((r) => setTimeout(r, 1600));
  assert.equal(connects.laptop, beforeClose);
  checks.push("closing the viewing UI cancels recovery");
  assert.deepEqual(writes, []);
  assert.deepEqual(errors, []);
  const report = {
    result: "passed",
    source: "isolated real HTTP/SSE and Edge UI",
    checks,
    connects,
    follows,
    writes,
    errors,
  };
  fs.mkdirSync(path.join(ROOT, "evidence"), { recursive: true });
  fs.writeFileSync(
    path.join(ROOT, "evidence/reconnect-ui.json"),
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report));
} finally {
  await browser.close();
  server.closeAllConnections();
  await new Promise((r) => server.close(r));
}
