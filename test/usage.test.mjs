import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { weeklyUsage } from "../src/usage.mjs";
import { usageWindows, quotaSummary } from "../public/usage-view.mjs";
import { Bridge, ROOT } from "../src/bridge.mjs";
import { allowedRoute } from "../src/remote.mjs";
const week = (usedPercent, resetsAt = 1789435536) => ({
  usedPercent,
  resetsAt,
  windowDurationMins: 10080,
});
const five = usedPercent => ({ usedPercent, resetsAt: 1789430000, windowDurationMins: 300 });

test("Plus retains five-hour and weekly windows and prioritizes Codex five-hour quota", () => {
  const result = weeklyUsage({ rateLimitsByLimitId: {
    codex: { planType: "plus", primary: five(80), secondary: week(42) },
  } });
  assert.equal(result.planType, "plus"); assert.equal(result.schemaVersion, 2);
  assert.deepEqual(usageWindows(result).map(w => [w.limitId, w.windowDurationMins, w.remainingPercent]), [["codex", 300, 20], ["codex", 10080, 58]]);
  assert.equal(quotaSummary(result, "available", true), "5h 额度剩余 20%");
  assert.equal(result.fiveHour[0].resetsAt, 1789430000);
});

test("Pro uses its Codex week; independent Spark five-hour quota never replaces it", () => {
  const result = weeklyUsage({ rateLimitsByLimitId: {
    codex_bengalfox: { limitName: "GPT-5.3-Codex-Spark", planType: "pro", primary: five(3), secondary: week(1) },
    codex: { planType: "pro", primary: week(75), secondary: null },
  } });
  assert.equal(result.planType, "pro");
  assert.equal(quotaSummary(result, "available", true), "周额度剩余 25%");
  assert.deepEqual(usageWindows(result).map(w => [w.limitId, w.windowDurationMins]), [["codex", 10080], ["codex_bengalfox", 300], ["codex_bengalfox", 10080]]);
  assert.equal(result.fiveHour.length, 1);
  const sparkOnly = weeklyUsage({ rateLimitsByLimitId: { codex_bengalfox: { limitName: "Spark", primary: five(0) } } });
  assert.equal(quotaSummary(sparkOnly, "available", true), "额度 · 未知");
  assert.equal(usageWindows(sparkOnly).length, 1);
});

test("quota follows reported durations rather than guessing from plan or field position", () => {
  const r = weeklyUsage({ rateLimits: { planType: "plus", primary: week(2), secondary: five(20) } });
  assert.equal(quotaSummary(r, "available", true), "5h 额度剩余 80%");
  assert.equal(r.fiveHour[0].window, "secondary");
  const proWithFive = weeklyUsage({ rateLimits: { planType: "pro", primary: five(1) } });
  assert.equal(quotaSummary(proWithFive, "available", true), "5h 额度剩余 99%");
  assert.equal(weeklyUsage({ rateLimits: { planType: "plus", primary: { usedPercent: 10, windowDurationMins: 60 } } }).fiveHour.length, 0);
});

test("unknown five-hour data keeps priority, zero remains zero and disconnect never displays stale percentages", () => {
  for (const value of [null, undefined, "0", NaN]) {
    const r = weeklyUsage({ rateLimits: { primary: five(value), secondary: week(1) } });
    assert.equal(quotaSummary(r, r.status, true), "5h 额度 · 未知");
    assert.equal(r.fiveHour[0].remainingPercent, null);
    assert.equal(quotaSummary(r, "available", false), "额度 · 未知");
  }
  const r = weeklyUsage({ rateLimits: { primary: five(100), secondary: week(0) } });
  assert.equal(quotaSummary(r, r.status, true), "5h 额度剩余 0%");
  assert.equal(quotaSummary({ weekly: [{ limitId: "codex", remainingPercent: 61 }] }, "available", true), "周额度剩余 61%");
  assert.ok(!quotaSummary({ fiveHour: [{ limitId: "codex" }] }, "available", true).includes("NaN"));
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
