import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { TaskReports, reportReceipt } from "../src/task-reports.mjs";
import { allowedRoute } from "../src/remote.mjs";
const id = "11111111-1111-4111-8111-111111111111";
const report = (text = "Returned fixture", status = "idle", kind = "codex") => ({
  thread: { id, kind, status: { type: status } },
  turns: [{ id: "turn-1", startedAt: 5, status: "completed", items: [{ id: "item-1", type: "agentMessage", text }] }],
});
function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "widget-receipts-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  let now = Date.now(), connected = true;
  const rows = [{ id, kind: "codex", status: "idle", hostId: "local", updatedAt: 3, title: "Fixture" }], data = new Map([[id, report()]]), calls = [];
  const bridge = { dataDir: dir, requireConnection() { if (!connected) throw Error("offline"); },
    threads: async () => ({ data: { pinnedThreads: rows.slice(0, 1), threads: rows } }),
    desktop: { call: async (name, args, context, options) => { calls.push({ name, args, options }); const value = data.get(args.threadId); if (value instanceof Error) throw value; return structuredClone(value); } },
  };
  const reports = new TaskReports(bridge, { now: () => now });
  return { bridge, reports, rows, data, calls, advance: ms => { now += ms; }, disconnect: () => { connected = false; } };
}
test("report tokens require a final return, distinguish revisions, and never use Chat synthetic completion as runtime proof", () => {
  const first = reportReceipt(report()); assert.ok(first); assert.equal(first.itemId, "item-1");
  assert.notEqual(first.token, reportReceipt(report("New return")).token);
  for (const status of ["active", "waiting-approval", "waiting-user-input"]) assert.equal(reportReceipt(report("text", status)), null);
  assert.equal(reportReceipt(report("text", "unknown", "chatgpt")), null);
  assert.ok(reportReceipt(report("text", "idle", "chatgpt")));
  const data = report(); data.turns.unshift({ id: "later", startedAt: 6, status: "inProgress", items: [] });
  assert.equal(reportReceipt(data), null);
  assert.equal(reportReceipt(report("  ")), null);
});
test("receipts persist without bodies; late old acknowledgements cannot clear new reports or undo new receipts", async t => {
  const { reports, bridge } = fixture(t);
  const old = reports.observe(report()), next = reports.observe(report("New private fixture"));
  await reports.acknowledge(id, old.token);
  assert.equal(reports.receipts().read[id].includes(next.token), false);
  await reports.acknowledge(id, next.token);
  await reports.acknowledge(id, old.token);
  assert.deepEqual(new TaskReports(bridge).receipts().read[id], [old.token, next.token]);
  const raw = fs.readFileSync(reports.file, "utf8"); assert.ok(!raw.includes("private fixture")); assert.ok(!raw.includes("Returned fixture"));
});
test("separate instances merge under the existing OS lock instead of overwriting receipt snapshots", async t => {
  const { reports, bridge } = fixture(t), second = new TaskReports(bridge);
  reports.receipts(); second.receipts();
  const old = reports.observe(report()), next = second.observe(report("second"));
  await Promise.all([reports.acknowledge(id, old.token), second.acknowledge(id, next.token)]);
  assert.equal(reports.receipts().read[id].length, 2);
});
test("corruption and failed atomic replacement preserve evidence and reject success", async t => {
  const { reports } = fixture(t), receipt = reports.observe(report());
  await reports.acknowledge(id, receipt.token);
  const good = fs.readFileSync(reports.file), corrupted = good.toString().replace(receipt.token, "f".repeat(64));
  fs.writeFileSync(reports.file, corrupted);
  await assert.rejects(reports.acknowledge(id, receipt.token), /校验失败/);
  assert.equal(fs.readFileSync(reports.file, "utf8"), corrupted);
  fs.writeFileSync(reports.file, good);
  const newer = reports.observe(report("next")), rename = fs.renameSync;
  fs.renameSync = () => { throw Error("simulated interrupted save"); };
  try { await assert.rejects(reports.acknowledge(id, newer.token), /interrupted/); }
  finally { fs.renameSync = rename; }
  assert.deepEqual(fs.readFileSync(reports.file), good);
  assert.ok(!fs.readdirSync(path.dirname(reports.file)).some(n => n.endsWith(".tmp")));
});
test("unissued, wrong-task and expired receipts are rejected", async t => {
  const f = fixture(t), receipt = f.reports.observe(report());
  assert.equal((await f.reports.acknowledge(randomUUID(), receipt.token)).accepted, false);
  assert.equal((await f.reports.acknowledge(id, "a".repeat(64))).accepted, false);
  f.advance(31 * 60000); assert.equal((await f.reports.acknowledge(id, receipt.token)).accepted, false);
  await assert.rejects(f.reports.acknowledge("../config", receipt.token), /Invalid/);
});
test("summary deduplicates, uses bounded read-only calls, forwards host identity, and never counts active reports as unread", async t => {
  const f = fixture(t), runningId = randomUUID();
  f.rows.push({ id: runningId, kind: "codex", status: "active", title: "Active" });
  const summary = await f.reports.summary();
  assert.equal(summary.threads.length, 2); assert.equal(summary.complete, true);
  assert.equal(summary.threads.filter(t => t.unread).length, 1); assert.equal(summary.threads.filter(t => t.running).length, 1);
  assert.deepEqual(f.calls[0].args, { threadId: id, hostId: "local", turnLimit: 1, includeOutputs: false, maxOutputCharsPerItem: 0 });
  assert.equal(f.calls[0].name, "read_thread"); assert.ok(f.calls[0].options.timeoutMs <= 4000);
  await f.reports.acknowledge(id, summary.threads[0].reportToken);
  assert.equal((await f.reports.summary()).threads[0].unread, false);
  assert.equal(f.calls.length, 1);
  f.data.set(id, report("new")); f.rows[0].updatedAt++;
  assert.equal((await f.reports.summary()).threads[0].unread, true);
});
test("unread acknowledgement during collection is reflected in the response", async t => {
  const f = fixture(t), receipt = f.reports.observe(report()); let release;
  f.bridge.desktop.call = () => new Promise(resolve => { release = resolve; });
  const pending = f.reports.summary(); await new Promise(r => setImmediate(r));
  await f.reports.acknowledge(id, receipt.token); release(report());
  assert.equal((await pending).threads[0].unread, false);
});
test("missing histories, unloaded status, unavailable sources and official cap are incomplete, never healthy zero", async t => {
  const f = fixture(t); f.data.set(id, Error("frame too large"));
  let summary = await f.reports.summary(); assert.equal(summary.complete, false); assert.equal(summary.threads[0].unknown, true);
  f.data.set(id, report("text", "notLoaded")); summary = await f.reports.summary(); assert.equal(summary.complete, false);
  f.bridge.threads = async () => ({ data: { threads: [], unavailableSources: ["chatgpt"] } });
  assert.equal((await f.reports.summary()).complete, false);
  f.bridge.threads = async () => ({ data: { threads: Array.from({ length: 50 }, () => ({ id: randomUUID(), kind: "codex", status: "active" })) } });
  summary = await f.reports.summary(); assert.equal(summary.listLimited, true); assert.equal(summary.complete, false); assert.equal(summary.threads.length, 50);
});
test("disconnect and changed connection discard summary rather than returning cached live status", async t => {
  const f = fixture(t); await f.reports.summary(); f.disconnect(); await assert.rejects(f.reports.summary(), /offline/);
  const other = fixture(t); other.bridge.desktop.call = async () => { other.bridge.desktop = {}; return report(); };
  await assert.rejects(other.reports.summary(), /changed/);
});
test("summary and receipt forwarding expose only intended HTTP methods", () => {
  assert.equal(allowedRoute("GET", "/api/task-summary"), true);
  assert.equal(allowedRoute("POST", "/api/task-summary"), false);
  assert.equal(allowedRoute("POST", `/api/threads/${id}/read-receipt`), true);
  assert.equal(allowedRoute("GET", `/api/threads/${id}/read-receipt`), false);
  assert.equal(allowedRoute("POST", "/api/agents"), false);
});

