// Explicit write test: only the dedicated Probe recorded in this report.
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { assertProbeTarget } from "../src/probe-safety.mjs";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."),
  base = "http://127.0.0.1:43127";
const runName = process.argv
  .find((a) => a.startsWith("--run-name="))
  ?.slice(11);
if (runName && !/^[a-zA-Z0-9_-]{1,40}$/.test(runName))
  throw Error("Invalid run name");
const file = path.join(
  root,
  "evidence/ui-v6-queue-live" + (runName ? "-" + runName : "") + ".json",
);
const csrf = (await (await fetch(base)).text()).match(
  /name="bridge-csrf" content="([a-f0-9]+)"/,
)[1];
const api = async (route, body) => {
  const r = await fetch(base + "/api" + route, {
    method: body ? "POST" : "GET",
    headers: {
      "X-Bridge-CSRF": csrf,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const d = await r.json();
  if (!r.ok) throw Error(d.error);
  return d;
};
const save = () => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(report, null, 2));
};
let report;
if (process.argv.includes("--create")) {
  if (fs.existsSync(file))
    throw Error(
      "Evidence already exists; reuse --run, never create another task automatically",
    );
  const r = await api("/threads", {
    requestId: randomUUID(),
    prompt: "只回复 QUEUE_PROBE_READY。不要使用工具，不要读写文件。",
    settings: { model: "gpt-5.6-luna", effort: "low" },
  });
  assert.equal(r.status, "accepted");
  report = {
    createdAt: new Date().toISOString(),
    threadId: r.result.threadId,
    checks: {},
    events: [],
  };
  save();
  console.log(report.threadId);
  process.exit(0);
}
if (!process.argv.includes("--run"))
  throw Error(
    "Use --create or --run; both operate the dedicated Probe and consume model quota",
  );
report = JSON.parse(fs.readFileSync(file, "utf8"));
const id = report.threadId;
assertProbeTarget(await api("/status"), id);
const waitFor = async (predicate, ms = 90000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const r = await api("/threads/" + id);
    if (predicate(r)) return r;
    await new Promise((r) => setTimeout(r, 800));
  }
  throw Error("Probe condition timeout");
};
const queue = () => api(`/threads/${id}/queue`);
const mutate = async (action, extra = {}) => {
  const q = await queue();
  const r = await api(`/threads/${id}/queue`, {
    requestId: randomUUID(),
    action,
    revision: q.revision,
    ...extra,
  });
  assert.equal(r.status, "accepted");
  return r.result;
};
try {
  await waitFor((r) => r.data.thread.status.type === "idle");
  if (process.argv.includes("--retry-verified-idle")) {
    assert.equal(report.status, "failed");
    assert.equal((await queue()).messages.length, 0);
    fs.writeFileSync(
      path.join(root, "evidence/ui-v6-first-attempt.json"),
      JSON.stringify(report, null, 2),
    );
    for (const recovery of (await queue()).recoveries ?? [])
      await api(`/threads/${id}/queue`, {
        action: "ack-recovery",
        recoveryId: recovery.recoveryId,
      });
    report = {
      createdAt: report.createdAt,
      threadId: id,
      checks: {},
      retryReason:
        "Disk persistence lag fixed: live owner broadcasts are authoritative",
    };
  }
  if (report.holdSent)
    throw Error(
      "Previous write test already started; inspect evidence before any rerun",
    );
  report.holdSent = true;
  save();
  const sent = await api(`/threads/${id}/messages`, {
    requestId: randomUUID(),
    prompt:
      "测试运行中排队：请只调用 clock.sleep 等待 45000 毫秒，然后只回复 QUEUE_HOLD_DONE。不要读写文件，不要使用其他工具。如果等待期间收到新指令，则按新指令回复。",
  });
  assert.equal(sent.status, "accepted");
  let active = await waitFor(
    (r) =>
      r.data.thread.status.type === "active" &&
      JSON.stringify(r.live?.state ?? {}).includes("sleep"),
  );
  report.activeTurnId = active.data.turns.find(
    (t) => t.status === "inProgress",
  )?.id;
  save();
  const before = await queue();
  assert.equal(before.messages.length, 0);
  const imagePath = fs
    .readdirSync(path.join(root, "fixtures"))
    .find((f) => f.endsWith(".png"));
  const imageDataUrl =
    "data:image/png;base64," +
    fs.readFileSync(path.join(root, "fixtures", imagePath)).toString("base64");
  const edit = await mutate("enqueue", {
    prompt: "QUEUE_EDIT_ORIGINAL 不要执行，应取回编辑",
    imageDataUrl,
  });
  let q = await queue();
  assert.ok(q.messages.some((m) => m.id === edit.messageId));
  report.queuedMessageId = edit.messageId;
  report.queueSource = q.source;
  save();
  const take = await mutate("take", { messageId: edit.messageId });
  assert.equal(take.disposition, "draft");
  assert.equal(take.draft.imageDataUrl, imageDataUrl);
  assert.equal((await queue()).messages.length, 0);
  report.checks.takeBackPreservesTextAndOriginalImage = true;
  save();
  const revised = await mutate("enqueue", {
    prompt: "QUEUE_EDIT_REVISED 不要执行，应删除",
    imageDataUrl: take.draft.imageDataUrl,
  });
  await mutate("delete", { messageId: revised.messageId });
  await api(`/threads/${id}/queue`, {
    action: "ack-recovery",
    recoveryId: take.recoveryId,
  });
  report.checks.requeueEditedAndDelete = true;
  save();
  const automatic = await mutate("enqueue", {
    prompt: "只回复 QUEUE_AUTO_NEXT_OK。不要使用工具。",
  });
  const steer = await mutate("enqueue", {
    prompt:
      "调整方向测试：取消等待，现在仅回复 QUEUE_STEER_CURRENT_OK。不要使用工具。",
  });
  report.autoMessageId = automatic.messageId;
  report.steerMessageId = steer.messageId;
  save();
  const steered = await mutate("steer", { messageId: steer.messageId });
  report.steerResult = steered;
  save();
  assert.equal(steered.disposition, "steered");
  assert.equal(steered.turnId, report.activeTurnId);
  report.checks.steerUsesSameRunningTurn = true;
  save();
  await api("/disconnect", {});
  report.disconnectedAt = new Date().toISOString();
  save();
  // Only viewing is disconnected. The official owner drains its own queue.
  await new Promise((r) => setTimeout(r, 12000));
  await api("/connect", {});
  await api(`/threads/${id}/follow`, {});
  const final = await waitFor(
    (r) =>
      r.data.thread.status.type === "idle" &&
      JSON.stringify(r.data.turns).includes("QUEUE_AUTO_NEXT_OK"),
  );
  const all = JSON.stringify(final.data.turns);
  const replies = final.data.turns.flatMap((t) =>
    (t.items ?? []).filter((i) => i.type === "agentMessage"),
  );
  for (const marker of ["QUEUE_STEER_CURRENT_OK", "QUEUE_AUTO_NEXT_OK"])
    assert.equal(replies.filter((i) => i.text?.trim() === marker).length, 1);
  assert.equal((await queue()).messages.length, 0);
  const turns = final.data.turns.map((t) => ({
    id: t.id,
    status: t.status,
    items: (t.items ?? [])
      .filter((i) =>
        ["userMessage", "agentMessage", "steeringUserMessage"].includes(i.type),
      )
      .map((i) => ({
        id: i.id,
        type: i.type,
        text:
          i.text ??
          i.content
            ?.filter((c) => c.type === "text")
            .map((c) => c.text)
            .join("\n"),
        clientUserMessageId: i.clientUserMessageId,
      })),
  }));
  report.turns = turns;
  report.checks.officialQueueAutoRunsAfterCurrentTurn = true;
  report.checks.viewerReconnectReadsFinalQueue = true;
  report.timingLimit =
    "No exact start/end timestamp sampled around disconnect; not proof that the queue was still pending at disconnect. The model did not provide clock.sleep; no 45-second wait is claimed.";
  report.status = "passed";
} catch (e) {
  report.status = "failed";
  report.failure = e.message;
  throw e;
} finally {
  report.finishedAt = new Date().toISOString();
  save();
  console.log(JSON.stringify(report, null, 2));
}
