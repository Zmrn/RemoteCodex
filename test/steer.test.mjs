import { fixtureEvidence } from "./fixtures/interface-evidence.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Bridge } from "../src/bridge.mjs";
import { startServer } from "../src/server.mjs";
const id = "88888888-8888-4888-8888-888888888888";
const images = JSON.parse(fs.readFileSync(new URL("../src/probe-images.json", import.meta.url)));
function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bridge-steer-"));
  const b = new Bridge(dir), calls = [];
  const state = { kind: "codex", type: "active", turnId: "current-turn", owner: "owner" };
  b.connected = true;
  b.desktop = {
    identity: { appToolsPipe: { image: "OpenAI.Codex_26.903.8094.0_x64__fixture" } },
    close() {}, catalog: [],
    call: async name => { assert.equal(name, "read_thread"); return { thread: { id, kind: state.kind,
      cwd: "C:/fixture", status: { type: state.type } } }; },
    ipc: { request: async (method, params, options) => {
      calls.push({ method, params, options });
      assert.equal(b.db.requests[params.clientUserMessageId].status, "outcome-unknown");
      return { handledByClientId: "owner", result: { result: { turnId: "current-turn" } } };
    } },
  };
  fixtureEvidence(b.desktop);
  b.follow = async () => {
    b.live.set(id, { owner: state.owner, state: { threadRuntimeStatus: { type: state.type },
      turns: [{ turnId: state.turnId, status: "inProgress" }] } });
    return { handledByClientId: "owner" };
  };
  b.connect = async () => b.status();
  b.disconnect = () => {};
  fs.writeFileSync(path.join(dir, "update-settings.json"), '{"automatic":false}');
  t.after(() => { clearInterval(b.subscriptionTimer); fs.rmSync(dir, { recursive: true, force: true }); });
  return { b, dir, calls, state };
}
test("direct steering carries text and all images to the current owner without touching the queue", async t => {
  const { b, calls } = fixture(t);
  const send = () => b.nativeSteer(id, "steer-direct-001", "synthetic direction", images, "current-turn");
  const results = await Promise.all([send(), send()]);
  assert.ok(results.every(r => r.status === "accepted"));
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, "thread-follower-steer-turn");
  assert.deepEqual(calls[0].options, { targetClientId: "owner", timeoutMs: 60000, version: 1 });
  assert.equal(calls[0].params.conversationId, id);
  assert.equal(calls[0].params.input[0].text, "synthetic direction");
  assert.deepEqual(calls[0].params.input.slice(1).map(i => i.url), images);
  assert.equal(calls[0].params.restoreMessage.id, "steer-direct-001");
  assert.equal(calls[0].params.restoreMessage.context.prompt, "synthetic direction");
  assert.equal(b.live.get(id).state.threadRuntimeStatus.type, "active");
  const persisted = fs.readFileSync(b.stateFile, "utf8");
  assert.ok(!persisted.includes("synthetic direction") && !persisted.includes("base64,"));
  assert.equal((await send()).deduplicated, true);
});
test("ended/changed turn, wrong owner, Chat and replaced connection reject before dispatch", async t => {
  for (const change of ["ended", "changed", "owner", "chat", "connection"]) {
    const { b, calls, state } = fixture(t), follow = b.follow;
    if (change === "chat") state.kind = "chatgpt";
    b.follow = async () => {
      if (change === "ended") state.type = "idle";
      if (change === "changed") state.turnId = "new-turn";
      if (change === "owner") state.owner = "someone-else";
      const result = await follow();
      if (change === "connection") b.desktop = { ...b.desktop };
      return result;
    };
    await assert.rejects(b.nativeSteer(id, "steer-reject-001", "probe", [], "current-turn"));
    assert.equal(calls.length, 0, change);
    assert.equal(b.db.requests["steer-reject-001"].status, "rejected");
  }
});
test("lost, wrong-owner and wrong-turn acknowledgements stay unknown across restart without replay", async t => {
  for (const outcome of ["lost", "owner", "turn"]) {
    const { b, dir } = fixture(t); let attempts = 0;
    b.desktop.ipc.request = async () => {
      attempts++;
      if (outcome === "lost") throw Error("pipe lost");
      return { handledByClientId: outcome === "owner" ? "other" : "owner",
        result: { result: { turnId: outcome === "turn" ? "next-turn" : "current-turn" } } };
    };
    await assert.rejects(b.nativeSteer(id, "steer-unknown-1", "probe", images, "current-turn"));
    const restart = new Bridge(dir); t.after(() => clearInterval(restart.subscriptionTimer));
    restart.connected = true; restart.desktop = b.desktop;
    const result = await restart.nativeSteer(id, "steer-unknown-1", "probe", images, "current-turn");
    assert.equal(result.status, "outcome-unknown"); assert.equal(attempts, 1);
  }
});
test("HTTP steering uses the existing authenticated message route and retains recovery until accepted", async t => {
  const { b, calls, state } = fixture(t);
  let cleared = 0; b.queue.clearRecovery = () => cleared++;
  const { server, address, secret } = await startServer({ port: 0, bridge: b });
  try {
    const body = { mode: "codex", delivery: "steer", expectedTurnId: "current-turn",
      requestId: "http-steer-001", prompt: "HTTP direction", imageDataUrls: images };
    const post = (value, authenticated = true) => fetch(address + "/api/threads/" + id + "/messages", {
      method: "POST", headers: { "Content-Type": "application/json", ...(authenticated ? { "X-Bridge-CSRF": secret } : {}) }, body: JSON.stringify(value),
    });
    assert.equal((await post(body, false)).status, 403);
    for (const bad of [{ mode: "chat" }, { delivery: "unknown" }, { expectedTurnId: null }, { settings: {} }, { imageDataUrls: ["invalid"] }])
      assert.equal((await post({ ...body, ...bad })).status, 400);
    state.type = "idle";
    assert.equal((await post(body)).status, 400);
    assert.equal(cleared, 0); assert.equal(calls.length, 0);
    state.type = "active";
    assert.equal((await (await post(body)).json()).status, "accepted");
    assert.equal(calls.length, 1); assert.equal(cleared, 1);
    assert.equal((await (await post(body)).json()).deduplicated, true);
    assert.equal(calls.length, 1);
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});
