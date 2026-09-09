import test from "node:test";
import assert from "node:assert/strict";
import { readOfficialHistory } from "../src/history-read.mjs";
import { ConversationPages } from "../src/conversation-pages.mjs";

const failure = () => Error('{"code":-32000,"message":"Codex app tool request failed"}');
const fixture = (id, nextCursor = "official-older") => ({
  thread: { id, kind: "codex", status: { type: "notLoaded" } },
  turns: [{ id: "turn-" + id, items: [{ id: "message-" + id, type: "agentMessage", text: "Readable" }] }],
  page: { nextCursor, hasMore: !!nextCursor },
});
const connected = () => {};

test("failed batch reads retry the same task and cursor once; success preserves official data", async () => {
  const calls = [], expected = fixture("one");
  const desktop = { call: async (tool, args) => {
    assert.equal(tool, "read_thread"); calls.push(args);
    if (args.turnLimit > 1) throw failure();
    return expected;
  } };
  const r = await readOfficialHistory(desktop, "one", "exact-official-cursor", 10, connected);
  assert.deepEqual(calls.map(c => c.turnLimit), [10, 1]);
  assert.ok(calls.every(c => c.threadId === "one" && c.cursor === "exact-official-cursor" && c.includeOutputs));
  assert.equal(r.data, expected);
  assert.match(r.readNotice, /已先显示可读内容/);
  assert.equal(r.data.thread.status.type, "notLoaded");
  await readOfficialHistory(desktop, "one", null, 2, connected);
  assert.equal(calls.at(-1).turnLimit, 1);
  await readOfficialHistory(desktop, "two", null, 2, connected);
  assert.deepEqual(calls.slice(-2).map(c => c.turnLimit), [2, 1]);
});

test("single-turn failure stays an error, never an empty successful page", async () => {
  const limits = [];
  const desktop = { call: async (_tool, args) => { limits.push(args.turnLimit); throw failure(); } };
  await assert.rejects(readOfficialHistory(desktop, "one", "cursor", 2, connected), /这段历史/);
  assert.deepEqual(limits, [2, 1]);
});

test("permission, cursor and connection errors are not retried as size failures", async () => {
  for (const message of ["Forbidden", "Invalid cursor", "connection-interrupted", "outcome-unknown: timeout tools/call"]) {
    let count = 0;
    const desktop = { call: async () => { count++; throw Error(message); } };
    await assert.rejects(readOfficialHistory(desktop, "one", null, 2, connected), e => e.message === message);
    assert.equal(count, 1);
  }
});

test("connection replacement prevents retry and rejects late successful data", async () => {
  for (const fails of [true, false]) {
    let valid = true, calls = 0;
    const desktop = { call: async () => { calls++; valid = false; if (fails) throw failure(); return fixture("one"); } };
    await assert.rejects(readOfficialHistory(desktop, "one", null, 2, () => { if (!valid) throw Error("Viewer connection changed"); }), /connection changed/);
    assert.equal(calls, 1);
  }
});

test("failed older history retains its cursor and retries without skipping or duplicating readable content", async () => {
  let blocked = true;
  const calls = [];
  const desktop = { call: async (_tool, args) => {
    calls.push(args);
    if (args.turnLimit > 1 || (args.cursor && blocked)) throw failure();
    return fixture(args.cursor ? "older" : "one", args.cursor ? null : "official-older");
  } };
  const pages = new ConversationPages();
  const read = async cursor => {
    const { data, readNotice } = await readOfficialHistory(desktop, "one", cursor, 2, connected);
    return { data, readNotice, live: null };
  };
  const head = await pages.read("one", null, read);
  const cursor = head.data.page.nextCursor;
  await assert.rejects(pages.read("one", cursor, read), /这段历史/);
  assert.equal(head.data.turns[0].items[0].text, "Readable");
  assert.ok(pages.snapshots.has(cursor.split(":")[0]));
  blocked = false;
  const older = await pages.read("one", cursor, read);
  assert.equal(older.data.turns[0].id, "turn-older");
  assert.equal(older.data.page.hasMore, false);
  assert.ok(calls.filter(c => c.cursor).every(c => c.cursor === "official-older" && c.turnLimit === 1));
});
