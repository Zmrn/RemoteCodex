// Read/download only a public report created by this project in the official task.
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { ROOT } from "../src/bridge.mjs";
const id = process.env.CODEX_THREAD_ID;
assert.match(id ?? "", /^[a-f0-9-]{36}$/);
const runtime = JSON.parse(
  fs.readFileSync(
    path.join(process.env.LOCALAPPDATA, "RemoteCodex/data/server.json"),
  ),
);
const html = await (await fetch(runtime.address)).text();
const headers = {
  "X-Bridge-CSRF": html.match(/name="bridge-csrf"\s+content="([^"]+)"/)[1],
};
const prefix = runtime.address + "/api/threads/" + id;
const snapshot = await (
  await fetch(runtime.address + "/api/status", { headers })
).json();
const read = await (
  await fetch(prefix + "?view=conversation&paging=items-v1", { headers })
).json();
assert.equal(read.data.thread.id, id);
const listed = await (await fetch(prefix + "/files", { headers })).json();
const ref = listed.files.find((f) => f.name === "RECONNECT-VALIDATION.md");
assert.ok(ref, "Public report link not in recent official messages");
const response = await fetch(prefix + "/file?id=" + ref.id, { headers });
assert.equal(response.status, 200);
const actual = Buffer.from(await response.arrayBuffer());
const expected = fs.readFileSync(path.join(ROOT, "RECONNECT-VALIDATION.md"));
assert.deepEqual(actual, expected);
const report = {
  result: "passed",
  source: "installed bridge and actual official conversation file reference",
  version: runtime.version,
  officialPid: snapshot.officialPid,
  threadId: id,
  name: ref.name,
  bytes: actual.length,
  sha256: createHash("sha256").update(actual).digest("hex"),
  taskWrites: 0,
};
fs.writeFileSync(
  path.join(ROOT, "evidence/attachment-live.json"),
  JSON.stringify(report, null, 2),
);
console.log(JSON.stringify(report));
