import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { Bridge, ROOT } from "../src/bridge.mjs";
import { encode, Pipe } from "../src/transport.mjs";
import { applyPatches, runtimeStatus } from "../src/state.mjs";
import { resolveFile, saveUpload } from "../src/files.mjs";
import { startServer } from "../src/server.mjs";
import { assertProbeTarget } from "../src/probe-safety.mjs";
const root = path.join(ROOT, "test", "scratch");
fs.mkdirSync(root, { recursive: true });
test("user may continue development task; automated Probes and unsupported builds stay guarded", (t) => {
  const PROTECTED = "55555555-5555-4555-8555-555555555555";
  const previous = process.env.REMOTE_BRIDGE_DEVELOPMENT_THREAD_ID;
  process.env.REMOTE_BRIDGE_DEVELOPMENT_THREAD_ID = PROTECTED;
  t.after(() => {
    if (previous === undefined)
      delete process.env.REMOTE_BRIDGE_DEVELOPMENT_THREAD_ID;
    else process.env.REMOTE_BRIDGE_DEVELOPMENT_THREAD_ID = previous;
  });
  const b = new Bridge(fs.mkdtempSync(path.join(root, "guard-")));
  const old = "11111111-1111-4111-8111-111111111111",
    probe = "22222222-2222-4222-8222-222222222222";
  b.db.tests[PROTECTED] = {};
  assert.throws(() => b.guard(PROTECTED), /Unsupported desktop build/);
  assert.throws(() => b.guard("malformed"), /Invalid official task ID/);
  b.db.tests[probe] = {};
  assert.throws(() => b.guard(old), /Unsupported desktop build/);
  b.desktop = {
    identity: { appToolsPipe: { image: "OpenAI.Codex_99.0.0.0_x64__" } },
  };
  assert.throws(() => b.guard(probe), /Unsupported desktop build/);
  b.desktop.identity.appToolsPipe.image = "OpenAI.Codex_26.901.6511.0_x64__";
  assert.doesNotThrow(() => b.guard(old));
  assert.doesNotThrow(() => b.guard(PROTECTED));
  assert.throws(() => b.guardProbe(PROTECTED), /protected/);
  assert.throws(() => assertProbeTarget(b.status(), PROTECTED), /protected/);
  assert.deepEqual(b.status().readOnlyThreadIds, []);
  assert.ok(b.status().testExcludedThreadIds.includes(PROTECTED));
  assert.doesNotThrow(() => b.guardProbe(probe));
  assert.throws(() => b.guardProbe(old), /仅适用/);
});
test("unknown mutation persists and is never automatically retried after restart", async () => {
  const dir = fs.mkdtempSync(path.join(root, "journal-"));
  let b = new Bridge(dir),
    calls = 0;
  await assert.rejects(() =>
    b.once("request-0001", "send", { id: 1 }, async () => {
      calls++;
      throw Error("socket dropped after dispatch");
    }),
  );
  b = new Bridge(dir);
  const r = await b.once("request-0001", "send", { id: 1 }, async () => {
    calls++;
  });
  assert.equal(calls, 1);
  assert.equal(r.status, "outcome-unknown");
  assert.equal(r.deduplicated, true);
  await assert.rejects(
    () => b.once("request-0001", "send", { id: 2 }, async () => {}),
    /different content/,
  );
});
test("framing handles split/coalesced UTF-8 responses", () => {
  const p = new Pipe("unused", "desktop"),
    got = [];
  p.on("frame", (f) => got.push(f));
  const a = encode({ type: "broadcast", text: "测试图片" }),
    b = encode({ type: "broadcast", n: 2 }),
    all = Buffer.concat([a, b]);
  p.data(all.subarray(0, 3));
  p.data(all.subarray(3, 16));
  p.data(all.subarray(16));
  assert.equal(got.length, 2);
  assert.equal(got[0].text, "测试图片");
});
test("canonical runtime and disconnect states; patches reject prototype mutation", () => {
  const state = {
    threadRuntimeStatus: { type: "active" },
    turnHistory: {
      history: {
        entitiesByKey: { one: { status: "completed", turnStartedAtMs: 1 } },
      },
    },
  };
  assert.equal(runtimeStatus(state).type, "running");
  assert.deepEqual(runtimeStatus(state, false), {
    type: "connection-interrupted",
    confirmed: false,
  });
  state.threadRuntimeStatus.type = "idle";
  assert.equal(runtimeStatus(state).type, "idle");
  for (const type of ["notLoaded", "unrecognized"]) {
    state.threadRuntimeStatus.type = type;
    assert.deepEqual(runtimeStatus(state), {
      type: "unknown",
      confirmed: false,
    });
  }
  assert.deepEqual(runtimeStatus(null), { type: "unknown", confirmed: false });
  state.threadRuntimeStatus = {
    type: "active",
    activeFlags: ["waitingOnApproval"],
  };
  assert.equal(runtimeStatus(state).type, "waiting-approval");
  state.threadRuntimeStatus.activeFlags = ["waitingOnUserInput"];
  assert.equal(runtimeStatus(state).type, "waiting-user-input");
  state.threadRuntimeStatus = { type: "idle" };
  state.turnHistory.history.entitiesByKey.one.status = "failed";
  assert.equal(runtimeStatus(state).type, "idle");
  state.turnHistory.history.entitiesByKey.one.status = "interrupted";
  assert.equal(runtimeStatus(state).type, "idle");
  state.requests = [{ method: "requestApproval" }, { method: "requestUserInput" }];
  state.threadRuntimeStatus.activeFlags = ["waitingOnApproval"];
  assert.equal(runtimeStatus(state).type, "idle", "pending records and stale flags cannot override idle");
  state.threadRuntimeStatus = { type: "active", activeFlags: [] };
  assert.equal(runtimeStatus(state).type, "running", "request method guesses cannot override runtime flags");
  assert.throws(
    () => applyPatches({}, [{ op: "add", path: ["__proto__", "x"], value: 1 }]),
    /Invalid/,
  );
  assert.deepEqual(
    applyPatches({ x: [1, 2] }, [{ op: "add", path: ["x", 1], value: 3 }]),
    { x: [1, 3, 2] },
  );
});
test("attachment download rejects traversal and uploads keep original bytes", () => {
  const dir = fs.mkdtempSync(path.join(root, "files-"));
  fs.writeFileSync(path.join(dir, "ok.txt"), "ok");
  assert.throws(() => resolveFile(dir, "../bridge-state.json"), /outside/);
  assert.equal(fs.readFileSync(resolveFile(dir, "ok.txt"), "utf8"), "ok");
  const bytes = fs.readFileSync(path.join(ROOT, "fixtures/vision-probe.png"));
  const saved = saveUpload(
    dir,
    "data:image/png;base64," + bytes.toString("base64"),
  );
  assert.deepEqual(fs.readFileSync(saved.path), bytes);
  assert.throws(
    () =>
      saveUpload(
        dir,
        "data:image/png;base64," + Buffer.alloc(16).toString("base64"),
      ),
    /signature/,
  );
});
test("HTTP is loopback only and rejects cross-origin or missing CSRF", async () => {
  const fake = {
    on() {},
    off() {},
    connect: async () => {},
    status: () => ({ connected: true }),
    disconnect() {},
  };
  const { server, secret, address } = await startServer({
    port: 0,
    bridge: fake,
  });
  try {
    assert.equal(server.address().address, "127.0.0.1");
    let r = await fetch(address + "/api/status");
    assert.equal(r.status, 403);
    r = await fetch(address + "/api/status", {
      headers: { "X-Bridge-CSRF": secret, Origin: "https://evil.example" },
    });
    assert.equal(r.status, 403);
    r = await fetch(address + "/api/status", {
      headers: { "X-Bridge-CSRF": secret },
    });
    assert.equal(r.status, 200);
    r = await fetch(address + "/");
    assert.match(await r.text(), /Remote Bridge/);
  } finally {
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
  }
});
