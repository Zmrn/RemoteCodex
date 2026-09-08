// Measure only metadata/byte counts; never persist private message bodies.
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { gunzipSync } from "node:zlib";
import assert from "node:assert/strict";
import { ROOT } from "../src/bridge.mjs";
const [agentId, threadId] = process.argv.slice(2);
assert.ok(
  /^[\w-]+$/.test(agentId ?? "") && /^[a-f0-9-]{36}$/.test(threadId ?? ""),
  "Use SAVED_AGENT_ID TASK_ID",
);
const state = JSON.parse(
  fs.readFileSync(
    path.join(process.env.LOCALAPPDATA, "RemoteCodex/data/server.json"),
  ),
);
const html = await (await fetch(state.address)).text();
const headers = {
  "X-Bridge-CSRF": html.match(/name="bridge-csrf"\s+content="([^"]+)"/)[1],
  "Accept-Encoding": "gzip",
};
const prefix = "/api/agents/" + agentId + "/bridge";
const version = await (
  await fetch(state.address + prefix + "/updates", { headers })
).json();
assert.equal(
  version.currentVersion,
  "0.9.8",
  "Update target bridge before measuring pagination",
);
const snapshot = await (
  await fetch(state.address + prefix + "/status", { headers })
).json();
const raw = (query) =>
  new Promise((resolve, reject) => {
    const start = Date.now();
    const req = http.get(
      state.address +
        prefix +
        "/threads/" +
        threadId +
        "?view=conversation&paging=items-v1" +
        query,
      { headers },
      (res) => {
        const headerMs = Date.now() - start,
          chunks = [];
        res.on("data", (b) => chunks.push(b));
        res.on("error", reject);
        res.on("end", () => {
          try {
            const bytes = Buffer.concat(chunks),
              decoded =
                res.headers["content-encoding"] === "gzip"
                  ? gunzipSync(bytes)
                  : bytes;
            const data = JSON.parse(decoded);
            assert.equal(res.statusCode, 200, data.error);
            resolve({
              data,
              stats: {
                http: res.statusCode,
                ms: Date.now() - start,
                headerMs,
                wireBytes: bytes.length,
                decodedBytes: decoded.length,
                turns: data.data?.turns.length,
                items: data.data?.turns.reduce((n, t) => n + t.items.length, 0),
                notModified: data.notModified ?? false,
              },
            });
          } catch (e) {
            reject(e);
          }
        });
      },
    );
    req.setTimeout(45000, () => req.destroy(Error("Read timeout")));
    req.on("error", reject);
  });
const first = await raw("");
assert.equal(first.data.data.thread.id, threadId);
assert.equal(first.data.data.page.pagination, "items-v1");
const pages = [{ kind: "initial", ...first.stats }];
if (first.data.data.page.nextCursor) {
  const older = await raw(
    "&before=" + encodeURIComponent(first.data.data.page.nextCursor),
  );
  pages.push({ kind: "older", ...older.stats });
  assert.equal(older.data.data.thread.id, threadId);
}
const unchanged = await raw(
  "&known=" +
    first.data.headHash +
    "&retain=" +
    encodeURIComponent(first.data.data.page.nextCursor ?? ""),
);
pages.push({ kind: "head-refresh", ...unchanged.stats });
const report = {
  result: "passed",
  observedAt: new Date().toISOString(),
  localVersion: state.version,
  targetVersion: version.currentVersion,
  agentId,
  threadId,
  officialPid: snapshot.officialPid,
  pages,
};
fs.mkdirSync(path.join(ROOT, "evidence"), { recursive: true });
fs.writeFileSync(
  path.join(ROOT, "evidence/pagination-live-" + agentId + ".json"),
  JSON.stringify(report, null, 2),
);
console.log(JSON.stringify(report));
