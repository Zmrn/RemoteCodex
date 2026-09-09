// Fixed, explicitly requested compatibility tests; never accepts task IDs or prompts.
// Candidate versions remain read-only for normal operations until source + live
// results are reviewed and the central verifiedVersions catalog is updated.
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { Bridge } from "./bridge.mjs";
import { OFFICIAL, desktopCompatibility } from "./official-protocol.mjs";
import { activeTurnId } from "./state.mjs";
import { parseModels } from "./settings.mjs";
import { assertProbeTarget } from "./probe-safety.mjs";
const images = JSON.parse(fs.readFileSync(new URL("./probe-images.json", import.meta.url)));
const candidates = () => [...OFFICIAL.support.verifiedVersions, ...(OFFICIAL.probeCandidates ?? [])];
export function sourceProtocols(image) {
  const asar = path.join(path.dirname(image), "resources", "app.asar"), fd = fs.openSync(asar, "r");
  try {
    const prefix = Buffer.alloc(16); fs.readSync(fd, prefix, 0, 16, 0);
    const size = prefix.readUInt32LE(12), offset = 8 + prefix.readUInt32LE(4);
    if (size > 16 * 1024 * 1024 || size < 2) throw Error("Unexpected ASAR header");
    const raw = Buffer.alloc(size); fs.readSync(fd, raw, 0, size, 16);
    const tree = JSON.parse(raw), files = [];
    const walk = (entries, prefix = "") => { for (const [name, item] of Object.entries(entries ?? {})) {
      const key = prefix + name; if (item.files) walk(item.files, key + "/");
      else if (/^\.vite\/build\/src-[\w-]+\.js$/.test(key)) files.push({ key, item });
    } };
    walk(tree.files);
    const records = [];
    for (const { key, item } of files) {
      if (item.unpacked || item.size > 32 * 1024 * 1024 || !Number.isSafeInteger(Number(item.offset))) continue;
      const buf = Buffer.alloc(item.size); fs.readSync(fd, buf, 0, buf.length, offset + Number(item.offset));
      const text = buf.toString("utf8");
      if (!text.includes('"' + OFFICIAL.ipc.start.method + '":')) continue;
      const methods = {};
      for (const spec of Object.values(OFFICIAL.ipc)) {
        const at = text.indexOf('"' + spec.method + '":');
        if (at >= 0) methods[spec.method] = Number(/^\d+/.exec(text.slice(at + spec.method.length + 3))?.[0]);
      }
      records.push({ file: key, sha256: createHash("sha256").update(buf).digest("hex"), methods });
    }
    return records;
  } finally { fs.closeSync(fd); }
}
export async function inspectDesktop(desktop) {
  const compatibility = desktopCompatibility(desktop.identity.appToolsPipe.image);
  const catalog = await desktop.refreshCatalog();
  const tools = Object.values(OFFICIAL.tools).map(spec => {
    const tool = catalog.find(t => t.namespace === OFFICIAL.discovery.toolsNamespace && t.name === spec.name);
    return { name: spec.name, available: !!tool, missing: spec.request.filter(k => !Object.hasOwn(tool?.inputSchema?.properties ?? {}, k)) };
  });
  const source = sourceProtocols(desktop.identity.appToolsPipe.image);
  const required = Object.values(OFFICIAL.ipc).filter(s => s.method.startsWith("thread-"));
  const matches = source.some(s => required.every(spec => s.methods[spec.method] === spec.version));
  return { compatibility, connection: desktop.identity.connection, tools, source, schemaMatched: tools.every(t => t.available && !t.missing.length), sourceProtocolsMatched: matches };
}
export class CompatibilityProbes {
  constructor(dir) { this.dir = path.join(dir, "compatibility-probes"); fs.mkdirSync(this.dir, { recursive: true }); this.running = new Map(); }
  file(key) { if (!/^[a-zA-Z0-9-]{8,80}$/.test(key ?? "")) throw Error("Invalid compatibility probe request ID"); return path.join(this.dir, key + ".json"); }
  read(key) { const file = this.file(key); if (!fs.existsSync(file)) return { phase: "not-found" };
    const saved = JSON.parse(fs.readFileSync(file, "utf8"));
    return saved.phase === "running" && !this.running.has(key) ? { ...saved, phase: "outcome-unknown" } : saved;
  }
  start({ requestId, expectedVersion, scenario, ...extra }) {
    if (scenario !== "create-vision-owner-v1" || Object.keys(extra).length || !candidates().includes(expectedVersion))
      throw Error("Only the fixed, catalog-listed compatibility scenario is allowed");
    const file = this.file(requestId);
    if (fs.existsSync(file)) {
      const saved = this.read(requestId); if (saved.expectedVersion !== expectedVersion) throw Error("Probe ID reused for another version");
      return saved; // Never replay a job after crash/restart.
    }
    if (this.running.size) throw Error("A compatibility probe is already running");
    const report = { requestId, expectedVersion, scenario, phase: "running", startedAt: new Date().toISOString(), checks: [], requests: [] };
    const save = () => { fs.writeFileSync(file + ".tmp", JSON.stringify(report, null, 2)); fs.renameSync(file + ".tmp", file); };
    save();
    const run = this.run(report, save).catch(e => { report.phase = "failed"; report.error = e.message; save(); }).finally(() => this.running.delete(requestId));
    this.running.set(requestId, run);
    return report;
  }
  async run(report, save) {
    const b = new Bridge(path.join(this.dir, report.requestId));
    const check = (name, value) => { assert.ok(value, name); report.checks.push(name); save(); };
    const until = async fn => { const end = Date.now() + 120000; while (Date.now() < end) { const r = await fn(); if (r) return r; await new Promise(r => setTimeout(r, 700)); } throw Error("Probe timed out; job will not be replayed"); };
    try {
      await b.connect(); report.preflight = await inspectDesktop(b.desktop); save();
      check("exact expected official process build", report.preflight.compatibility.detectedVersion === report.expectedVersion);
      check("live tools schema and installed owner protocol source match", report.preflight.schemaMatched && report.preflight.sourceProtocolsMatched);
      // This private instance is accessible only to this fixed test, never the
      // normal API bridge. Every ID mutation must be one of its own new tasks.
      b.requireSupportedBuild = () => {
        assert.equal(desktopCompatibility(b.desktop.identity.appToolsPipe.image).detectedVersion, report.expectedVersion);
      };
      b.guard = id => { b.requireSupportedBuild(); assertProbeTarget({ testThreads: b.db.tests }, id); };
      const model = parseModels(b.desktop.catalog).find(m => m.id === "gpt-5.6-luna");
      check("test model exists in live catalog", model?.efforts.includes("low"));
      const key = report.requestId;
      const initial = await b.create(key + "-text", "RemoteBridge-Probe 兼容性文字创建测试，只回复 TEXT_CREATE_OK。不要使用工具。", { model: model.id, effort: "low" });
      const textId = initial.result?.threadId; check("official text task created", !!textId);
      report.textThreadId = textId; save();
      await until(async () => { const r = await b.read(textId); return r.data.thread.status?.type === "idle" && r.data.turns.some(t => t.items?.some(i => i.type === "agentMessage" && i.text?.includes("TEXT_CREATE_OK"))); });
      const created = await b.create(key + "-images", "不要使用工具。按顺序描述两张图片的背景颜色和中间图形的形状、颜色。", { model: model.id, effort: "low" }, undefined, images);
      const id = created.result?.threadId; check("image task created with one submitted image batch", created.status === "accepted" && !!id);
      report.imageThreadId = id; save(); b.guard(id);
      const imageRead = await until(async () => { const r = await b.read(id); return r.data.thread.status?.type === "idle" && r.data.turns.some(t => t.id === created.result.imageTurnId && t.status === "completed") ? r : null; });
      const turn = imageRead.data.turns.find(t => t.id === created.result.imageTurnId);
      const reply = turn.items.filter(i => i.type === "agentMessage").map(i => i.text).join("\n");
      check("model sees both images: red blue white yellow circle square", [/红|red/i,/蓝|blue/i,/白|white/i,/黄|yellow/i,/圆|circle/i,/方|square/i].every(re => re.test(reply)));
      const owner = (await b.follow(id)).handledByClientId; report.ownerClientId = owner;
      const recordRequests = () => {
        const original = b.desktop.ipc.request.bind(b.desktop.ipc);
        b.desktop.ipc.request = async (method, params, options) => {
          let record;
          if (params?.conversationId && method !== OFFICIAL.ipc.owner.method) {
            b.guard(params.conversationId); assert.equal(params.conversationId, id);
            record = { method, conversationId: id, targetClientId: options.targetClientId };
            report.requests.push(record); save();
          }
          const response = await original(method, params, options);
          if (record) { record.handledByClientId = response.handledByClientId; save(); }
          return response;
        };
      };
      recordRequests();
      const settings = await b.updateSettings(id, key + "-settings", { model: model.id, effort: "low", permissionMode: "read-only" });
      check("model/effort/permission settings same owner", settings.status === "accepted");
      await b.nativeSend(id, key + "-hold", "这是停止和重连测试。请使用 clock.sleep 等待 45 秒；如无该工具，用一次 PowerShell Start-Sleep -Seconds 45。不要读写文件或访问网络。等待后只回复 HOLD_DONE。");
      const active = await until(() => activeTurnId(b.live.get(id)?.state));
      const queue = b.queue.read(id);
      const queued = await b.queue.mutate(id, key + "-queue", { action: "enqueue", revision: queue.revision, prompt: "只回复 QUEUE_CHECK。不要使用工具。" });
      check("queue accepted by existing owner", queued.status === "accepted");
      await until(() => b.queue.read(id).messages.some(m => m.id === key + "-queue"));
      const removed = await b.queue.mutate(id, key + "-remove", { action: "delete", revision: b.queue.read(id).revision, messageId: key + "-queue" });
      check("queue removal accepted", removed.status === "accepted");
      b.disconnect(); await b.connect(); await b.follow(id);
      report.reconnectedVia = b.desktop.identity.connection;
      recordRequests();
      check("viewer reconnect retains active task and turn", await until(() => activeTurnId(b.live.get(id)?.state) === active));
      const stopped = await b.interrupt(id, key + "-stop", active);
      check("same owner confirms stop", stopped.status === "accepted" && stopped.result.handledByClientId === owner);
      await until(() => b.live.get(id)?.state?.threadRuntimeStatus?.type === "idle");
      const next = await b.nativeSend(id, key + "-continue", "只回复 SAME_TASK_CONTINUED。不要使用工具。");
      check("continue same task after stop", next.status === "accepted");
      await until(async () => { const r = await b.read(id); return r.data.thread.id === id && r.data.thread.status?.type === "idle" && r.data.turns.some(t => t.items?.some(i => i.type === "agentMessage" && i.text?.includes("SAME_TASK_CONTINUED"))); });
      report.liveEvidence = b.events.filter(e => e.kind === "thread-state" && e.threadId === id)
        .map(e => ({ time: e.time, ownerClientId: e.ownerClientId, revision: e.revision, changeType: e.changeType, status: e.status }));
      report.phase = "passed"; report.finishedAt = new Date().toISOString(); save();
    } finally { b.disconnect(); clearInterval(b.subscriptionTimer); }
  }
}
