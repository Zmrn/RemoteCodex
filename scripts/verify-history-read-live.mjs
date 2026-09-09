// Read only. This probe reports counts and errors, never private message bodies.
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { Bridge, ROOT } from "../src/bridge.mjs";
const [id] = process.argv.slice(2);
assert.match(id ?? "", /^[a-f0-9-]{36}$/);
fs.mkdirSync(path.join(ROOT, "work"), { recursive: true });
const bridge = new Bridge(fs.mkdtempSync(path.join(ROOT, "work/history-live-")));
try {
  await bridge.connect();
  const status = bridge.status(), head = await bridge.readPage(id);
  assert.equal(head.data.thread.id, id);
  assert.ok(head.readNotice);
  const count = head.data.turns.reduce((n, t) => n + t.items.length, 0);
  assert.ok(count > 0);
  const cursor = head.data.page.nextCursor;
  assert.ok(cursor);
  await assert.rejects(bridge.readPage(id, cursor), /这段历史/);
  const refresh = await bridge.readPage(id, null, cursor);
  assert.equal(refresh.data.thread.id, id);
  assert.ok(refresh.data.turns.reduce((n, t) => n + t.items.length, 0) > 0);
  const report = { result: "PASS", observedAt: new Date().toISOString(),
    officialPid: status.officialPid, compatibility: status.desktopCompatibility,
    readableTurns: head.data.turns.length, readableItems: count,
    reducedReadNotice: true, oversizedOlderSegmentReported: true,
    refreshReadable: true, taskMutations: 0 };
  fs.mkdirSync(path.join(ROOT, "evidence"), { recursive: true });
  fs.writeFileSync(path.join(ROOT, "evidence/history-read-live.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
} finally { bridge.disconnect(); }
