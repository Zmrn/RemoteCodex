// Short-lived render observations from the same official-only summary as widgets.
// Completion/history/selection are never unread evidence; nothing is persisted.
export class SidebarReports {
  constructor({ read, changed = () => {}, now = Date.now, ttl = 60000 }) {
    Object.assign(this, { read, changed, now, ttl }); this.sequence = 0;
  }
  reset() {
    this.sequence++; this.controller?.abort(); this.pending = null;
    this.agent = null; this.rows = null; this.expiresAt = 0;
  }
  expire() { if (this.rows && this.now() >= this.expiresAt) { this.rows = null; this.changed(); } }
  get(id) { return this.now() < this.expiresAt ? this.rows?.get(id) : null; }
  refresh(agent) {
    if (this.agent !== agent) { this.reset(); this.agent = agent; }
    if (this.pending) return this.pending;
    const sequence = this.sequence, started = this.now(), controller = new AbortController();
    this.controller = controller;
    this.pending = Promise.resolve().then(() => this.read(agent, controller.signal)).then(summary => {
      if (sequence !== this.sequence) return;
      if (summary?.schemaVersion !== 2 || summary.statePolicy !== 'official-only' || !Array.isArray(summary.threads)) throw Error('Official unread state unavailable');
      this.rows = new Map(summary.threads.map(row => [row.id, row]));
      this.expiresAt = started + this.ttl;
    }).catch(() => { if (sequence === this.sequence) this.rows = null; })
      .finally(() => { if (sequence === this.sequence) { this.pending = null; this.changed(); } });
    return this.pending;
  }
}

export function sidebarIndicator(runtime, flags, mode, connected) {
  if (!connected) return { type: 'connection-interrupted', source: '连接中断，未读状态未知' };
  if (runtime?.confirmed !== false && (runtime?.type === 'running' || runtime?.type?.startsWith('waiting-') || ['error', 'failed'].includes(runtime?.type))) return runtime;
  if (mode === 'codex' && flags?.stateSource === 'official-owner-snapshot' && flags.runtimeKnown === true && flags.readStateKnown === true && flags.unknown === false && flags.running === false && typeof flags.unread === 'boolean')
    return { type: flags.unread ? 'unread' : 'idle', source: flags.unread ? '官方未读状态' : '官方已读状态' };
  return { type: 'unknown', source: mode === 'chat' ? '官方 Chat 未读状态尚未接入' : '官方未读状态未确认' };
}