test("official absence changes only this refresh, including cached reports; later unread marks and new returns are not lost", async t => {
  const f = fixture(t); let excludes = true;
  f.reports.readStateDesktop = f.bridge.desktop;
  f.reports.readState = { snapshot: async () => ({ status: 'available', excludes: () => excludes }) };
  let row = (await f.reports.summary()).threads[0]; assert.equal(row.unread, false); assert.equal(row.officialRead, true);
  assert.equal(fs.existsSync(f.reports.file), false);
  excludes = false; row = (await f.reports.summary()).threads[0]; assert.equal(row.unread, true); assert.equal(row.officialRead, undefined);
  assert.equal(f.calls.length, 1);
  await f.reports.acknowledge(id, row.reportToken); excludes = true;
  row = (await f.reports.summary()).threads[0]; assert.equal(row.unread, false); assert.equal(row.officialRead, undefined);
  const bytes = fs.readFileSync(f.reports.file); f.data.set(id, report('new return')); f.rows[0].updatedAt++; excludes = false;
  assert.equal((await f.reports.summary()).threads[0].unread, true); assert.deepEqual(fs.readFileSync(f.reports.file), bytes);
});
test("official read exclusion is local Codex only and can clear exact unread evidence without inventing runtime state", async t => {
  const f = fixture(t);
  f.reports.readStateDesktop = f.bridge.desktop;
  f.reports.readState = { snapshot: async () => ({ status: 'available', excludes: () => true }) };
  f.rows[0].hostId = 'remote'; assert.equal((await f.reports.summary()).threads[0].unread, true);
  f.rows[0].hostId = 'local'; f.rows[0].kind = 'chatgpt'; f.data.set(id, report('chat', 'idle', 'chatgpt'));
  assert.equal((await f.reports.summary()).threads[0].unread, true);
  f.rows[0].kind = 'codex'; f.data.set(id, report('codex', 'notLoaded'));
  const row = (await f.reports.summary()).threads[0]; assert.equal(row.unread, false); assert.equal(row.unknown, true); assert.equal(row.officialRead, true);
});
