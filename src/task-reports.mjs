import fs from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { OFFICIAL, TOOLS } from "./official-protocol.mjs";
import { lockAgents } from "./agent-storage.mjs";
import { OfficialReadState } from "./official-read-state.mjs";

const digest = value => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const active = value => ["active", "running", "inProgress", "waiting-approval", "waiting-user-input"].includes(typeof value === "string" ? value : value?.type);
const statusType = value => typeof value === "string" ? value : value?.type;
export function reportReceipt(data) {
  if (!data?.thread?.id || active(data.thread.status)) return null;
  const latest = [...(data.turns ?? [])].sort((a, b) => (b.startedAt ?? 0) - (a.startedAt ?? 0))[0];
  if (latest?.status !== "completed") return null;
  // Chat's synthetic completed flag alone is not a live completion signal.
  if (data.thread.kind === "chatgpt" && statusType(data.thread.status) !== "idle") return null;
  const item = latest.items?.filter(i => i.type === "agentMessage" && typeof i.text === "string" && i.text.trim()).at(-1);
  if (!item?.id) return null;
  return { token: digest([data.thread.id, latest.id, item.id, item.text]), itemId: item.id };
}

// A separate Remote Codex receipt store. Never modifies official read state,
// messages, devices or credentials. Only hashes and task IDs are persisted.
export class TaskReports {
  constructor(bridge, { now = Date.now } = {}) {
    this.bridge = bridge; this.now = now; this.cache = new Map(); this.issued = new Map();
    this.file = path.join(bridge.dataDir, "task-receipts.json");
  }
  receipts() {
    let raw;
    try { raw = fs.readFileSync(this.file, "utf8"); }
    catch (error) { if (error.code === "ENOENT") return { version: 1, read: {} }; throw error; }
    const state = JSON.parse(raw);
    if (state.version !== 1 || !state.read || typeof state.read !== "object" || Array.isArray(state.read) || state.sha256 !== digest(state.read) ||
        Object.entries(state.read).some(([id, tokens]) => !/^[a-f0-9-]{36}$/.test(id) || !Array.isArray(tokens) || tokens.some(t => !/^[a-f0-9]{64}$/.test(t))))
      throw Error("已读记录校验失败，已保留原文件；请检查目标电脑");
    return state;
  }
  observe(data) {
    const receipt = reportReceipt(data);
    if (!receipt) return null;
    const key = data.thread.id + ":" + receipt.token;
    this.issued.delete(key);
    this.issued.set(key, { ...receipt, kind: data.thread.kind, at: this.now() });
    while (this.issued.size > 4096) this.issued.delete(this.issued.keys().next().value);
    return receipt;
  }
  async acknowledge(id, token) {
    if (!/^[a-f0-9-]{36}$/.test(id ?? "") || !/^[a-f0-9]{64}$/.test(token ?? "")) throw Error("Invalid report receipt");
    const issued = this.issued.get(id + ":" + token);
    if (issued?.token !== token || this.now() - issued.at > 30 * 60 * 1000) return { accepted: false, reason: "report-changed" };
    let locked;
    try { locked = await lockAgents(this.file); }
    catch { throw Error("已读记录暂时无法锁定，请稍后重试；已保留原记录"); }
    const saved = await locked(() => this.commitReceipt(id, token));
    if (issued.kind !== 'codex' || !this.bridge.markOfficialReportRead) return saved;
    this.officialPending ??= new Map();
    const key = id + ':' + token;
    if (!this.officialPending.has(key)) {
      const pending = Promise.resolve().then(() => this.bridge.markOfficialReportRead(id, token)).catch(() => ({ status: 'unavailable' }))
        .finally(() => this.officialPending.delete(key));
      this.officialPending.set(key, pending);
    }
    return { ...saved, officialReadSync: await this.officialPending.get(key) };
  }
  commitReceipt(id, token) {
    const state = this.receipts();
    if (state.read[id]?.includes(token)) return { accepted: true };
    // Append exact report hashes. An older page can acknowledge its own report,
    // but cannot clear a newer report or undo a newer receipt.
    const read = { ...state.read, [id]: [...(state.read[id] ?? []), token] };
    const next = { version: 1, read, sha256: digest(read) }, tmp = this.file + "." + randomUUID() + ".tmp";
    let fd;
    try {
      fd = fs.openSync(tmp, "wx"); fs.writeFileSync(fd, JSON.stringify(next)); fs.fsyncSync(fd); fs.closeSync(fd); fd = undefined;
      fs.renameSync(tmp, this.file);
    } finally { if (fd !== undefined) fs.closeSync(fd); fs.rmSync(tmp, { force: true }); }
    this.bridge.emitEvent?.("report-read", { threadId: id });
    return { accepted: true };
  }
  async summary() {
    this.bridge.requireConnection();
    if (this.pending) return this.pending;
    this.pending = this.collect().finally(() => { this.pending = null; });
    return this.pending;
  }
  async collect() {
    const bridge = this.bridge, desktop = bridge.desktop;
    if (this.cacheDesktop !== desktop) { this.cacheDesktop = desktop; this.cache.clear(); }
    const current = () => { bridge.requireConnection(); if (desktop !== bridge.desktop) throw Error("Viewer connection changed during summary"); };
    const list = (await bridge.threads(50, { timeoutMs: 6000 })).data; current();
    const deadline = this.now() + 10000;
    this.receipts();
    const rows = [...new Map([...(list.pinnedThreads ?? []), ...(list.threads ?? [])]
      .filter(t => ["codex", "chatgpt"].includes(t.kind) && /^[a-f0-9-]{36}$/.test(t.id))
      .map(t => [t.id, t])).values()];
    const result = new Array(rows.length); let next = 0;
    await Promise.all(Array.from({ length: Math.min(3, rows.length) }, async () => {
      for (;;) {
        const index = next++; if (index >= rows.length) break;
        const row = rows[index], base = { id: row.id, kind: row.kind, title: String(row.title ?? "未命名任务").slice(0, 240), updatedAt: row.updatedAt };
        if (active(row.status)) { this.cache.delete(row.id); result[index] = { ...base, running: true, unread: false, unknown: false }; continue; }
        const key = JSON.stringify([row.kind, row.status, row.updatedAt]);
        let saved = this.cache.get(row.id);
        try {
          if (!saved || saved.key !== key || this.now() - saved.at > 60000) {
            if (this.now() >= deadline) throw Error("Summary read budget reached");
            const data = await desktop.call(TOOLS.readThread, { threadId: row.id, ...(row.hostId ? { hostId: row.hostId } : {}), turnLimit: 1, includeOutputs: false, maxOutputCharsPerItem: 0 }, undefined, { timeoutMs: Math.min(4000, deadline - this.now()) });
            current(); if (data.thread?.id !== row.id || data.thread?.kind !== row.kind) throw Error("Task identity changed");
            saved = { key, at: this.now(), receipt: this.observe(data), running: active(data.thread.status), unknown: !["active", "running", "inProgress", "idle", "completed", "waiting-approval", "waiting-user-input"].includes(statusType(data.thread.status)) };
            this.cache.set(row.id, saved);
          }
          const token = saved.receipt?.token;
          result[index] = { ...base, running: saved.running, unread: !saved.running && !!token && !this.receipts().read[row.id]?.includes(token), reportToken: token ?? null, unknown: saved.unknown };
        } catch { current(); result[index] = { ...base, running: false, unread: false, unknown: true }; }
      }
    }));
    current();
    if (this.readStateDesktop !== desktop) {
      this.readStateDesktop = desktop;
      this.readState = new OfficialReadState(desktop);
    }
    const official = await this.readState.snapshot(); current();
    const localIds = new Set(rows.filter(row => row.hostId === OFFICIAL.discovery.hostId).map(row => row.id));
    for (const row of result) {
      if (localIds.has(row.id) && row.kind === "codex" && row.reportToken && row.unread && !row.running && official.excludes(row.id)) {
        row.unread = false;
        row.officialRead = true;
      }
    }
    const ids = new Set(rows.map(t => t.id)); for (const id of this.cache.keys()) if (!ids.has(id)) this.cache.delete(id);
    return { schemaVersion: 1, observedAt: this.now(), source: "official-list-and-latest-report + remote-codex-read-receipts + official-unread-snapshot",
      officialReadState: { status: official.status, modes: ["codex"], conservative: true },
      complete: (list.threads?.length ?? 0) < 50 && !(list.unavailableHosts?.length || list.unavailableSources?.length) && !result.some(t => t.unknown),
      listLimited: (list.threads?.length ?? 0) >= 50, threads: result };
  }
}
