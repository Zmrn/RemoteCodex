import test from "node:test";
import assert from "node:assert/strict";
import { Pipe, encode, MAX_INBOUND_FRAME } from "../src/transport.mjs";

test("a fragmented owner snapshot larger than 32 MiB is decoded once, including the following frame", () => {
  const pipe = new Pipe("unused", "desktop");
  const text = "x".repeat(34 * 1024 * 1024) + "尾部图片与输出";
  const bytes = Buffer.from(JSON.stringify({ type: "broadcast", text }));
  const header = Buffer.alloc(4);
  header.writeUInt32LE(bytes.length);
  const seen = [];
  pipe.on("frame", (frame) => seen.push(frame));
  pipe.data(header.subarray(0, 1));
  pipe.data(header.subarray(1));
  for (let offset = 0; offset < bytes.length; offset += 4093)
    pipe.data(bytes.subarray(offset, offset + 4093));
  pipe.data(encode({ type: "broadcast", next: true }));
  assert.equal(seen.length, 2);
  assert.equal(seen[0].text, text);
  assert.equal(seen[1].next, true);
  assert.equal(pipe.payload, null);
  assert.equal(pipe.headerBytes, 0);
});

test("oversized and empty headers fail before allocation; disconnect discards incomplete payloads", () => {
  for (const size of [0, MAX_INBOUND_FRAME + 1, 0xffffffff]) {
    const pipe = new Pipe("unused");
    const h = Buffer.alloc(4);
    h.writeUInt32LE(size);
    assert.throws(() => pipe.data(h), new RegExp(String(size) + " bytes"));
    assert.equal(pipe.payload, null);
  }
  const pipe = new Pipe("unused"),
    bytes = encode({ type: "broadcast", text: "incomplete" });
  pipe.data(bytes.subarray(0, 8));
  assert.ok(pipe.payload);
  pipe.fail(Error("viewer disconnected"));
  assert.equal(pipe.payload, null);
  let next;
  pipe.on("frame", (frame) => (next = frame));
  pipe.data(encode({ type: "broadcast", ok: true }));
  assert.equal(next.ok, true);
});
