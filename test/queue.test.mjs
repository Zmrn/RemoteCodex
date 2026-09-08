import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { Bridge, ROOT } from "../src/bridge.mjs";
import {
  OfficialQueue,
  composeQueuedMessage,
  queueRevision,
} from "../src/queue.mjs";
const id = "66666666-6666-4666-8666-666666666666",
  owner = "official-test-owner";
function fixture(taskId = id) {
  const id = taskId;
  fs.mkdirSync(path.join(ROOT, "test/scratch"), { recursive: true });
  const b = new Bridge(fs.mkdtempSync(path.join(ROOT, "test/scratch/queue-")));
  const file = path.join(b.dataDir, "official-state-fixture.json");
  fs.writeFileSync(file, JSON.stringify({ "queued-follow-ups": {} }));
  const q = (b.queue = new OfficialQueue(b, file));
  b.connected = true;
  b.owners = new Map([[id, owner]]);
  b.watching.add(id);
  b.follow = async () => ({ handledByClientId: owner });
  let active = true;
  const requests = [];
  b.codexThread = async () => ({
    thread: {
      id,
      cwd: "C:/Probe",
      kind: "codex",
      status: { type: active ? "active" : "idle" },
    },
  });
  b.desktop = {
    identity: { appToolsPipe: { image: "OpenAI.Codex_26.901.6511.0_x64__" } },
    ipc: {
      request: async (method, params, opts) => {
        requests.push({ method, params, opts });
        if (method === "thread-follower-set-queued-follow-ups-state") {
          q.frame({
            type: "broadcast",
            method: "thread-queued-followups-changed",
            sourceClientId: owner,
            params: { conversationId: id, messages: params.state[id] },
          });
          return { handledByClientId: owner, result: { ok: true } };
        }
        return {
          handledByClientId: owner,
          result: { result: { turnId: "existing-turn" } },
        };
      },
    },
  };
  return { b, q, file, requests, setActive: (v) => (active = v) };
}
test("queue bootstrap is disk only; live owner snapshot wins over delayed disk; unknown stays unknown", () => {
  const { b, q, file } = fixture();
  b.owners.clear();
  assert.equal(q.read(id).confirmed, false);
  assert.deepEqual(q.read(id).messages, []);
  b.owners.set(id, owner);
  const msg = composeQueuedMessage("queued-001", "hello", "C:/Probe");
  fs.writeFileSync(
    file,
    JSON.stringify({ "queued-follow-ups": { [id]: [msg] } }),
  );
  q.frame({
    type: "broadcast",
    method: "thread-queued-followups-changed",
    sourceClientId: "wrong-owner",
    params: { conversationId: id, messages: [] },
  });
  assert.equal(q.read(id).messages.length, 1);
  q.frame({
    type: "broadcast",
    method: "thread-queued-followups-changed",
    sourceClientId: owner,
    params: { conversationId: id, messages: [] },
  });
  assert.equal(q.read(id).messages.length, 0);
  assert.equal(q.read(id).confirmed, true);
  q.clear();
  fs.writeFileSync(file, "bad-json");
  assert.throws(() => q.read(id));
  b.connected = false;
  assert.throws(() => q.read(id), /connection-interrupted/);
});
test("enqueue targets the official owner once and revisions fail closed", async () => {
  const { q, requests } = fixture();
  const body = {
    action: "enqueue",
    prompt: "hello",
    revision: queueRevision([]),
  };
  await q.mutate(id, "enqueue-001", body);
  await q.mutate(id, "enqueue-001", { ...body, revision: q.read(id).revision });
  assert.equal(requests.length, 1);
  assert.equal(requests[0].opts.targetClientId, owner);
  assert.equal(requests[0].opts.version, 1);
  await assert.rejects(() => q.mutate(id, "enqueue-002", body), /队列已经变化/);
  assert.equal(requests.length, 1);
  assert.deepEqual(Object.keys(requests[0].params.state), [id]);
  await q.mutate(id, "enqueue-002", { ...body, revision: q.read(id).revision });
  assert.equal(requests.length, 2);
});

