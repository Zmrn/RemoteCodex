import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { ROOT } from "../src/bridge.mjs";
import {
  Agents,
  validateEndpoint,
  resolveAgent,
  isTailAddress,
} from "../src/agents.mjs";
import {
  allowedRoute,
  startRemoteListener,
  proxyAgent,
} from "../src/remote.mjs";
const temp = () => fs.mkdtempSync(path.join(ROOT, "test/scratch/agents-"));
fs.mkdirSync(path.join(ROOT, "test/scratch"), { recursive: true });
const listen = (s) =>
  new Promise((resolve) => s.listen(0, "127.0.0.1", resolve));
const close = (s) => {
  s.closeAllConnections();
  return new Promise((r) => s.close(r));
};
test("agent names, selection and DPAPI keys persist; keys never appear in public listing", async () => {
  const dir = temp(),
    key = randomBytes(32).toString("hex");
  let a = new Agents(dir);
  await a.save({ id: "local", name: "开发机" });
  await a.save({ name: "工作电脑", host: "100.70.8.9", port: 43128, key });
  const id = a.list().agents.find((a) => a.kind === "remote").id;
  await a.select(id);
  a = new Agents(dir);
  assert.equal(a.list().selectedId, id);
  assert.equal(a.get("local").name, "开发机");
  assert.equal(await a.key(id), key);
  assert.ok(!JSON.stringify(a.list()).includes(key));
  assert.ok(!fs.readFileSync(a.file, "utf8").includes(key));
  await a.save({ id, name: "改名后", host: "100.70.8.9", port: 43128 });
  assert.equal(await a.key(id), key);
  await a.save({ id, name: "另一地址", host: "100.70.8.10", port: 43128 });
  assert.equal(a.list().agents.find((a) => a.id === id).hasKey, false);
  await assert.rejects(() => a.key(id), /连接密钥/);
  await a.remove(id);
  assert.equal(a.list().selectedId, "local");
  await assert.rejects(() => a.remove("local"), /不能移除/);
});
test("endpoint validation rejects public, loopback, URL paths, fake tailnet and invalid ports", async () => {
  for (const host of [
    "127.0.0.1",
    "8.8.8.8",
    "192.168.1.1",
    "http://100.70.8.9",
    "100.70.8.9/path",
    "pc.ts.net.evil.test",
    "100.128.0.1",
    "0.0.0.0",
  ])
    assert.throws(() => validateEndpoint(host, 43128));
  for (const port of [0, 65536, "1x", 1.2])
    assert.throws(() => validateEndpoint("100.70.8.9", port));
  assert.equal(
    validateEndpoint(" pc.tail123.ts.net ", 43128).host,
    "pc.tail123.ts.net",
  );
  assert.equal(isTailAddress("fd7a:115c:a1e0::1234"), true);
  await assert.rejects(() => resolveAgent("127.0.0.1"), /未解析/);
  assert.equal(allowedRoute("POST", "/api/stop"), false);
  assert.equal(allowedRoute("POST", "/api/agents"), false);
  assert.equal(allowedRoute("POST", "/api/pairing-key"), false);
});
test("authenticated two-hop transport forwards exact writes, SSE and original bytes, never retries lost writes", async () => {
  const secret = "test-only-csrf",
    key = randomBytes(32).toString("hex"),
    binary = randomBytes(1024);
  let writes = 0;
  const local = http.createServer(async (req, res) => {
    assert.equal(req.headers["x-bridge-csrf"], secret);
    if (req.url === "/api/events") {
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.write('data: {"kind":"running"}\n\n');
      res.end('data: {"kind":"completed"}\n\n');
      return;
    }
    if (req.url.includes("/file?")) {
      res.end(binary);
      return;
    }
    if (req.url === "/api/usage") {
      res.setHeader("content-type", "application/json");
      res.end(
        JSON.stringify({
          source: "test fixture only",
          weekly: [{ limitId: "codex", remainingPercent: 37 }],
        }),
      );
      return;
    }
    if (req.method === "POST") {
      writes++;
      let b = "";
      for await (const c of req) b += c;
      const body = JSON.parse(b);
      if (body.drop) {
        req.socket.destroy();
        return;
      }
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify(body));
      return;
    }
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ connected: true, source: "test fixture only" }));
  });
  await listen(local);
  const remote = await startRemoteListener({
    host: "127.0.0.1",
    port: 0,
    key,
    localPort: local.address().port,
    secret,
  });
  const agent = {
    get: () => ({ host: "100.70.8.9", port: remote.address().port }),
    key: async () => key,
  };
  const controller = http.createServer((req, res) =>
    proxyAgent(req, res, agent, "test", req.url, async () => "127.0.0.1"),
  );
  await listen(controller);
  const endpoint = "http://127.0.0.1:" + remote.address().port,
    via = "http://127.0.0.1:" + controller.address().port;
  try {
    let r = await fetch(endpoint + "/bridge/v1/api/status");
    assert.equal(r.status, 401);
    r = await fetch(endpoint + "/bridge/v1/api/status", {
      headers: {
        Authorization: "Bearer " + key,
        Origin: "https://evil.example",
      },
    });
    assert.equal(r.status, 401);
    r = await fetch(endpoint + "/bridge/v1/api/stop", {
      method: "POST",
      headers: { Authorization: "Bearer " + key },
    });
    assert.equal(r.status, 404);
    const body = {
      requestId: "test-same-request",
      prompt: "你好",
      imageDataUrl: "data:image/png;base64," + binary.toString("base64"),
    };
    r = await fetch(via + "/api/usage");
    assert.equal(r.status, 200);
    assert.deepEqual((await r.json()).weekly, [
      { limitId: "codex", remainingPercent: 37 },
    ]);
    r = await fetch(via + "/api/threads/probe/messages", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    assert.deepEqual(await r.json(), body);
    assert.equal(writes, 1);
    r = await fetch(via + "/api/threads/probe/file?name=image.png");
    assert.deepEqual(Buffer.from(await r.arrayBuffer()), binary);
    r = await fetch(via + "/api/events");
    assert.equal(
      await r.text(),
      'data: {"kind":"running"}\n\ndata: {"kind":"completed"}\n\n',
    );
    r = await fetch(via + "/api/threads/probe/messages", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ drop: true }),
    });
    assert.equal(r.status, 502);
    assert.equal((await r.json()).confirmed, false);
    assert.equal(writes, 2);
    await assert.rejects(
      () =>
        startRemoteListener({
          host: "0.0.0.0",
          port: 0,
          key,
          localPort: 1,
          secret,
        }),
      /Tailscale/,
    );
  } finally {
    await close(controller);
    await close(remote);
    await close(local);
  }
});
