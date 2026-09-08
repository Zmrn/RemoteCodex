// Default is read-only. --write explicitly creates a NEW dedicated probe task.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertProbeTarget } from "../src/probe-safety.mjs";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const base = "http://127.0.0.1:43127";
const html = await (await fetch(base)).text();
const csrf = /name="bridge-csrf" content="([a-f0-9]+)"/.exec(html)?.[1];
if (!csrf) throw Error("Start the bridge first.");
const api = async (p, body) => {
  const r = await fetch(base + p, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      "X-Bridge-CSRF": csrf,
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const d = await r.json();
  if (!r.ok) throw Error(JSON.stringify(d));
  return d;
};
const evidence = {
  observedAt: new Date().toISOString(),
  status: await api("/api/status"),
  projects: await api("/api/projects"),
};
const threads = await api("/api/threads");
evidence.threadCount = threads.data.threads.length;
evidence.threadIds = threads.data.threads.map((t) => ({
  id: t.id,
  kind: t.kind,
  status: t.status,
  projectId: t.projectId,
}));
async function completed(id) {
  for (let i = 0; i < 40; i++) {
    const r = await api("/api/threads/" + id);
    if (r.data.thread.status.type === "idle" && r.data.turns.length) return r;
    await new Promise((r) => setTimeout(r, 1500));
  }
  throw Error(
    "Still running or unknown: use the desktop; do not resend automatically",
  );
}
if (process.argv.includes("--write")) {
  evidence.created = await api("/api/threads", {
    requestId: crypto.randomUUID(),
    prompt: "Reply only RETEST_FIRST_OK. Do not use tools or modify files.",
  });
  const id = evidence.created.result?.threadId;
  if (!id) throw Error("Creation outcome unknown; do not repeat");
  assertProbeTarget(await api("/api/status"), id);
  evidence.first = await completed(id);
  evidence.second = await api("/api/threads/" + id + "/messages", {
    requestId: crypto.randomUUID(),
    prompt:
      "Reply only RETEST_SECOND_OK, then repeat your previous final answer. Do not use tools.",
  });
  evidence.final = await completed(id);
  const replies = evidence.final.data.turns.flatMap((t) =>
    t.items.filter((i) => i.type === "agentMessage").map((i) => i.text),
  );
  if (
    !replies.some(
      (t) => t.includes("RETEST_FIRST_OK") && t.includes("RETEST_SECOND_OK"),
    )
  )
    throw Error("Continuity check failed");
  console.log("New official probe task:", id);
}
const dest = path.join(root, "evidence", "retest-" + Date.now() + ".json");
fs.mkdirSync(path.dirname(dest), { recursive: true });
fs.writeFileSync(dest, JSON.stringify(evidence, null, 2));
console.log("PASS", dest);