test("development task queue is writable through the same owner path (isolated fixture)", async (t) => {
  const PROTECTED = "55555555-5555-4555-8555-555555555555";
  const previous = process.env.REMOTE_BRIDGE_DEVELOPMENT_THREAD_ID;
  process.env.REMOTE_BRIDGE_DEVELOPMENT_THREAD_ID = PROTECTED;
  t.after(() => {
    if (previous === undefined)
      delete process.env.REMOTE_BRIDGE_DEVELOPMENT_THREAD_ID;
    else process.env.REMOTE_BRIDGE_DEVELOPMENT_THREAD_ID = previous;
  });
  const { b, q, requests } = fixture(PROTECTED);
  const result = await q.mutate(PROTECTED, "development-user-001", {
    action: "enqueue",
    prompt: "mock user message",
    revision: queueRevision([]),
  });
  assert.equal(result.status, "accepted");
  assert.equal(requests.length, 1);
  assert.equal(requests[0].params.conversationId, PROTECTED);
  assert.equal(requests[0].opts.targetClientId, owner);
  assert.throws(() => b.guardProbe(PROTECTED), /protected/);
});
test("take stores a durable image draft before removal; active-turn end returns draft without steering", async () => {
  const f = fixture(),
    { q, b, requests } = f;
  const data = "data:image/png;base64,AAAA";
  await q.mutate(id, "enqueue-003", {
    action: "enqueue",
    prompt: "image draft",
    imageDataUrl: data,
    revision: q.read(id).revision,
  });
  const result = await q.mutate(id, "take-0001", {
    action: "take",
    messageId: "enqueue-003",
    revision: q.read(id).revision,
  });
  assert.equal(result.result.draft.imageDataUrl, data);
  assert.equal(q.read(id).messages.length, 0);
  assert.equal(
    JSON.parse(fs.readFileSync(b.stateFile)).queueRecoveries["take-0001"].state,
    "draft",
  );
  await q.mutate(id, "enqueue-004", {
    action: "enqueue",
    prompt: "steer",
    revision: q.read(id).revision,
  });
  let calls = 0;
  b.codexThread = async () => ({
    thread: {
      id,
      cwd: "C:/Probe",
      status: { type: ++calls === 1 ? "active" : "idle" },
    },
  });
  const ended = await q.mutate(id, "steer-0001", {
    action: "steer",
    messageId: "enqueue-004",
    revision: q.read(id).revision,
  });
  assert.equal(ended.result.disposition, "draft");
  assert.equal(
    requests.some((r) => r.method === "thread-follower-steer-turn"),
    false,
  );
});
test("steer acknowledgement uses same turn; uncertain steering is saved and never retried", async () => {
  const { q, b, requests } = fixture();
  await q.mutate(id, "enqueue-005", {
    action: "enqueue",
    prompt: "steer me",
    revision: q.read(id).revision,
  });
  const result = await q.mutate(id, "steer-0002", {
    action: "steer",
    messageId: "enqueue-005",
    revision: q.read(id).revision,
  });
  assert.equal(result.result.turnId, "existing-turn");
  assert.equal(requests.at(-1).params.clientUserMessageId, "enqueue-005");
  assert.equal(q.read(id).messages.length, 0);
  await q.mutate(id, "enqueue-006", {
    action: "enqueue",
    prompt: "uncertain",
    revision: q.read(id).revision,
  });
  const request = b.desktop.ipc.request;
  b.desktop.ipc.request = async (...args) => {
    if (args[0] === "thread-follower-steer-turn") {
      requests.push({ method: args[0] });
      throw Error("outcome-unknown");
    }
    return request(...args);
  };
  const body = {
    action: "steer",
    messageId: "enqueue-006",
    revision: q.read(id).revision,
  };
  const unknown = await q.mutate(id, "steer-0003", body);
  assert.equal(unknown.result.disposition, "steer-unknown");
  const count = requests.length;
  await q.mutate(id, "steer-0003", body);
  assert.equal(requests.length, count);
  assert.equal(q.read(id).recoveries[0].state, "steer-unknown");
});
