// Read-only measurement. Never logs task IDs, text, attachments, or credentials.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { OfficialQueue } from "../src/queue.mjs";
import { MessageMedia } from "../src/message-media.mjs";
const file = path.join(process.env.CODEX_HOME ?? path.join(os.homedir(), ".codex"), ".codex-global-state.json");
const entries = Object.entries(JSON.parse(fs.readFileSync(file, "utf8"))["queued-follow-ups"] ?? {});
const bridge = { requireConnection() {}, db: {}, media: new MessageMedia(), owners: new Map() };
const queue = new OfficialQueue(bridge, file);
const rows = [];
for (const [id, messages] of entries) {
  if (!Array.isArray(messages) || !messages.length) continue;
  const before = performance.now();
  const legacy = JSON.stringify(queue.read(id, true));
  const legacyMs = performance.now() - before;
  const next = performance.now();
  const metadata = JSON.stringify(queue.read(id, true, true));
  const metadataMs = performance.now() - next;
  rows.push({
    messages: messages.length, images: messages.reduce((n, m) => n + (m.context?.imageAttachments?.length ?? 0), 0),
    legacyBytes: Buffer.byteLength(legacy), metadataBytes: Buffer.byteLength(metadata),
    legacyGzipBytes: gzipSync(legacy).length, metadataGzipBytes: gzipSync(metadata).length,
    legacyReadMs: Math.round(legacyMs), metadataReadMs: Math.round(metadataMs),
  });
}
console.log(JSON.stringify({ source: "official-disk-read-only", savedQueues: rows.length, rows, note: "Local payload measurements; not a live owner-state or remote latency measurement." }, null, 2));
