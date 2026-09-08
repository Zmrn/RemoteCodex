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
