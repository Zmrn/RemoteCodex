import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { MessageMedia } from "../src/message-media.mjs";
import { clipboardImage, validateImage } from "../public/clipboard-images.mjs";
import { Bridge, ROOT } from "../src/bridge.mjs";
import { startServer } from "../src/server.mjs";
const scratch = () =>
  fs.mkdtempSync(path.join(ROOT, "test/scratch/attachments-"));

test("clipboard accepts a screenshot File without changing text-only paste; rejects oversize and unsupported images", () => {
  const file = new File(["non-sensitive fixture"], "screenshot.png", {
    type: "image/png",
  });
  assert.equal(
    clipboardImage({ items: [{ kind: "file", getAsFile: () => file }] }),
    file,
  );
  assert.equal(clipboardImage({ files: [file], items: [] }), file);
  assert.equal(clipboardImage({ items: [{ kind: "string" }] }), null);
  assert.equal(validateImage(file), file);
  assert.throws(
    () => validateImage({ type: "image/png", size: 6 * 1024 * 1024 }),
    /5 MB/,
  );
  assert.throws(
    () => validateImage({ type: "image/svg+xml", size: 12 }),
    /PNG/,
  );
});

test("message file wrappers and assistant links become scoped IDs preserving original bytes", () => {
  const dir = scratch(),
    file = path.join(dir, "原始附件.bin"),
    bytes = Buffer.from([0, 255, 1, 2, 9, 10]);
  fs.writeFileSync(file, bytes);
  const media = new MessageMedia();
  const result = media.decorate("one", {
    turns: [
      {
        items: [
          {
            type: "userMessage",
            content: [
              {
                type: "text",
                text: `# Files mentioned by the user:\n\n## 原始附件.bin: ${file}\n\n## My request:\n检查附件`,
              },
            ],
          },
          { type: "agentMessage", text: `下载 [原始附件](<${file}>)` },
        ],
      },
    ],
  });
  const refs = result.turns[0].items.map((i) => i.bridgeDisplay.files[0]);
  assert.ok(refs[0].id);
  assert.equal(refs[0].id, refs[1].id);
  assert.ok(!JSON.stringify(refs).includes(dir));
  assert.equal(media.listFiles("one").length, 1);
  assert.throws(() => media.openFile("two", refs[0].id), /此会话/);
  assert.throws(() => media.openFile("one", "../../secret"), /此会话/);
  const open = media.openFile("one", refs[0].id);
  try {
    assert.deepEqual(fs.readFileSync(open.fd), bytes);
  } finally {
    fs.closeSync(open.fd);
  }
  assert.equal(media.addFile("one", String.raw`\\server\secret.txt`), null);
  assert.equal(media.addFile("one", dir), null);
  fs.unlinkSync(file);
  assert.throws(() => media.openFile("one", refs[0].id));
});

test("normal historical task downloads only registered attachments through authenticated streaming endpoint", async () => {
  const dir = scratch(),
    file = path.join(dir, "output.txt");
  fs.writeFileSync(file, "original attachment\r\n原文件");
  fs.writeFileSync(
    path.join(dir, "update-settings.json"),
    '{"automatic":false}',
  );
  const bridge = new Bridge(dir),
    id = "77777777-7777-4777-8777-777777777777";
  bridge.connect = async () => {};
  const ref = bridge.media.addFile(id, file);
  const instance = await startServer({ port: 0, bridge });
  try {
    const headers = { "X-Bridge-CSRF": instance.secret };
    const route = instance.address + "/api/threads/" + id;
    const list = await (await fetch(route + "/files", { headers })).json();
    assert.equal(list.files[0].id, ref.id);
    const response = await fetch(route + "/file?id=" + ref.id, { headers });
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-disposition"), /^attachment;/);
    assert.deepEqual(
      Buffer.from(await response.arrayBuffer()),
      fs.readFileSync(file),
    );
    assert.notEqual((await fetch(route + "/file?id=" + ref.id)).status, 200);
    assert.notEqual(
      (await fetch(route + "/file?name=../output.txt", { headers })).status,
      200,
    );
  } finally {
    instance.server.closeAllConnections();
    await new Promise((r) => instance.server.close(r));
  }
});
