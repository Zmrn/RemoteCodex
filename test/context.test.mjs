import { fixtureEvidence } from "./fixtures/interface-evidence.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { Desktop } from "../src/desktop.mjs";
import { Bridge, ROOT } from "../src/bridge.mjs";

test("per-call tool context does not change concurrent normal calls", async () => {
  const desktop = new Desktop("normal-context");
  desktop.catalog = [{ namespace: "codex_app", name: "wait_threads" }];
  const contexts = [];
  desktop.tools = {
    async request(method, params) {
      contexts.push(params.threadId);
      await Promise.resolve();
      return {
        result: {
          success: true,
          contentItems: [{ type: "inputText", text: "{}" }],
        },
      };
    },
  };
  fixtureEvidence(desktop);
  await Promise.all([
    desktop.call("wait_threads", {}, "alternate-context"),
    desktop.call("wait_threads"),
  ]);
  assert.deepEqual(contexts, ["alternate-context", "normal-context"]);
  assert.equal(desktop.context, "normal-context");
});

test("wait uses its local calling context without a developer-machine ID", async () => {
  const scratch = path.join(ROOT, "test/scratch");
  fs.mkdirSync(scratch, { recursive: true });
  const bridge = new Bridge(fs.mkdtempSync(path.join(scratch, "context-")));
  bridge.connected = true;
  const calls = [];
  bridge.desktop = {
    context: "local-context",
    async call(...args) {
      calls.push(args);
      return { ok: true };
    },
  };
  assert.deepEqual(await bridge.wait("target-task", 90000), { ok: true });
  assert.deepEqual(calls, [
    [
      "wait_threads",
      {
        targets: [{ threadId: "target-task", hostId: "local" }],
        timeoutMs: 50000,
      },
      "local-context",
    ],
  ]);
  assert.equal(bridge.desktop.context, "local-context");
});
