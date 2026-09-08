import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { ROOT } from "../src/bridge.mjs";
import { LocalAccess } from "../src/local-access.mjs";
import { validateAccessKey } from "../src/access-key.mjs";
import { pairingKey } from "../src/pairing.mjs";
const listen = (s) => new Promise((r) => s.listen(0, "127.0.0.1", r));
const close = (s) => {
  s.closeAllConnections();
  return new Promise((r) => s.close(r));
};
test("custom keys reject unsafe headers and preserve legacy hex keys", () => {
  assert.equal(validateAccessKey("a".repeat(64)), "a".repeat(64));
  assert.equal(
    validateAccessKey("my-device_secret-123"),
    "my-device_secret-123",
  );
  for (const key of [
    "short",
    "x".repeat(129),
    "contains spaces long",
    "line\nbreaks-secret",
    "非ASCII密钥123456789012345",
  ])
    assert.throws(() => validateAccessKey(key));
});
test("legacy pairing key survives access settings and concurrent reads", async () => {
  const dir = fs.mkdtempSync(path.join(ROOT, "test/scratch/access-legacy-"));
  const key = await pairingKey(dir);
  const access = new LocalAccess(dir, { addresses: () => [] });
  try {
    const values = await Promise.all([
      access.key(),
      access.key(),
      access.save({ enabled: false, host: "", port: 43128 }),
    ]);
    assert.equal(values[0], key);
    assert.equal(values[1], key);
    assert.equal(await access.key(), key);
  } finally {
    access.close();
  }
});
test("closing during pending listener creation leaves no listener", async () => {
  const dir = fs.mkdtempSync(path.join(ROOT, "test/scratch/access-close-"));
  await pairingKey(dir);
  const config = JSON.parse(
    fs.readFileSync(path.join(dir, "remote-access.json")),
  );
  fs.writeFileSync(
    path.join(dir, "remote-access.json"),
    JSON.stringify({
      ...config,
      enabled: true,
      host: "127.0.0.1",
      port: 43128,
    }),
  );
  let finish, entered;
  const ready = new Promise((r) => (entered = r));
  let connectionsClosed = false,
    listenerClosed = false;
  const access = new LocalAccess(dir, {
    addresses: () => ["127.0.0.1"],
    listen: () => {
      entered();
      return new Promise((r) => (finish = r));
    },
  });
  const started = access.start({ localPort: 1, secret: "fixture" });
  await ready;
  access.close();
  finish({
    closeAllConnections() {
      connectionsClosed = true;
    },
    close() {
      listenerClosed = true;
    },
  });
  await started;
  assert.equal(access.server, null);
  assert.equal(access.timer, undefined);
  assert.ok(connectionsClosed && listenerClosed);
  await assert.rejects(access.key(), /已关闭/);
});
test("local listener rotation, failed port change, encrypted persistence and restart", async () => {
  const dir = fs.mkdtempSync(path.join(ROOT, "test/scratch/access-"));
  const local = http.createServer((req, res) => {
    assert.equal(req.headers["x-bridge-csrf"], "test-csrf");
    res.end("{}");
  });
  await listen(local);
  const temp = http.createServer();
  await listen(temp);
  const port = temp.address().port;
  await close(temp);
  const occupied = http.createServer();
  await listen(occupied);
  let access = new LocalAccess(dir, { addresses: () => ["127.0.0.1"] });
  const first = "first-fixture-key-123",
    second = "second-fixture-key-456";
  const request = async (key) => {
    const r = await fetch(`http://127.0.0.1:${port}/bridge/v1/api/status`, {
      headers: { Authorization: "Bearer " + key, Connection: "close" },
    });
    await r.text();
    return r;
  };
  try {
    await access.start({
      localPort: local.address().port,
      secret: "test-csrf",
    });
    assert.equal(access.status().listening, null);
    await access.save({ enabled: true, host: "127.0.0.1", port, key: first });
    assert.equal((await request(first)).status, 200);
    assert.ok(!fs.readFileSync(access.file, "utf8").includes(first));
    await access.save({ enabled: true, host: "127.0.0.1", port, key: second });
    assert.equal((await request(first)).status, 401);
    assert.equal((await request(second)).status, 200);
    await assert.rejects(() =>
      access.save({
        enabled: true,
        host: "127.0.0.1",
        port: occupied.address().port,
        key: first,
      }),
    );
    assert.equal(access.status().port, port);
    assert.equal((await request(second)).status, 200);
    const server = access.server;
    access.close();
    await new Promise((r) => server.close(r));
    access = new LocalAccess(dir, { addresses: () => ["127.0.0.1"] });
    await access.start({
      localPort: local.address().port,
      secret: "test-csrf",
    });
    assert.equal((await request(second)).status, 200);
    await access.save({ enabled: false, host: "127.0.0.1", port });
    assert.equal(access.status().listening, null);
    await assert.rejects(
      () => access.save({ enabled: true, host: "0.0.0.0", port, key: first }),
      /本机已有/,
    );
  } finally {
    access.close();
    await close(local);
    await close(occupied);
  }
});
