import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { Bridge, ROOT } from "../src/bridge.mjs";
import { activeTurnId, conversationView } from "../src/state.mjs";
const id = "77777777-7777-4777-8777-777777777777";
const state = () => ({ threadRuntimeStatus: { type: "active" }, turnHistory: { history: { entitiesByKey: {
  stale: { turnId: "old-turn", status: "inProgress", turnStartedAtMs: 1 },
  current: { turnId: "current-turn", status: "inProgress", turnStartedAtMs: 2 },
} } } });
function fixture(t) {
  fs.mkdirSync(path.join(ROOT, "test/scratch"), { recursive: true });
  const b = new Bridge(fs.mkdtempSync(path.join(ROOT, "test/scratch/interrupt-")));
  t.after(() => clearInterval(b.subscriptionTimer));
  const calls = [];
  b.connected = true;
  b.desktop = {
    identity: { appToolsPipe: { image: "OpenAI.Codex_26.901.6511.0_x64__fixture" } },
    call: async () => ({ thread: { id, kind: "codex", status: { type: "active" } } }),
    ipc: { request: async (...args) => { calls.push(args); return { handledByClientId: "owner", requestId: "official-request", result: { ok: true, interruptedTurnId: "current-turn" } }; } },
  };
  b.follow = async () => {
    b.live.set(id, { owner: "owner", state: state() });
    return { handledByClientId: "owner" };
  };
  return { b, calls };
}
test("user stops an existing non-Probe through the same owner and expected turn exactly once", async t => {
  const { b, calls } = fixture(t);
  assert.equal(Object.hasOwn(b.db.tests, id), false);
  const a = await b.interrupt(id, "stop-request-1", "current-turn");
  const again = await b.interrupt(id, "stop-request-1", "current-turn");
  assert.equal(a.status, "accepted"); assert.equal(again.deduplicated, true);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], ["thread-follower-interrupt-turn",
    { conversationId: id, mode: "user-stop", expectedTurnId: "current-turn" },
    { targetClientId: "owner", timeoutMs: 30000, version: 4 }]);
  assert.equal(b.events.at(-1).kind, "interrupt-requested");
  assert.equal(b.live.get(id).state.threadRuntimeStatus.type, "active", "ack must not fabricate completed state");
  assert.equal(b.status().interrupt.supported, true);
});
test("stale stop cannot interrupt a newer turn, but rejected preflight can be retried", async t => {
  const { b, calls } = fixture(t);
  await assert.rejects(() => b.interrupt(id, "stale-stop-1", "old-turn"), /轮次已变化/);
  assert.equal(b.db.requests["stale-stop-1"].status, "rejected"); assert.equal(calls.length, 0);
  await b.interrupt(id, "current-stop-1", "current-turn"); assert.equal(calls.length, 1);
});
test("idle owner, wrong owner, Chat and disconnected state reject stop before dispatch", async t => {
  for (const kind of ["idle", "wrong-owner", "chat", "disconnect"]) {
    const { b, calls } = fixture(t);
    const follow = b.follow;
    b.follow = async () => {
      const o = await follow();
      if (kind === "idle") b.live.get(id).state.threadRuntimeStatus.type = "idle";
      if (kind === "wrong-owner") b.live.get(id).owner = "someone-else";
      if (kind === "disconnect") b.connected = false;
      return o;
    };
    if (kind === "chat") b.desktop.call = async () => ({ thread: { id, kind: "chatgpt" } });
    await assert.rejects(() => b.interrupt(id, "reject-stop-" + kind, "current-turn"));
    assert.equal(calls.length, 0, kind);
  }
});
test("connection replacement during follow rejects before stop", async t => {
  const { b, calls } = fixture(t), follow = b.follow;
  b.follow = async () => { const o = await follow(); b.desktop = { ...b.desktop }; return o; };
  await assert.rejects(() => b.interrupt(id, "replace-stop", "current-turn"), /尚未确认/);
  assert.equal(calls.length, 0);
});
test("lost or mismatched owner acknowledgement remains unknown and is not resent after restart", async t => {
  for (const wrongOwner of [false, true]) {
    const { b } = fixture(t); let calls = 0;
    b.desktop.ipc.request = async () => { calls++; if (wrongOwner) return { handledByClientId: "other" }; throw Error("connection-interrupted after dispatch"); };
    await assert.rejects(() => b.interrupt(id, "uncertain-stop", "current-turn"));
    const restart = new Bridge(b.dataDir);
    t.after(() => clearInterval(restart.subscriptionTimer));
    restart.connected = true; restart.desktop = b.desktop;
    const result = await restart.interrupt(id, "uncertain-stop", "current-turn");
    assert.equal(result.status, "outcome-unknown"); assert.equal(result.deduplicated, true); assert.equal(calls, 1);
  }
});
test("compact history exposes current owner turn even if that turn is outside the page", () => {
  const s = state(), page = { data: { turns: [] }, live: { state: s } };
  assert.equal(conversationView(page).live.activeTurnId, "current-turn");
  assert.equal(conversationView(page).live.state.turnHistory, undefined);
  s.threadRuntimeStatus.type = "idle"; assert.equal(activeTurnId(s), null);
  s.threadRuntimeStatus.type = "active"; s.turnHistory.history.entitiesByKey.current.status = "completed";
  assert.equal(activeTurnId(s), null, "must not fall back to an old inProgress turn");
});
