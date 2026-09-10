import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  ConversationPages,
  compactConversation,
} from "../src/conversation-pages.mjs";
import { MessageMedia } from "../src/message-media.mjs";
import { mergeTurns, overlaps } from "../public/conversation-history.mjs";
import { Bridge, ROOT } from "../src/bridge.mjs";
import path from "node:path";
import { mergeLiveTurnItems } from "../src/state.mjs";
import { reportReceipt } from "../src/task-reports.mjs";
fs.mkdirSync(path.join(ROOT, 'test/scratch'), { recursive: true });
const turn = (id, count) => ({
  id,
  startedAt: Number(id.slice(1)),
  status: "completed",
  items: Array.from({ length: count }, (_, i) => ({
    id: id + "i" + i,
    type: "agentMessage",
    text: "正文 " + i,
  })),
});
function source(turns) {
  const calls = [];
  const read = async (cursor) => {
    calls.push(cursor);
    const start = cursor ? turns.findIndex((t) => t.id === cursor) + 1 : 0;
    const page = turns.slice(start, start + 2);
    return {
      data: {
        thread: { id: "one", status: { type: "idle" } },
        turns: page,
        page: { nextCursor: start + 2 < turns.length ? page.at(-1).id : null },
      },
      live: { state: { threadRuntimeStatus: { type: "idle" }, requests: [] } },
    };
  };
  return { read, calls };
}
test("tail pages split a large single turn; every item is recovered once, in order", async () => {
  const full = [
    turn("t5", 125),
    turn("t4", 80),
    turn("t3", 4),
    turn("t2", 0),
    turn("t1", 2),
  ];
  const { read, calls } = source(full),
    p = new ConversationPages({ maxItems: 40 });
  let page = await p.read("one", null, read),
    merged = page.data.turns,
    count = 1;
  assert.equal(page.data.turns[0].items.length, 40);
  assert.equal(page.data.turns[0].items[0].id, "t5i85");
  let before = page.data.page.nextCursor;
  assert.deepEqual(
    (await p.read("one", before, read)).data,
    (await p.read("one", before, read)).data,
  );
  while (before) {
    page = await p.read("one", before, read);
    merged = mergeTurns(merged, page.data.turns, true);
    before = page.data.page.nextCursor;
    assert.ok(++count < 20);
  }
  assert.deepEqual(
    merged.map((t) => [t.id, t.items.map((i) => i.id)]),
    full.map((t) => [t.id, t.items.map((i) => i.id)]),
  );
  assert.deepEqual(calls, [null, "t4", "t2"]);
});
test("pagination rejects foreign, corrupt and expired cursors; retaining active history survives head refreshes", async () => {
  const { read } = source([turn("t2", 80), turn("t1", 80)]);
  const p = new ConversationPages({ maxSnapshots: 3 });
  const first = await p.read("one", null, read),
    cursor = first.data.page.nextCursor;
  await assert.rejects(p.read("two", cursor, read), /已失效/);
  await assert.rejects(p.read("one", "../../token", read), /已失效/);
  for (let i = 0; i < 12; i++) {
    p.touch("one", cursor);
    await p.read("one", null, read);
  }
  assert.ok((await p.read("one", cursor, read)).data.turns.length);
  p.snapshots.get(cursor.split(":")[0]).at = 0;
  await assert.rejects(p.read("one", cursor, read), /已失效/);
});
test("head updates preserve older items; snapshot pages cannot overwrite newer answers", () => {
  const old = { ...turn("t1", 2), bridgePartial: true };
  old.items = old.items.map((i, n) => ({ ...i, bridgeItemIndex: n }));
  const next = {
    ...old,
    items: [
      { ...old.items[1], text: "new answer" },
      { id: "t1i2", type: "agentMessage", text: "new", bridgeItemIndex: 2 },
    ],
  };
  let merged = mergeTurns([old], [next]);
  assert.equal(merged[0].items.length, 3);
  merged = mergeTurns(merged, [old], true);
  assert.equal(merged[0].items[1].text, "new answer");
  assert.equal(overlaps(merged, [next]), true);
  assert.equal(overlaps(merged, [turn("t9", 2)]), false);
});
test("images leave the JSON but original bytes remain accessible only in their task", () => {
  const media = new MessageMedia();
  const bytes = Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    Buffer.alloc(500000, 3),
  ]);
  const image = "data:image/png;base64," + bytes.toString("base64");
  const data = {
    turns: [
      {
        id: "t1",
        items: [
          {
            id: "u",
            type: "userMessage",
            content: [
              { type: "text", text: "看图片" },
              { type: "image", url: image },
            ],
          },
          {
            id: "img",
            type: "imageGeneration",
            status: "completed",
            result: image,
          },
          {
            id: "q",
            type: "agentMessage",
            delivery: "async",
            questions: [{ title: "选择", options: ["一", "二"] }],
            text: "选择",
          },
          { id: "tool", type: "dynamicToolCall", output: image },
        ],
      },
    ],
  };
  const compact = compactConversation(
    media.decorate("one", data, { externalImages: true }),
  );
  assert.ok(JSON.stringify(compact).length < 2000);
  assert.equal(JSON.stringify(compact).includes("base64"), false);
  assert.deepEqual(
    compact.turns[0].items[2].questions,
    data.turns[0].items[2].questions,
  );
  const id = compact.turns[0].items[0].bridgeDisplay.images[0].id;
  assert.deepEqual(media.read("one", id).bytes, bytes);
  assert.throws(() => media.read("two", id), /未出现在/);
  assert.equal(data.turns[0].items[0].content[1].url, image);
});
test("paged reads request two official turns; identical head uses tiny response without hiding changed state", async () => {
  const dir = fs.mkdtempSync(path.join(ROOT, "test/scratch/pagination-"));
  const b = new Bridge(dir);
  b.connected = true;
  b.owners = new Map();
  const args = [];
  let status = "active";
  b.desktop = {
    call: async (method, params) => {
      assert.equal(method, "read_thread");
      args.push(params);
      return {
        thread: { id: "one", status: { type: status } },
        turns: [turn("t1", 90)],
        page: { nextCursor: null },
      };
    },
  };
  const first = await b.readPage("one");
  assert.equal(first.data.turns[0].items.length, 40);
  assert.equal(args[0].turnLimit, 2);
  const unchanged = await b.readPage(
    "one",
    null,
    first.data.page.nextCursor,
    first.headHash,
  );
  assert.equal(unchanged.notModified, true);
  status = "idle";
  assert.equal(
    (await b.readPage("one", null, first.data.page.nextCursor, first.headHash))
      .data.thread.status.type,
    "idle",
  );
});

