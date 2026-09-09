// Leases own viewing subscriptions only. Releasing one never interrupts a task.
export class SubscriptionLeases {
  constructor(release, { ttlMs = 90000, maxTemporary = 16, maxViewers = 64, now = Date.now } = {}) {
    Object.assign(this, { release, ttlMs, maxTemporary, maxViewers, now });
    this.leases = new Map();
  }
  key(threadId, viewerId) { return viewerId ? 'viewer:' + viewerId : 'temporary:' + threadId; }
  has(threadId) { return [...this.leases.values()].some(x => x.threadId === threadId); }
  drop(key) {
    const previous = this.leases.get(key);
    this.leases.delete(key);
    if (previous && !this.has(previous.threadId)) this.release(previous.threadId);
  }
  touch(threadId, viewerId) {
    if (viewerId !== undefined && (typeof viewerId !== 'string' || !/^[\w-]{8,160}$/.test(viewerId))) throw Error('Invalid viewer ID');
    const key = this.key(threadId, viewerId);
    if (this.leases.get(key)?.threadId !== threadId) this.drop(key);
    this.leases.delete(key);
    this.leases.set(key, { threadId, temporary: !viewerId, expires: this.now() + this.ttlMs });
    this.prune();
  }
  remove(threadId, viewerId) {
    const key = this.key(threadId, viewerId);
    if (this.leases.get(key)?.threadId === threadId) this.drop(key);
  }
  prune() {
    for (const [key, value] of this.leases) if (value.expires <= this.now()) this.drop(key);
    for (const temporary of [true, false]) {
      const keys = [...this.leases].filter(([, value]) => value.temporary === temporary).map(([key]) => key);
      while (keys.length > (temporary ? this.maxTemporary : this.maxViewers)) this.drop(keys.shift());
    }
  }
  clear() { for (const key of [...this.leases.keys()]) this.drop(key); }
}
