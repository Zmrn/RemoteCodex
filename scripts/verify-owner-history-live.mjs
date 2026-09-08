// Read-only comparison against the same official conversation owner. No bodies
// or attachments are written to evidence; keep only IDs, counts and hashes.
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mergeLiveTurnItems } from "../src/state.mjs";
import {
  ConversationPages,
  compactConversation,
} from "../src/conversation-pages.mjs";
import { MessageMedia } from "../src/message-media.mjs";
import { mergeTurns } from "../public/conversation-history.mjs";
const [agent, id, mode = "installed"] = process.argv.slice(2);
assert.match(agent ?? "", /^[\w-]+$/);
assert.match(id ?? "", /^[a-f0-9-]{36}$/);
const dataDir = path.join(process.env.LOCALAPPDATA, "RemoteCodex/data");
const runtime = JSON.parse(fs.readFileSync(path.join(dataDir, "server.json")));
const html = await (await fetch(runtime.address)).text();
const headers = {
  "X-Bridge-CSRF": html.match(/name="bridge-csrf"\s+content="([^"]+)"/)[1],
};
const prefix = agent === "local" ? "/api" : "/api/agents/" + agent + "/bridge";
const api = async (route) => {
  const response = await fetch(runtime.address + prefix + route, {
    headers,
    signal: AbortSignal.timeout(180000),
  });
  assert.equal(response.status, 200, "Read-only endpoint failed");
  return response.json();
};
const version = (await api("/updates")).currentVersion;
const before = await api("/status");
console.log(JSON.stringify({ stage: "reading", mode, version, threadId: id }));
const raw = await api("/threads/" + id);
assert.equal(
  raw.live?.state?.id,
  id,
  "Open this task to establish its owner subscription first",
);
const owned = Object.values(
  raw.live.state.turnHistory.history.entitiesByKey,
).filter((t) => t.turnId);
const latest = owned.toSorted(
  (a, b) => b.turnStartedAtMs - a.turnStartedAtMs,
)[0];
const latestReply = latest.items
  .filter((i) => i.type === "agentMessage" && i.text)
  .at(-1);
assert.ok(latestReply);
const oldIds = new Set(raw.data.turns.map((t) => t.id));
let first,
  merged,
  pageCount = 1;
if (mode === "candidate") {
  const media = new MessageMedia(),
    pages = new ConversationPages();
  const source = {
    ...raw,
    data: compactConversation(
      media.decorate(id, mergeLiveTurnItems(raw.data, raw.live.state), {
        externalImages: true,
      }),
    ),
  };
  const read = async () => source;
  let page = (first = await pages.read(id, null, read));
  merged = page.data.turns;
  // This fixture's complete official read ends here. Do not fabricate a cursor source.
  assert.equal(raw.data.page?.hasMore, false);
  while (page.data.page.nextCursor) {
    page = await pages.read(id, page.data.page.nextCursor, read);
    merged = mergeTurns(merged, page.data.turns, true);
    assert.ok(++pageCount < 200);
  }
} else {
  first = await api("/threads/" + id + "?view=conversation&paging=items-v1");
  merged = raw.data.turns;
}
assert.equal(first.data.turns[0].id, latest.turnId);
const actual = merged
  .find((t) => t.id === latest.turnId)
  ?.items.find((i) => i.id === latestReply.id);
assert.equal(actual?.text, latestReply.text);
const ids = merged.map((t) => t.id);
assert.equal(new Set(ids).size, ids.length);
for (const t of owned)
  assert.ok(ids.includes(t.turnId), "Missing owner turn " + t.turnId);
const texts = merged
  .flatMap((t) => t.items ?? [])
  .filter((i) => /Message/.test(i.type))
  .map((i) => i.text ?? i.content?.map((c) => c.text ?? "").join("\n") ?? "");
const after = await api("/status");
assert.equal(after.officialPid, before.officialPid);
const report = {
  result: "passed",
  mode,
  version,
  threadId: id,
  officialPid: after.officialPid,
  officialUnchanged: true,
  ownerRevision: raw.live.revision,
  bridgeReadTurns: raw.data.turns.length,
  ownerTurns: owned.length,
  missingBefore: owned
    .filter((t) => !oldIds.has(t.turnId))
    .map((t) => t.turnId),
  mergedTurns: merged.length,
  latestTurnId: latest.turnId,
  latestReplyId: latestReply.id,
  latestReplySha256: createHash("sha256")
    .update(latestReply.text)
    .digest("hex"),
  screenshotFollowupFound: texts.some(
    (t) => t.trim() === "怎么停了？" || t.trim() === "怎么停了?",
  ),
  firstPageItems: first.data.turns.reduce((sum, t) => sum + t.items.length, 0),
  pageCount,
  taskWrites: 0,
};
fs.writeFileSync(
  "evidence/owner-history-" + mode + "-" + id + ".json",
  JSON.stringify(report, null, 2),
);
console.log(JSON.stringify(report));
