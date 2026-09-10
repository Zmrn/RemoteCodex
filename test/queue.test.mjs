import { fixtureEvidence } from "./fixtures/interface-evidence.mjs";
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
const png = "data:image/png;base64," + fs.readFileSync(path.join(ROOT, "fixtures/vision-probe.png")).toString("base64");
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
  fixtureEvidence(b.desktop);
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

test("multiple images survive official queue enqueue, take, restart recovery and same-turn steer in order", async () => {
  const {q,b,requests}=fixture();
  const urls=["data:image/png;base64,AAAA", "data:image/jpeg;base64,AQID", "data:image/webp;base64,BAUG"];
  const body={action:"enqueue",prompt:"all images",imageDataUrls:urls,revision:q.read(id).revision};
  await q.mutate(id,"multi-enqueue-1",body);
  assert.deepEqual(q.read(id).messages[0].imageDataUrls,urls);
  assert.equal(q.read(id,false).messages[0].editable,false,"old clients cannot take a partially supported image draft");
  const ownerImages=requests[0].params.state[id][0].context.imageAttachments;
  assert.deepEqual(ownerImages.map(i=>i.src),urls);
  assert.equal(new Set(ownerImages.map(i=>i.id)).size,3);
  await q.mutate(id,"multi-enqueue-1",body);assert.equal(requests.length,1);
  await assert.rejects(q.mutate(id,"multi-enqueue-1",{...body,imageDataUrls:[...urls].reverse()}));
  const taken=await q.mutate(id,"multi-take-1",{action:"take",messageId:"multi-enqueue-1",revision:q.read(id).revision});
  assert.deepEqual(taken.result.draft.imageDataUrls,urls);
  const recovered=new Bridge(b.dataDir).db.queueRecoveries["multi-take-1"].message;
  assert.deepEqual(recovered.context.imageAttachments.map(i=>i.src),urls);
  await q.mutate(id,"multi-enqueue-2",{...body,revision:q.read(id).revision,recoveryId:"multi-take-1"});
  await q.mutate(id,"multi-steer-1",{action:"steer",messageId:"multi-enqueue-2",revision:q.read(id).revision});
  assert.equal(requests.at(-1).method,"thread-follower-steer-turn");
  assert.equal(requests.at(-1).opts.targetClientId,owner);
  assert.deepEqual(requests.at(-1).params.input.filter(i=>i.type==="image").map(i=>i.url),urls);
});

test("queue metadata omits all image bytes, preserves legacy clients and scoped durable recovery", async () => {
  const { q, b, requests } = fixture();
  await q.mutate(id, "preview-enqueue-1", { action: "enqueue", prompt: "preview fixture", imageDataUrls: [png, png], revision: q.read(id).revision });
  const legacy = q.read(id, true), metadata = q.read(id, true, true);
  assert.equal(metadata.previewProtocol, "refs-v1");
  assert.equal(metadata.revision, legacy.revision);
  assert.equal(metadata.confirmed, true);
  assert.equal(metadata.messages[0].editable, true);
  assert.equal(JSON.stringify(metadata).includes("base64"), false);
  assert.equal(metadata.messages[0].imageRefs.length, 2);
  const ref = metadata.messages[0].imageRefs[0];
  assert.deepEqual(b.media.read(id, ref.id).bytes, Buffer.from(png.split(",")[1], "base64"));
  assert.throws(() => b.media.read("different-thread", ref.id));
  assert.equal(q.read(id, false, true).messages[0].editable, false);
  const take = await q.mutate(id, "preview-take-1", { action: "take", messageId: "preview-enqueue-1", revision: metadata.revision });
  assert.deepEqual(take.result.draft.imageDataUrls, [png, png]);
  const recovery = q.read(id, true, true).recoveries[0];
  assert.equal(JSON.stringify(recovery).includes("base64"), false);
  assert.deepEqual(q.recovery(id, recovery.recoveryId).draft.imageDataUrls, [png, png]);
  assert.throws(() => q.recovery("different-thread", recovery.recoveryId));
  b.db.queueRecoveries[recovery.recoveryId].state = "steer-unknown";
  assert.throws(() => q.recovery(id, recovery.recoveryId));
  assert.equal(requests.length, 2, "preview and recovery reads never mutate the owner");
});

test("discard clears only the exact local draft, persists across restart, and sends zero official requests", async () => {
  const {q,b,requests}=fixture();
  const message=composeQueuedMessage('backup-message','do not send','C:/Probe',[png]);
  b.db.queueRecoveries={one:{threadId:id,state:'draft',message},two:{threadId:id,state:'draft',message},
    uncertain:{threadId:id,state:'steer-unknown',message},other:{threadId:'77777777-7777-4777-8777-777777777777',state:'draft',message}};
  b.save();b.connected=false;b.desktop=null;
  const clear=recoveryId=>q.mutate(id,null,{action:'ack-recovery',recoveryId});
  await clear('one');await clear('one');
  const restored=new Bridge(b.dataDir).db.queueRecoveries;
  assert.ok(!restored.one);assert.ok(restored.two && restored.other && restored.uncertain);
  await assert.rejects(clear('uncertain'),/状态已变化/);
  await assert.rejects(clear('other'),/状态已变化/);
  const save=b.save.bind(b);b.save=()=>{throw Error('disk unavailable');};
  await assert.rejects(clear('two'),/disk unavailable/);
  assert.ok(b.db.queueRecoveries.two);assert.ok(new Bridge(b.dataDir).db.queueRecoveries.two);
  b.save=save;await clear('two');assert.equal(requests.length,0);
});
