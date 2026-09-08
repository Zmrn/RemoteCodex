import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { gunzipSync } from "node:zlib";
import { EventEmitter } from "node:events";
import { ROOT } from "../src/bridge.mjs";
import { startServer } from "../src/server.mjs";
import { startRemoteListener, proxyAgent } from "../src/remote.mjs";
const close = (s) => {
  s.closeAllConnections();
  return new Promise((r) => s.close(r));
};
const raw = (url, headers = {}) =>
  new Promise((resolve, reject) => {
    http
      .get(url, { headers }, (res) => {
        const chunks = [];
        res.on("data", (b) => chunks.push(b));
        res.on("end", () =>
          resolve({ headers: res.headers, bytes: Buffer.concat(chunks) }),
        );
        res.on("error", reject);
      })
      .on("error", reject);
  });
function fixture() {
  const b = new EventEmitter();
  b.dataDir = fs.mkdtempSync(path.join(ROOT, "test/scratch/transport-"));
  fs.writeFileSync(
    path.join(b.dataDir, "update-settings.json"),
    '{"automatic":false}',
  );
  b.connect = async () => {};
  b.status = () => ({ connected: true });
  b.disconnect = () => {
    b.disconnected = true;
  };
  return b;
}
test("large JSON is compressed across both proxy hops; compact view preserves messages and questions", async () => {
  const b = fixture(),
    text = "verbatim text and image metadata ".repeat(20000);
  const turns = [
    {
      id: "turn",
      items: [
        {
          id: "message",
          text,
          bridgeDisplay: { images: [{ id: "image-id" }] },
        },
      ],
    },
  ];
  const state = {
    latestThreadSettings: { model: "fixture" },
    latestModel: "fixture",
    requests: [
      {
        id: "q",
        method: "item/tool/requestUserInput",
        params: { questions: [{ id: "color", question: "color?" }] },
      },
    ],
    turnHistory: {
      history: { entitiesByKey: { turn: { items: turns[0].items } } },
    },
  };
  b.read = async () => ({
    data: { thread: { id: "test" }, turns },
    live: { state, revision: 4, status: { type: "running", confirmed: true } },
  });
  const local = await startServer({ port: 0, bridge: b });
  const key = "test-only-transport-access-key-0123456789";
  const remote = await startRemoteListener({
    host: "127.0.0.1",
    port: 0,
    key,
    localPort: local.server.address().port,
    secret: local.secret,
  });
  const agents = {
    get: () => ({ host: "100.70.8.9", port: remote.address().port }),
    key: async () => key,
  };
  const proxy = http.createServer((req, res) =>
    proxyAgent(req, res, agents, "test", req.url, async () => "127.0.0.1"),
  );
  await new Promise((r) => proxy.listen(0, "127.0.0.1", r));
  const url = "http://127.0.0.1:" + proxy.address().port + "/api/threads/test";
  try {
    const compressed = await raw(url + "?view=conversation", {
      "accept-encoding": "gzip",
    });
    assert.equal(compressed.headers["content-encoding"], "gzip");
    const data = JSON.parse(gunzipSync(compressed.bytes));
    assert.deepEqual(data.data.turns, turns);
    assert.deepEqual(data.live.state.requests, state.requests);
    assert.deepEqual(
      data.live.state.latestThreadSettings,
      state.latestThreadSettings,
    );
    assert.equal(data.live.status.confirmed, true);
    assert.equal(data.live.state.turnHistory, undefined);
    assert.ok(
      compressed.bytes.length < Buffer.byteLength(JSON.stringify(data)) / 20,
    );
    const legacy = await raw(url);
    assert.equal(legacy.headers["content-encoding"], undefined);
    assert.deepEqual(JSON.parse(legacy.bytes).live.state, state);
    const noGzip = await raw(url, { "accept-encoding": "gzip;q=0" });
    assert.equal(noGzip.headers["content-encoding"], undefined);
  } finally {
    await close(proxy);
    await close(remote);
    await close(local.server);
  }
});
test("canceling a slow view closes both relay hops without a task write or bridge disconnect", async () => {
  let started,
    closed,
    writes = 0;
  const ready = new Promise((r) => (started = r)),
    gone = new Promise((r) => (closed = r));
  const backend = http.createServer((req, res) => {
    if (req.method !== "GET") writes++;
    res.on("close", closed);
    started();
  });
  await new Promise((r) => backend.listen(0, "127.0.0.1", r));
  const key = "test-only-transport-access-key-0123456789";
  const remote = await startRemoteListener({
    host: "127.0.0.1",
    port: 0,
    key,
    localPort: backend.address().port,
    secret: "fixture",
  });
  const proxy = http.createServer((req, res) =>
    proxyAgent(
      req,
      res,
      {
        get: () => ({ host: "100.70.8.9", port: remote.address().port }),
        key: async () => key,
      },
      "test",
      req.url,
      async () => "127.0.0.1",
    ),
  );
  await new Promise((r) => proxy.listen(0, "127.0.0.1", r));
  try {
    const abort = new AbortController();
    const pending = fetch(
      "http://127.0.0.1:" + proxy.address().port + "/api/threads/test",
      { signal: abort.signal },
    ).catch((e) => e.name);
    await ready;
    abort.abort();
    assert.equal(await pending, "AbortError");
    await Promise.race([
      gone,
      new Promise((_, reject) => {
        const t = setTimeout(() => reject(Error("relay did not close")), 2000);
        t.unref();
      }),
    ]);
    assert.equal(writes, 0);
  } finally {
    await close(proxy);
    await close(remote);
    await close(backend);
  }
});
test("stop releases a pending content request and SSE instead of waiting indefinitely for HTTP close", async () => {
  const b = fixture();
  let started;
  const ready = new Promise((r) => (started = r));
  b.read = () => {
    started();
    return new Promise(() => {});
  };
  const { server, address, secret } = await startServer({ port: 0, bridge: b });
  const headers = { "X-Bridge-CSRF": secret };
  const stream = await fetch(address + "/api/events", { headers });
  const reader = stream.body.getReader();
  await reader.read();
  const pending = fetch(address + "/api/threads/test", { headers }).catch(
    () => {},
  );
  try {
    await ready;
    const closed = new Promise((r) => server.once("close", r));
    const stopped = await fetch(address + "/api/stop", {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: "{}",
    });
    assert.equal((await stopped.json()).officialTasksUnaffected, true);
    await Promise.race([
      closed,
      new Promise((_, reject) => {
        const t = setTimeout(() => reject(Error("server did not close")), 2000);
        t.unref();
      }),
    ]);
    await pending;
    assert.equal(b.disconnected, true);
  } finally {
    await reader.cancel().catch(() => {});
    await close(server);
  }
});
