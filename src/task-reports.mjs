import { createHash } from "node:crypto";
import { OFFICIAL } from "./official-protocol.mjs";
import { OfficialTaskState } from "./official-task-state.mjs";

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

// Tokens validate a user-visible read attempt only. No independent read state,
// history cache or persisted receipt participates in task statistics.
export class TaskReports {
  constructor(bridge, { now = Date.now, stateFactory = desktop => new OfficialTaskState(desktop) } = {}) {
    this.bridge = bridge; this.now = now; this.stateFactory = stateFactory; this.issued = new Map(); this.officialPending = new Map(); this.nextTask = null;
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
    if (issued.kind !== 'codex' || !this.bridge.markOfficialReportRead)
      return { accepted: false, officialReadSync: { status: 'unsupported' } };
    const key = id + ':' + token;
    if (!this.officialPending.has(key)) {
      const pending = Promise.resolve().then(() => this.bridge.markOfficialReportRead(id, token)).catch(() => ({ status: 'unavailable' }))
        .finally(() => this.officialPending.delete(key));
      this.officialPending.set(key, pending);
    }
    const officialReadSync = await this.officialPending.get(key);
    const accepted = ['synced', 'already-read'].includes(officialReadSync.status);
    if (accepted) this.bridge.emitEvent?.('report-read', { threadId: id });
    return { accepted, officialReadSync };
  }
  async summary() {
    this.bridge.requireConnection();
    if (this.pending) return this.pending;
    this.pending = this.collect().finally(() => { this.pending = null; });
    return this.pending;
  }
  async collect() {
    const bridge = this.bridge, desktop = bridge.desktop;
    const current = () => { bridge.requireConnection(); if (desktop !== bridge.desktop) throw Error("Viewer connection changed during summary"); };
    const list = (await bridge.threads(50, { timeoutMs: 6000 })).data; current();
    const rows = [...new Map([...(list.pinnedThreads ?? []), ...(list.threads ?? [])]
      .filter(t => ["codex", "chatgpt"].includes(t.kind) && /^[a-f0-9-]{36}$/.test(t.id))
      .map(t => [t.id, t])).values()];
    // Only scheduling position survives refreshes, never a task's old flags.
    const start = Math.max(0, rows.findIndex(row => row.id === this.nextTask));
    const order = rows.map((_, index) => (start + index) % rows.length);
    const deadline = this.now() + 10000, result = new Array(rows.length), reader = this.stateFactory(desktop);
    let next = 0, available = false;
    try {
      if (reader.supported()) { try { await reader.connect(); current(); available = true; } catch { current(); } }
      await Promise.all(Array.from({ length: Math.min(3, rows.length) }, async () => {
        for (;;) {
          const position = next++; if (position >= rows.length) break;
          const index = order[position];
          const row = rows[index], base = { id: row.id, kind: row.kind, title: String(row.title ?? "未命名任务").slice(0, 240), updatedAt: row.updatedAt };
          // A current official list can confirm running work, but never unread.
          if (active(row.status)) { result[index] = { ...base, running: true, unread: false, runtimeKnown: true, readStateKnown: false, unknown: false, stateSource: 'official-list' }; continue; }
          result[index] = { ...base, running: false, unread: false, runtimeKnown: false, readStateKnown: false, unknown: true, stateSource: 'unavailable', reason: this.now() >= deadline ? 'scan-budget' : 'official-state-unavailable' };
          if (!available || row.kind !== 'codex' || row.hostId !== OFFICIAL.discovery.hostId || this.now() >= deadline) continue;
          try {
            this.nextTask = rows[order[(position + 1) % rows.length]].id;
            const flags = await reader.read(row.id, Math.min(2500, deadline - this.now())); current();
            result[index] = { ...base, ...flags };
          } catch { current(); }
        }
      }));
      current();
    } finally { reader.close(); }
    return { schemaVersion: 2, statePolicy: 'official-only', observedAt: this.now(), source: 'fresh official list and owner snapshots',
      officialReadState: { status: available ? 'available' : reader.supported() ? 'unavailable' : 'unsupported', modes: ['codex'], source: 'official-owner-snapshot' },
      complete: (list.threads?.length ?? 0) < 50 && !(list.unavailableHosts?.length || list.unavailableSources?.length) && !result.some(t => t.unknown),
      listLimited: (list.threads?.length ?? 0) >= 50, threads: result };
  }
}
