import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { Bridge, ROOT } from "../src/bridge.mjs";
import { OFFICIAL, supportManifest, supportedBuild, protocolRequest, protocolBroadcast } from "../src/official-protocol.mjs";
import { checkGenerated, releaseNotes, validateCatalog } from "../scripts/compatibility-report.mjs";
import { verifyManifest } from "../src/update-format.mjs";

test("catalog evidence and generated interface inventory cannot drift from runtime definitions", () => {
  validateCatalog(); checkGenerated();
  assert.ok(Object.isFrozen(OFFICIAL.ipc.start));
  // Tests deliberately retain literal wire expectations; runtime uses the catalog.
  for (const file of fs.readdirSync(path.join(ROOT, "src")).filter(f => /\.(mjs|py)$/.test(f))) {
    const source = fs.readFileSync(path.join(ROOT, "src", file), "utf8");
    assert.doesNotMatch(source, /26\.901\.6511\.0|["']thread-(?:follower-|owner-discovery|stream-following-changed)/, file);
  }
});

test("registered owner protocols preserve wire versions, payloads and target; override is rejected", async () => {
  const calls = [], pipe = { request: (...args) => { calls.push(args); return Promise.resolve({ handledByClientId: "owner" }); }, broadcast: (...args) => calls.push(args) };
  const params = { conversationId: "task", expectedTurnId: "running-turn" };
  await protocolRequest(pipe, "start", params, { targetClientId: "owner", timeoutMs: 60000 });
  await protocolRequest(pipe, "interrupt", params, { targetClientId: "owner", timeoutMs: 30000 });
  protocolBroadcast(pipe, "following", params, ["owner"]);
  assert.equal(calls[0][0], "thread-follower-start-turn"); assert.equal(calls[0][2].version, 2);
  assert.equal(calls[1][0], "thread-follower-interrupt-turn"); assert.equal(calls[1][2].version, 4);
  assert.equal(calls[2][0], "thread-stream-following-changed"); assert.equal(calls[2][2], 1);
  assert.equal(calls[0][1], params); assert.equal(calls[1][2].targetClientId, "owner");
  assert.throws(() => protocolRequest(pipe, "start", {}, { version: 999 }));
  assert.throws(() => protocolRequest(pipe, "unregistered", {}));
  assert.equal(calls.length, 3);
});

test("future desktop build blocks all task writes before IPC but permits read-only catalog", async t => {
  fs.mkdirSync(path.join(ROOT, "test/scratch"), { recursive: true });
  const b = new Bridge(fs.mkdtempSync(path.join(ROOT, "test/scratch/compatibility-")));
  t.after(() => clearInterval(b.subscriptionTimer));
  const id = "77777777-7777-4777-8777-777777777777"; let calls = 0;
  b.connected = true;
  b.desktop = { identity: { appToolsPipe: { image: "OpenAI.Codex_99.0.0.0_x64__fixture" } }, catalog: [],
    call: async name => { calls++; assert.equal(name, "list_threads"); return { threads: [] }; },
    ipc: { request() { throw Error("Unexpected IPC"); } } };
  for (const action of [
    () => b.create("create-fixture", "test"), () => b.nativeSend(id, "send-fixture", "test"),
    () => b.updateSettings(id, "settings-fixture", {}), () => b.queue.mutate(id, "queue-fixture", { action: "delete" }),
    () => b.answerQuestions(id, "question-fixture", {}), () => b.interrupt(id, "interrupt-fixture", "turn"),
  ]) await assert.rejects(action, /Unsupported desktop build/);
  assert.equal(calls, 0); assert.deepEqual(b.db.requests, {});
  assert.equal(b.status().existingCodexWritable, false);
  assert.equal(b.status().desktopCompatibility.detectedVersion, "99.0.0.0");
  assert.equal(b.status().desktopCompatibility.writeSupported, false);
  await b.threads(); assert.equal(calls, 1);
  assert.equal(supportedBuild("OpenAI.Codex_26.901.6511.0_x64__fixture"), true);
  assert.equal(supportedBuild("OpenAI.Codex_26.901.6511.0_arm64__fixture"), false);
});

test("published support versions and release note hash are bound by signature; legacy parser accepts added fields", () => {
  const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const notes = releaseNotes("0.10.11"), support = supportManifest();
  assert.match(notes, /支持的官方桌面版本：26\.901\.6511\.0/);
  assert.match(notes, /文字续写待专用真实会话验证/);
  const manifest = { schema: 1, version: "0.10.11", platform: "windows-x64", file: "RemoteCodex.exe",
    bytes: 2048, sha256: "0".repeat(64), desktopCompatibility: support,
    releaseNotesSha256: createHash("sha256").update(notes).digest("hex") };
  const payload = Buffer.from(JSON.stringify(manifest));
  const envelope = { payload: payload.toString("base64"), signature: sign("sha256", payload, privateKey).toString("base64") };
  assert.deepEqual(verifyManifest(envelope, publicKey).desktopCompatibility, support);
  manifest.desktopCompatibility.verifiedVersions.push("99.0.0.0");
  assert.throws(() => verifyManifest({ ...envelope, payload: Buffer.from(JSON.stringify(manifest)).toString("base64") }, publicKey), /签名/);
});