test('read receipts follow displayed owner items through paging, missing history, edits and deletions', async () => {
  const dir = fs.mkdtempSync(path.join(ROOT, 'test/scratch/receipt-page-'));
  const b = new Bridge(dir); b.connected = true;
  const id = '11111111-1111-4111-8111-111111111111';
  const data = { thread: { id, kind: 'codex', status: { type: 'idle' } }, turns: [turn('t1', 0)] };
  const live = { id, threadRuntimeStatus: { type: 'idle' }, turnHistory: { history: { entitiesByKey: {
    t1: { turnId: 't1', turnStartedAtMs: 1000, status: 'completed', items: turn('t1', 91).items },
  } } } };
  b.desktop = { call: async () => structuredClone(data) }; b.live.set(id, { state: live });
  const first = await b.readPage(id);
  assert.equal(first.data.turns[0].items.length, 40);
  assert.equal(first.reportReceipt.itemId, 't1i90');
  assert.deepEqual(first.reportReceipt, reportReceipt(mergeLiveTurnItems(data, live)));
  assert.ok(b.taskReports.issued.has(id + ':' + first.reportReceipt.token));
  const same = await b.readPage(id, null, first.data.page.nextCursor, first.headHash);
  assert.equal(same.notModified, true); assert.deepEqual(same.reportReceipt, first.reportReceipt);
  const older = await b.readPage(id, first.data.page.nextCursor);
  assert.deepEqual(older.reportReceipt, first.reportReceipt, 'a cached older page must not replace the head receipt with an older report');
  assert.ok(!older.data.turns[0].items.some(i => i.id === first.reportReceipt.itemId));
  live.turnHistory.history.entitiesByKey.t1.items.at(-1).text = 'edited owner return';
  const edited = await b.readPage(id);
  assert.notEqual(edited.reportReceipt.token, first.reportReceipt.token);
  data.turns[0].items = turn('t1', 91).items;
  live.turnHistory.history.entitiesByKey.t1.items = [];
  const deleted = await b.readPage(id);
  assert.equal(deleted.reportReceipt, null); assert.equal(deleted.data.turns[0].items.length, 0);
});

