// Only close this probe's own viewing pipes. Never restart or stop the official app.
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { Bridge, ROOT } from "../src/bridge.mjs";
const dir = fs.mkdtempSync(path.join(ROOT, "work/reconnect-live-"));
const bridge = new Bridge(dir);
const events = [];
bridge.on("event", (e) =>
  events.push({
    kind: e.kind,
    time: e.time,
    threadId: e.threadId,
    officialPid: e.officialPid,
  }),
);
const until = async (predicate) => {
  const start = Date.now();
  while (!predicate() && Date.now() - start < 30000)
    await new Promise((r) => setTimeout(r, 100));
  assert.ok(predicate(), "live viewer did not recover");
};
try {
  await bridge.connect();
  const pid = bridge.status().officialPid;
  const list = await bridge.threads(20);
  // The active development task may be subscribed/read, but never written to.
  const task = [...list.data.pinnedThreads, ...list.data.threads].find(
    (t) => t.kind === "codex" && t.status === "active",
  );
  assert.ok(task, "No active Codex task for read-only subscription probe");
  await bridge.follow(task.id);
  await until(() => bridge.live.has(task.id));
  const checks = [];
  for (const pipe of ["ipc", "tools"]) {
    const previous = bridge.desktop;
    const start = Date.now();
    previous[pipe].close();
    await until(
      () =>
        bridge.desktop !== previous &&
        bridge.connected &&
        bridge.live.has(task.id),
    );
    assert.equal(bridge.status().officialPid, pid);
    const read = await bridge.readPage(task.id);
    assert.equal(read.data.thread.id, task.id);
    checks.push({
      pipe,
      recoveredMs: Date.now() - start,
      officialPid: pid,
      threadId: task.id,
      itemCount: read.data.turns.reduce((n, t) => n + t.items.length, 0),
      sameOfficialProcess: true,
    });
  }
  bridge.disconnect();
  const count = events.filter((e) => e.kind === "connected").length;
  await new Promise((r) => setTimeout(r, 2000));
  assert.equal(bridge.connected, false);
  assert.equal(events.filter((e) => e.kind === "connected").length, count);
  const report = {
    result: "passed",
    observedAt: new Date().toISOString(),
    source: "existing official Windows desktop IPC; probe-owned pipes only",
    checks,
    intentionalStopStayedDisconnected: true,
    taskMutations: 0,
    events,
  };
  fs.mkdirSync(path.join(ROOT, "evidence"), { recursive: true });
  fs.writeFileSync(
    path.join(ROOT, "evidence/reconnect-live.json"),
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report));
} finally {
  bridge.disconnect();
}
