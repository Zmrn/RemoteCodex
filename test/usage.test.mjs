import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { weeklyUsage } from "../src/usage.mjs";
import { Bridge, ROOT } from "../src/bridge.mjs";
import { allowedRoute } from "../src/remote.mjs";
const week = (usedPercent, resetsAt = 1789435536) => ({
  usedPercent,
  resetsAt,
  windowDurationMins: 10080,
});
test("weekly quota prefers per-bucket data; recognizes primary and secondary weeks, strips account fields", () => {
  const result = weeklyUsage({
    accountId: "private",
    rateLimits: { primary: week(99) },
    rateLimitsByLimitId: {
      spark: {
        limitName: "Spark",
        primary: { usedPercent: 50, windowDurationMins: 300 },
        secondary: week(0),
      },
      codex: { primary: week(26), credits: { balance: "private" } },
    },
  });
  assert.deepEqual(
    result.weekly.map((w) => [w.limitId, w.remainingPercent, w.window]),
    [
      ["codex", 74, "primary"],
      ["spark", 100, "secondary"],
    ],
  );
  assert.equal(JSON.stringify(result).includes("private"), false);
  assert.equal(result.scope, "selected-device-account-shared");
  assert.equal(allowedRoute("GET", "/api/usage"), true);
  assert.equal(allowedRoute("POST", "/api/usage"), false);
});
test("unknown/null quota never becomes 100%; no weekly window inferred from position or reset date", () => {
  for (const used of [null, undefined, "0", NaN]) {
    const r = weeklyUsage({ rateLimits: { primary: week(used) } });
    assert.equal(r.status, "unknown");
    assert.equal(r.weekly[0].remainingPercent, null);
  }
  assert.equal(weeklyUsage({}).status, "unknown");
  assert.equal(
    weeklyUsage({
      rateLimits: { secondary: { usedPercent: 0, windowDurationMins: 300 } },
    }).weekly.length,
    0,
  );
  assert.equal(
    weeklyUsage({ rateLimits: { primary: week(101) } }).weekly[0]
      .remainingPercent,
    0,
  );
  assert.equal(
    weeklyUsage({ rateLimits: { primary: week(-1) } }).weekly[0]
      .remainingPercent,
    100,
  );
});
test("quota request uses the desktop read tool, fails on disconnect or replacement during read", async () => {
  fs.mkdirSync(path.join(ROOT, "test/scratch"), { recursive: true });
  const b = new Bridge(fs.mkdtempSync(path.join(ROOT, "test/scratch/usage-")));
  await assert.rejects(() => b.usage(), /connection-interrupted/);
  b.connected = true;
  b.desktop = {
    call: async (name, args) => {
      assert.equal(name, "get_usage_limits");
      assert.deepEqual(args, {});
      return { rateLimits: { primary: week(26) } };
    },
  };
  assert.equal((await b.usage()).weekly[0].remainingPercent, 74);
  b.desktop.call = async () => {
    b.connected = false;
    return { rateLimits: { primary: week(0) } };
  };
  await assert.rejects(() => b.usage(), /connection-interrupted/);
  b.connected = true;
  b.desktop.call = async () => {
    b.desktop = {};
    return { rateLimits: { primary: week(0) } };
  };
  await assert.rejects(() => b.usage(), /连接已更换/);
});
