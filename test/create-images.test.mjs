import { fixtureEvidence } from "./fixtures/interface-evidence.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { Bridge, ROOT } from "../src/bridge.mjs";
import { CompatibilityProbes } from "../src/compatibility-probe.mjs";
import { startServer } from "../src/server.mjs";
const images = JSON.parse(fs.readFileSync(new URL("../src/probe-images.json", import.meta.url)));
const id = "99999999-1111-4111-8111-111111111111";
function fixture(t) {
  const dir = fs.mkdtempSync(path.join(ROOT, "test/scratch/create-images-"));
  const b = new Bridge(dir), calls = [];
  t.after(() => clearInterval(b.subscriptionTimer)); b.connected = true;
  b.desktop = { identity: { appToolsPipe: { image: "OpenAI.Codex_26.901.6511.0_x64__fixture" } },
    catalog: [{ namespace: "codex_app", name: "send_message_to_thread", inputSchema: { properties: { model: { description: "fixture (Fixture; supported reasoning efforts: low)" } } } }],
    call: async (tool, args) => {
      calls.push({ tool, args });
      if (tool === "create_thread") return { threadId: id };
      if (tool === "read_thread") return { thread: { id, kind: "codex", status: { type: "idle" } } };
      throw Error("Unexpected tool");
    },
    ipc: { request: async (method, params, options) => {
      calls.push({ method, params, options });
      return { handledByClientId: "owner", result: { result: { turn: { id: "image-turn" } } } };
    } },
  };
  fixtureEvidence(b.desktop);
  b.follow = async () => ({ handledByClientId: "owner" });
  return { b, calls, dir };
}
test("one create request delivers text and all images in the same official task; retry does not recreate or resend", async t => {
  const { b, calls } = fixture(t);
  const [first, concurrent] = await Promise.all([b.create("image-create-test", "private test request", {}, undefined, images), b.create("image-create-test", "private test request", {}, undefined, images)]);
  assert.equal(first.status, "accepted"); assert.deepEqual(concurrent, first);
  assert.equal(first.result.threadId, id); assert.equal(first.result.imageTurnId, "image-turn");
  const creates = calls.filter(x => x.tool === "create_thread"), sends = calls.filter(x => x.method);
  assert.equal(creates.length, 1); assert.ok(!creates[0].args.prompt.includes("private test request"));
  assert.equal(sends.length, 1); assert.equal(sends[0].params.conversationId, id);
  const input = sends[0].params.turnStart.request.input;
  assert.equal(input[0].text, "private test request"); assert.deepEqual(input.slice(1).map(i => i.url), images);
  assert.equal(sends[0].options.targetClientId, "owner");
  assert.equal((await b.create("image-create-test", "private test request", {}, undefined, images)).deduplicated, true);
  assert.equal(calls.filter(x => x.method).length, 1);
  const persisted = fs.readFileSync(b.stateFile, "utf8");
  assert.ok(!persisted.includes("private test request") && !persisted.includes("base64,"));
  await assert.rejects(() => b.create("image-create-test", "changed", {}, undefined, images), /different content/);
});
test("lost image-send acknowledgement remains unknown across restart with the same task and request", async t => {
  const { b, calls, dir } = fixture(t); let sends = 0;
  b.desktop.ipc.request = async () => { sends++; throw Error("lost image acknowledgement"); };
  await assert.rejects(() => b.create("image-lost-test", "test", {}, undefined, images), /lost image/);
  const restarted = new Bridge(dir); t.after(() => clearInterval(restarted.subscriptionTimer));
  restarted.connected = true; restarted.desktop = b.desktop; restarted.follow = b.follow;
  const retry = await restarted.create("image-lost-test", "test", {}, undefined, images);
  assert.equal(retry.status, "outcome-unknown"); assert.equal(retry.threadId, id);
  assert.equal(sends, 1); assert.equal(calls.filter(x => x.tool === "create_thread").length, 1);
});
test("image-only new conversation and validation before creating any task", async t => {
  const { b, calls } = fixture(t);
  await assert.rejects(() => b.create("invalid-image-test", "test", {}, undefined, ["bad"]), /Invalid image/);
  assert.equal(calls.length, 0);
  const result = await b.create("image-only-test", "", {}, undefined, images);
  assert.equal(result.status, "accepted");
  assert.equal(calls.find(x => x.method).params.turnStart.request.input[0].text, "请查看这些图片。");
});

test("new-task HTTP request carries the full image batch to the official owner and rejects malformed images before create", async t => {
  const { b, calls, dir } = fixture(t);
  b.disconnect = () => {};
  fs.writeFileSync(path.join(dir, "update-settings.json"), '{"automatic":false}');
  const { server, address, secret } = await startServer({ port: 0, bridge: b });
  try {
    const post = body => fetch(address + "/api/threads", { method: "POST", headers: { "X-Bridge-CSRF": secret, "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const body = { mode: "codex", requestId: "http-image-create-test", prompt: "HTTP image test", imageDataUrls: images };
    assert.equal((await post({ ...body, imageDataUrls: ["invalid"] })).status, 400);
    assert.equal(calls.length, 0);
    const response = await post(body);
    assert.equal(response.status, 200);
    assert.equal((await response.json()).result.threadId, id);
    const input = calls.find(c => c.method).params.turnStart.request.input;
    assert.equal(input[0].text, body.prompt);
    assert.deepEqual(input.slice(1).map(i => i.url), images);
  } finally { server.closeAllConnections(); await new Promise(r => server.close(r)); }
});
test("candidate compatibility probes accept only the fixed scenario; persisted running jobs are unknown after restart", async t => {
  const { dir } = fixture(t), p = new CompatibilityProbes(dir); let calls = 0, done;
  p.run = () => { calls++; return new Promise(resolve => { done = resolve; }); };
  const body = { requestId: "fixed-probe-test", expectedVersion: "26.903.8094.0", scenario: "create-vision-owner-v1" };
  for (const bad of [{ ...body, threadId: id }, { ...body, prompt: "arbitrary" }, { ...body, expectedVersion: "99.0.0.0" }, { ...body, scenario: "send" }])
    assert.throws(() => p.start(bad));
  p.start(body); p.start(body); assert.equal(calls, 1);
  assert.equal(new CompatibilityProbes(dir).read(body.requestId).phase, "outcome-unknown");
  assert.equal(new CompatibilityProbes(dir).start(body).phase, "outcome-unknown");
  assert.equal(calls, 1); done();
});