test("owner-only turns survive head paging when official history is seven turns behind", async () => {
  const dir = fs.mkdtempSync(path.join(ROOT, "test/scratch/owner-history-"));
  const b = new Bridge(dir);
  b.connected = true;
  const history = [turn("t3", 3), turn("t2", 3), turn("t1", 3)];
  const calls = [];
  b.desktop = {
    call: async (_method, args) => {
      calls.push(args.cursor ?? null);
      const page = args.cursor ? history.slice(2) : history.slice(0, 2);
      return {
        thread: { id: "one", status: { type: "active" } },
        turns: structuredClone(page),
        page: { nextCursor: args.cursor ? null : "older" },
      };
    },
  };
  const entities = Object.fromEntries(
    Array.from({ length: 10 }, (_, i) => {
      const t = turn("t" + (i + 1), i === 9 ? 65 : 3);
      return [
        t.id,
        {
          turnId: t.id,
          turnStartedAtMs: t.startedAt * 1000,
          status: i === 9 ? "inProgress" : "completed",
          items: t.items,
        },
      ];
    }),
  );
  const state = {
    id: "one",
    threadRuntimeStatus: { type: "active" },
    turnHistory: { history: { entitiesByKey: entities } },
  };
  b.live.set("one", { state });
  let result = await b.readPage("one"),
    merged = result.data.turns,
    pages = 1;
  assert.equal(merged[0].id, "t10");
  assert.equal(merged[0].status, "inProgress");
  assert.equal(merged[0].startedAt, 10);
  assert.equal(merged[0].items.at(-1).id, "t10i64");
  while (result.data.page.nextCursor) {
    result = await b.readPage("one", result.data.page.nextCursor);
    merged = mergeTurns(merged, result.data.turns, true);
    assert.ok(++pages < 10);
  }
  assert.equal(merged.length, 10);
  assert.equal(new Set(merged.map((t) => t.id)).size, 10);
  assert.equal(
    merged.reduce((sum, t) => sum + t.items.length, 0),
    92,
  );
  assert.deepEqual(calls, [null, "older"]);
  const head = await b.readPage("one");
  assert.equal(
    (await b.readPage("one", null, head.data.page.nextCursor, head.headHash))
      .notModified,
    true,
  );
  entities.t10.items.push({
    id: "latest",
    type: "agentMessage",
    text: "new owner reply",
  });
  const updated = await b.readPage(
    "one",
    null,
    head.data.page.nextCursor,
    head.headHash,
  );
  assert.equal(updated.notModified, undefined);
  assert.equal(updated.data.turns[0].items.at(-1).id, "latest");
});

test("historical cursors stay historical, matching live status updates, and unrelated owners stay isolated", () => {
  const data = {
    thread: { id: "one" },
    turns: [turn("t2", 2)],
    page: { nextCursor: "older" },
  };
  const state = {
    id: "one",
    turnHistory: {
      history: {
        entitiesByKey: {
          current: {
            turnId: "t3",
            turnStartedAtMs: 3000,
            status: "inProgress",
            items: [],
          },
          match: {
            turnId: "t2",
            turnStartedAtMs: 2000,
            status: "interrupted",
            items: [],
          },
          older: {
            turnId: "t1",
            turnStartedAtMs: 1000,
            status: "completed",
            items: [],
          },
        },
      },
    },
  };
  assert.deepEqual(
    mergeLiveTurnItems(data, state).turns.map((t) => t.id),
    ["t3", "t2"],
  );
  const history = mergeLiveTurnItems(data, state, { includeNewTurns: false });
  assert.deepEqual(
    history.turns.map((t) => t.id),
    ["t2"],
  );
  assert.equal(history.turns[0].status, "interrupted");
  assert.equal(history.turns[0].items.length, 0, "current official empty item array replaces stale tool items");
  assert.deepEqual(history.page, data.page);
  assert.equal(mergeLiveTurnItems(data, { ...state, id: "two" }), data);
  assert.equal(data.turns[0].status, "completed");
});
