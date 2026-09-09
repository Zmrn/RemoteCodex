// --write explicitly creates one named probe in the specified saved project.
// Never run against an existing task; retry IDs are durable and never replayed.
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Bridge, ROOT } from "../src/bridge.mjs";
import { startServer } from "../src/server.mjs";
import { parseModels } from "../src/settings.mjs";
const projectId = process.argv.find(x => x.startsWith("--project-id="))?.slice(13);
if (!projectId || !process.argv.includes("--write")) throw Error("Supply --write --project-id=<saved official project ID> for a dedicated no-tools probe");
const dir = path.join(ROOT, "work/project-official-probe"); fs.mkdirSync(dir, { recursive: true });
const file = path.join(dir, "probe.json");
const probe = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file)) : { projectId, createKey: randomUUID(), sendKey: randomUUID() };
assert.equal(probe.projectId, projectId, "Do not retarget an existing probe journal");
const save = () => fs.writeFileSync(file, JSON.stringify(probe, null, 2)); save();
const b = new Bridge(path.join(dir, "bridge"));
fs.writeFileSync(path.join(b.dataDir, "update-settings.json"), '{"automatic":false}');
const report = { source: "official-app-tools-pipe-and-owner-IPC", time: new Date().toISOString(), projectId, chain: [] };
let server;
async function until(fn) {
  const end = Date.now() + 120000;
  while (Date.now() < end) { const value = await fn(); if (value) return value; await new Promise(r => setTimeout(r, 1000)); }
  throw Error("Outcome not confirmed: retry this same journal, never a new instruction");
}
try {
  await b.connect(); report.officialPid = b.desktop.identity.officialPid;
  const catalog = (await b.projects()).data;
  const project = catalog.projects.find(p => p.projectId === projectId);
  assert.ok(project && project.projectKind === "local" && project.hostId === "local");
  const original = b.desktop.call.bind(b.desktop);
  b.desktop.call = async (name, args, context) => {
    if (["list_projects", "create_thread"].includes(name)) report.chain.push({ tool: name, ...(args?.target ? { target: args.target } : {}) });
    return original(name, args, context);
  };
  const service = await startServer({ port: 0, bridge: b }); server = service.server;
  const html = await (await fetch(service.address)).text();
  const csrf = /name="bridge-csrf"\s+content="([^"]+)"/.exec(html)[1];
  const api = async (route, body) => {
    const response = await fetch(service.address + "/api" + route, { method: body ? "POST" : "GET", headers: { "X-Bridge-CSRF": csrf, "Content-Type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
    const data = await response.json(); if (!response.ok) throw Error(data.error); return data;
  };
  if (!probe.id) {
    const models = parseModels(b.desktop.catalog), model = models.find(m => m.id === "gpt-5.6-luna") ?? models.find(m => m.efforts.includes("low")); assert.ok(model);
    const created = await api("/threads", { mode: "codex", requestId: probe.createKey, prompt: "这是 RemoteBridge-Probe 项目归属测试。只回复 PROJECT_FIRST_OK。不要使用任何工具，不要读取或修改文件。", settings: { model: model.id, effort: "low", permissionMode: "read-only" }, project: { projectId, environment: "local" } });
    assert.equal(created.status, "accepted"); probe.id = created.result?.threadId; assert.ok(probe.id); save();
    report.sameDirectory = path.resolve(created.result.cwd ?? "").toLowerCase() === path.resolve(project.path).toLowerCase();
    console.log(JSON.stringify({ stage: "created", threadId: probe.id }));
  }
  b.guardProbe(probe.id); report.threadId = probe.id;
  const read = await until(async () => {
    const r = await b.read(probe.id);
    return r.data.thread.status.type === "idle" && r.data.turns.some(t => t.items?.some(i => i.type === "agentMessage" && i.text?.includes("PROJECT_FIRST_OK"))) ? r : null;
  });
  report.sameDirectory = path.resolve(read.data.thread.cwd ?? "").toLowerCase() === path.resolve(project.path).toLowerCase();
  assert.equal(report.sameDirectory, true);
  await b.open(probe.id); report.officialNavigatedSameId = true;
  assert.equal(read.data.thread.id, probe.id);
  const second = await api("/threads/" + probe.id + "/messages", { mode: "codex", requestId: probe.sendKey, prompt: "只回复 PROJECT_SECOND_OK，并重复你上次的回答。不要使用工具，不要读取或修改文件。" });
  assert.equal(second.status, "accepted");
  await until(async () => {
    const r = await b.read(probe.id);
    const replies = r.data.turns.flatMap(t => t.items ?? []).filter(i => i.type === "agentMessage").map(i => i.text ?? "");
    return r.data.thread.id === probe.id && r.data.thread.status.type === "idle" &&
      replies.some(text => text.includes("PROJECT_SECOND_OK")) && replies.some(text => text.includes("PROJECT_FIRST_OK")) ? r : null;
  });
  const owner = await b.desktop.owner(probe.id); report.ownerClientId = owner.handledByClientId;
  report.sameTaskContinuation = true;
  const listed = (await b.threads()).data;
  const row = [...(listed.pinnedThreads ?? []), ...(listed.threads ?? [])].find(t => t.id === probe.id);
  report.officialListVisible = !!row;
  report.officialListProjectMatched = row ? row.projectId === projectId : null;
  if (row) assert.equal(row.projectId, projectId);
  report.creationProjectRecord = b.db.tests[probe.id].projectId;
  assert.equal(report.creationProjectRecord, projectId);
  report.result = "passed";
} catch (e) { report.result = "failed"; report.error = e.message; process.exitCode = 1; }
finally { b.disconnect(); if (server) { server.closeAllConnections(); await new Promise(r => server.close(r)); } fs.writeFileSync(path.join(dir, "result.json"), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report, null, 2)); }
