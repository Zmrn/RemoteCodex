import { fixtureEvidence } from "./fixtures/interface-evidence.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { Bridge, ROOT } from "../src/bridge.mjs";
import {
  parseModels,
  modelOverrides,
  permissionOverrides,
} from "../src/settings.mjs";
import { allowedRoute } from "../src/remote.mjs";
import { mergeLiveTurnItems } from "../src/state.mjs";
const catalog = [
  {
    namespace: "codex_app",
    name: "send_message_to_thread",
    inputSchema: {
      properties: {
        model: {
          description:
            "Models: gpt-5.4-mini (Fast test model; supported reasoning efforts: low, medium, high, xhigh).",
        },
      },
    },
  },
];
test("live catalog fails closed; validate effort per model and reject raw settings", () => {
  const models = parseModels(catalog);
  assert.equal(models.length, 1);
  assert.deepEqual(models[0].efforts, ["low", "medium", "high", "xhigh"]);
  assert.throws(() => parseModels([]), /目录不可读/);
  assert.throws(
    () => modelOverrides({ model: "invented" }, models),
    /官方目录/,
  );
  assert.throws(
    () => modelOverrides({ model: "gpt-5.4-mini", effort: "ultra" }, models),
    /推理强度/,
  );
  assert.throws(
    () => modelOverrides({ approvalPolicy: "never" }, models),
    /Invalid/,
  );
  assert.deepEqual(permissionOverrides("keep", {}, "/probe"), {});
  assert.deepEqual(permissionOverrides("read-only", {}, "/probe"), {
    permissions: ":read-only",
  });
  assert.throws(() => permissionOverrides("invented", {}, "/probe"), /Invalid/);
  assert.equal(allowedRoute("POST", "/api/threads/probe/settings"), true);
  assert.equal(allowedRoute("GET", "/api/models"), true);
});
test("unloaded historical Codex text uses official resume route exactly once", async () => {
  const id = "33333333-3333-4333-8333-333333333333";
  const b = new Bridge(fs.mkdtempSync(path.join(ROOT, "test/scratch/resume-")));
  b.connected = true;
  let sent = 0,
    native = 0;
  b.desktop = {
    catalog,
    identity: { appToolsPipe: { image: "OpenAI.Codex_26.901.6511.0_x64__" } },
    call: async (name, args) => {
      if (name === "read_thread")
        return { thread: { id, kind: "codex", status: { type: "notLoaded" } } };
      assert.equal(name, "send_message_to_thread");
      assert.equal(args.threadId, id);
      sent++;
      return { threadId: id };
    },
    ipc: {
      request: async () => {
        native++;
        throw Error("must not dispatch native");
      },
    },
  };
  fixtureEvidence(b.desktop);
  b.follow = async () => {};
  const result = await b.nativeSend(id, "historical-send-001", "hello");
  assert.equal(result.status, "accepted");
  await b.nativeSend(id, "historical-send-001", "hello");
  assert.equal(sent, 1);
  assert.equal(native, 0);
  assert.equal(Object.hasOwn(b.db.tests, id), false);
  await assert.rejects(
    () =>
      b.nativeSend(
        id,
        "historical-image-001",
        "hello",
        "data:image/png;base64,AAAA",
      ),
    /先发送文字/,
  );
  assert.equal(sent, 1);
});
test("loaded native write failure never retries through the desktop tool; Chat stays unsupported", async () => {
  const id = "44444444-4444-4444-8444-444444444444";
  const b = new Bridge(fs.mkdtempSync(path.join(ROOT, "test/scratch/native-")));
  b.connected = true;
  let native = 0,
    other = 0,
    kind = "codex";
  b.desktop = {
    catalog,
    identity: { appToolsPipe: { image: "OpenAI.Codex_26.901.6511.0_x64__" } },
    call: async (name) => {
      if (name === 'list_threads') return { threads: [] };
      if (name !== "read_thread") other++;
      return { thread: { id, kind, status: { type: "idle" } } };
    },
    ipc: {
      request: async () => {
        native++;
        throw Error("write response lost");
      },
    },
  };
  fixtureEvidence(b.desktop);
  b.follow = async () => ({ handledByClientId: "official" });
  await assert.rejects(
    () => b.nativeSend(id, "native-lost-001", "hello"),
    /response lost/,
  );
  await b.nativeSend(id, "native-lost-001", "hello");
  assert.equal(native, 1);
  assert.equal(other, 0);
  kind = "chatgpt";
  await assert.rejects(
    () => b.nativeSend(id, "chat-not-supported", "hello"),
    /仅支持 Codex/,
  );
  assert.equal(native, 1);
});
test("resumed turn empty history uses only its matching official live items", () => {
  const data = {
    turns: [
      { id: "a", status: "completed", items: [] },
      { id: "b", items: [{ id: "text", text: "partial" }] },
    ],
  };
  const state = {
    turnHistory: {
      history: {
        entitiesByKey: {
          one: {
            turnId: "a",
            items: [{ id: "reply", type: "agentMessage", text: "complete" }],
          },
          two: { turnId: "b", items: [{ id: "text", text: "full" }] },
          unrelated: {
            turnId: "c",
            items: [{ id: "secret", text: "other turn" }],
          },
        },
      },
    },
  };
  const got = mergeLiveTurnItems(data, state);
  assert.equal(got.turns[0].items[0].text, "complete");
  assert.equal(got.turns[1].items[0].text, "full");
  assert.equal(JSON.stringify(got).includes("other turn"), false);
  assert.equal(data.turns[0].items.length, 0);
});
test("notLoaded read discards stale live completion and settings", async () => {
  const b = new Bridge(fs.mkdtempSync(path.join(ROOT, "test/scratch/stale-")));
  b.connected = true;
  b.owners = new Map([["old", "owner"]]);
  b.live.set("old", { state: { threadRuntimeStatus: { type: "idle" } } });
  b.desktop = {
    call: async () => ({
      thread: { id: "old", status: { type: "notLoaded" } },
      turns: [],
    }),
  };
  const got = await b.read("old");
  assert.equal(got.live, null);
  assert.equal(got.data.thread.status.type, "notLoaded");
  assert.equal(b.owners.has("old"), false);
});

