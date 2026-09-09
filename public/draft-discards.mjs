// These tombstones delete only Remote's withdrawn draft backup. They never
// delete an official queued message, send input, or interrupt a running turn.
const identity = (c, recoveryId) => JSON.stringify([c.agent, c.id, recoveryId]);
export class DraftDiscards {
  constructor({ api, persist, onChange = () => {}, onError = () => {}, now = Date.now }) {
    Object.assign(this, { api, persist, onChange, onError, now });
    this.entries = new Map(); this.jobs = new Map(); this.retries = new Map();
  }
  restore(rows = []) {
    for (const r of Array.isArray(rows) ? rows : []) {
      if (!r || ![r.agent, r.id, r.recoveryId].every(v => typeof v === "string" && v.length > 0 && v.length <= 160)) continue;
      this.entries.set(identity(r, r.recoveryId), { agent: r.agent, id: r.id, recoveryId: r.recoveryId, cleared: r.cleared === true });
    }
  }
  snapshot() { return [...this.entries.values()].map(r => ({ ...r })); }
  has(c, recoveryId) { return this.entries.has(identity(c, recoveryId)); }
  add(c, recoveryId) {
    const key = identity(c, recoveryId);
    if (!this.entries.has(key)) this.entries.set(key, { agent: c.agent, id: c.id, recoveryId, cleared: false });
    this.onChange();
  }
  flush(c) {
    if (!c.connected) return Promise.resolve();
    return Promise.all([...this.entries].filter(([, r]) => !r.cleared && r.agent === c.agent && r.id === c.id)
      .map(([key, r]) => this.send(key, r)));
  }
  send(key, r) {
    if (this.jobs.has(key)) return this.jobs.get(key);
    if (this.now() < (this.retries.get(key)?.at ?? 0)) return Promise.resolve();
    const job = (async () => {
      try {
        // Commit intent before dispatch so closing/reloading during a lost
        // response cannot turn the discarded backup into a recoverable draft.
        await this.persist();
        const result = await this.api(r.agent, `/threads/${r.id}/queue`, { action: "ack-recovery", recoveryId: r.recoveryId });
        if (result.status !== "accepted" || result.result?.disposition !== "recovery-cleared") throw Error("草稿清理尚未确认");
        r.cleared = true;
        // Keep confirmed markers too: a previously started GET can arrive late.
        await this.persist();
        this.retries.delete(key);
      } catch (e) {
        r.cleared = false;
        const previous = this.retries.get(key), attempts = (previous?.attempts ?? 0) + 1;
        this.retries.set(key, { attempts, at: this.now() + Math.min(30000, 1000 * 2 ** Math.min(attempts, 5)) });
        if (!previous) this.onError(e);
      } finally { this.jobs.delete(key); this.onChange(); }
    })();
    this.jobs.set(key, job);
    return job;
  }
}
