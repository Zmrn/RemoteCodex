import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { EventEmitter } from "node:events";
import { Reconnector } from "../public/reconnect.mjs";
import { Bridge } from "../src/bridge.mjs";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (predicate) => {
  for (let i = 0; i < 100 && !predicate(); i++) await sleep(5);
  assert.ok(predicate());
};

test("viewer retry backs off, coalesces triggers, and stops pending work", async () => {
  const delays = [];
  let calls = 0,
    active = 0,
    peak = 0;
  const retry = new Reconnector(
    async (signal) => {
      calls++;
      peak = Math.max(peak, ++active);
      await sleep(10);
      active--;
      if (!signal.aborted && calls < 3) throw Error("offline");
    },
    { delays: [5, 10, 20], onRetry: (delay) => delays.push(delay) },
  );
  retry.request();
  retry.request();
  retry.request();
  await until(() => calls === 3 && !retry.running);
  assert.equal(peak, 1);
  assert.deepEqual(delays, [5, 0, 10, 0, 20, 0]);
  retry.healthy();
  retry.request();
  retry.stop();
  await sleep(30);
  assert.equal(calls, 3);
});

test("stopping an in-flight retry cannot resurrect it", async () => {
  let signal,
    calls = 0;
  const retry = new Reconnector(
    async (value) => {
      signal = value;
      calls++;
      await sleep(20);
      throw Error("offline");
    },
    { delays: [5] },
  );
  retry.request(true);
  await until(() => calls === 1);
  retry.request();
  retry.stop();
  assert.ok(signal.aborted);
  await sleep(40);
  assert.equal(calls, 1);
});

test("bridge retries initial failure and both lost owner pipes; stop cancels reconnect", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "remote-reconnect-"));
  let count = 0,
    follows = 0;
  const factory = () => ({
    ipc: new EventEmitter(),
    tools: new EventEmitter(),
    identity: { officialPid: 123 },
    async connect() {
      if (++count === 1) throw Error("official unavailable");
    },
    close() {
      this.ipc.emit("disconnected", "closed");
    },
  });
  const bridge = new Bridge(dir, { desktopFactory: factory, retryDelays: [5] });
  bridge.follow = async () => {
    follows++;
  };
  bridge.watching.add("fixture");
  try {
    await assert.rejects(bridge.connect(), /unavailable/);
    await until(() => bridge.connected);
    assert.equal(follows, 1);
    bridge.desktop.ipc.emit("disconnected", "lost");
    bridge.desktop.tools.emit("disconnected", "lost");
    assert.equal(bridge.connected, false);
    await until(() => bridge.connected && count === 3);
    assert.equal(follows, 2);
    bridge.desktop.tools.emit("disconnected", "lost");
    bridge.disconnect();
    await sleep(25);
    assert.equal(count, 3);
    assert.equal(bridge.connected, false);
  } finally {
    bridge.disconnect();
    fs.rmSync(dir, { recursive: true });
  }
});

test("late official connect completion after stop is discarded and closed", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "remote-reconnect-"));
  let finish,
    closed = 0;
  const bridge = new Bridge(dir, {
    desktopFactory: () => ({
      connect: () =>
        new Promise((r) => {
          finish = r;
        }),
      close: () => closed++,
    }),
    retryDelays: [5],
  });
  try {
    const pending = bridge.connect();
    bridge.disconnect();
    finish();
    await assert.rejects(pending, /cancelled/);
    await sleep(20);
    assert.equal(bridge.connected, false);
    assert.equal(bridge.reconnector.enabled, false);
    assert.ok(closed >= 2);
  } finally {
    bridge.disconnect();
    fs.rmSync(dir, { recursive: true });
  }
});

test("a follow pending during disconnect cannot broadcast to a replacement owner", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "remote-reconnect-"));
  let finish,
    broadcasts = 0;
  const bridge = new Bridge(dir);
  bridge.connected = true;
  bridge.desktop = {
    owner: () =>
      new Promise((r) => {
        finish = r;
      }),
    close() {},
  };
  try {
    const pending = bridge.follow("fixture");
    bridge.disconnect();
    bridge.desktop = {
      ipc: {
        broadcast() {
          broadcasts++;
        },
      },
      close() {},
    };
    bridge.connected = true;
    finish({ handledByClientId: "old-owner" });
    await assert.rejects(pending, /connection changed/);
    assert.equal(broadcasts, 0);
  } finally {
    bridge.disconnect();
    fs.rmSync(dir, { recursive: true });
  }
});
