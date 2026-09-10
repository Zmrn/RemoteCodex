// Explicit real stop test, confined to one dedicated task created by this script.
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Bridge, ROOT } from "../src/bridge.mjs";
import { activeTurnId, liveTurns } from "../src/state.mjs";
import { parseModels } from "../src/settings.mjs";
import { OFFICIAL } from "../src/official-protocol.mjs";
if (!process.argv.includes("--create-probe")) throw Error("Use --create-probe for one isolated official task");
const dir = fs.mkdtempSync(path.join(ROOT, "work/interrupt-live-")), b = new Bridge(path.join(dir, "bridge"));
const report = { time: new Date().toISOString(), source: "official-desktop-owner-IPC", checks: [], requests: [], events: [] };
let id;
const until = async fn => {
  const deadline = Date.now() + 90000;
  while (Date.now() < deadline) { const value = await fn(); if (value) return value; await new Promise(r => setTimeout(r, 500)); }
  throw Error("Timed out; inspect this dedicated task before retrying");
};
try {
  await b.connect();
  report.officialPid = b.desktop.identity.officialPid;
  report.officialVersion = b.status().desktopCompatibility.detectedVersion;
  const model = parseModels(b.desktop.catalog).find(m => m.id === "gpt-5.6-luna");
  assert.ok(model?.efforts.includes("low"));
  const created = await b.createProbe("interrupt-create-" + randomUUID(),
    "这是 RemoteBridge 专用停止功能测试。请使用 clock.sleep 等待 45 秒，若没有该工具则用一次 PowerShell Start-Sleep -Seconds 45。等待后只回复 STOP_PROBE_FINISHED。不要访问网络、读取或修改文件，不要调用其他工具。",
    { model: model.id, effort: "low" });
  id = report.threadId = created.result.threadId;
  b.guardProbe(id);
  console.log(JSON.stringify({ stage: "created", threadId: id, directory: dir }));
  b.on("event", e => {
    if (e.threadId === id && ["thread-state", "interrupt-requested"].includes(e.kind))
      report.events.push({ kind: e.kind, time: e.time, status: e.status, revision: e.revision, ownerClientId: e.ownerClientId });
  });
  await b.follow(id);
  report.turnId = await until(() => activeTurnId(b.live.get(id)?.state));
  const original = b.desktop.ipc.request.bind(b.desktop.ipc);
  b.desktop.ipc.request = async (method, params, options) => {
    if ([OFFICIAL.ipc.interrupt.method, OFFICIAL.ipc.start.method].includes(method)) {
      b.guardProbe(params.conversationId); assert.equal(params.conversationId, id);
      report.requests.push({ method, targetClientId: options.targetClientId, conversationId: params.conversationId, expectedTurnId: params.expectedTurnId });
    }
    return original(method, params, options);
  };
  // Allow the owner to enter real execution; current turn ID is still checked at dispatch.
  await until(() => liveTurns(b.live.get(id)?.state).at(-1)?.items?.some(i => i.type !== "userMessage"));
  const key = "interrupt-stop-" + randomUUID();
  const ack = await b.interrupt(id, key, report.turnId);
  assert.equal(ack.status, "accepted");
  report.ack = { handledByClientId: ack.result.handledByClientId, requestId: ack.result.requestId, result: ack.result.result };
  report.stopped = await until(() => {
    const state = b.live.get(id)?.state, turn = liveTurns(state).find(t => t.turnId === report.turnId);
    return state?.threadRuntimeStatus?.type === "idle" && turn?.status === "interrupted"
      ? { runtime: state.threadRuntimeStatus.type, turnStatus: turn.status, owner: b.live.get(id).owner } : null;
  });
  assert.equal((await b.interrupt(id, key, report.turnId)).deduplicated, true);
  report.checks.push("same official owner acknowledged stop; real owner event confirmed interrupted and idle; duplicate not dispatched");
  const after = await b.nativeSend(id, "interrupt-continue-" + randomUUID(), "只回复 STOP_PROBE_CONTINUED。不要使用工具。");
  assert.equal(after.status, "accepted");
  report.continuedTurnId = after.result.result?.result?.turn?.id;
  await until(async () => {
    const r = await b.read(id);
    return r.data.thread.id === id && r.data.turns.some(t =>
      t.id === report.continuedTurnId && t.status === "completed" &&
      t.items.some(i => i.type === "agentMessage" && i.text?.includes("STOP_PROBE_CONTINUED")));
  });
  report.checks.push("continued in the same official task after stop and received expected reply");
  report.passed = true;
} catch (e) { report.passed = false; report.error = e.message; process.exitCode = 1; }
finally { b.disconnect(); clearInterval(b.subscriptionTimer); fs.writeFileSync(path.join(dir, "report.json"), JSON.stringify(report, null, 2)); console.log(JSON.stringify({ ...report, directory: dir })); }