test("active settings use the existing owner once without starting or interrupting a turn", async () => {
  const id = "55555555-5555-4555-8555-555555555555";
  const b = new Bridge(
    fs.mkdtempSync(path.join(ROOT, "test/scratch/active-settings-")),
  );
  b.connected = true;
  let status = "active";
  const calls = [];
  b.desktop = {
    catalog,
    identity: { appToolsPipe: { image: "OpenAI.Codex_26.901.6511.0_x64__" } },
    call: async (name) => {
      assert.equal(name, "read_thread");
      return { thread: { id, kind: "codex", status: { type: status } } };
    },
    ipc: {
      request: async (method, params, options) => {
        calls.push({ method, params, options });
        return { handledByClientId: "official-owner", result: { ok: true } };
      },
    },
  };
  fixtureEvidence(b.desktop);
  b.follow = async () => ({ handledByClientId: "official-owner" });
  b.live.set(id, {
    state: { latestThreadSettings: { model: "gpt-5.4-mini", effort: "low" } },
  });
  const input = {
    model: "gpt-5.4-mini",
    effort: "medium",
    permissionMode: "read-only",
    serviceTier: "default",
  };
  const result = await b.updateSettings(id, "active-settings-001", input);
  assert.equal(result.status, "accepted");
  assert.equal(result.result.appliesTo, "next-turn");
  await b.updateSettings(id, "active-settings-001", input);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, "thread-follower-update-thread-settings");
  assert.equal(calls[0].options.targetClientId, "official-owner");
  assert.deepEqual(calls[0].params, {
    conversationId: id,
    threadSettings: {
      model: "gpt-5.4-mini",
      effort: "medium",
      permissions: ":read-only",
      serviceTier: "default",
    },
  });
  for (status of ["notLoaded", "unknown", "systemError"]) {
    await assert.rejects(
      () => b.updateSettings(id, "blocked-settings-" + status, input),
      /状态尚不可确认/,
    );
  }
  b.connected = false;
  await assert.rejects(
    () => b.updateSettings(id, "disconnected-settings", input),
    /connection-interrupted/,
  );
  assert.equal(calls.length, 1);
});
