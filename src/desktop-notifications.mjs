import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { DurableJson } from './durable-json.mjs';
import { INSTANCE } from './runtime.mjs';
import { notificationRequest, deviceFingerprint } from './notification-client.mjs';

const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const validId = value => /^[a-f0-9-]{36}$/i.test(value ?? '');
export class DesktopNotifications {
  constructor(agents, dir, { request = notificationRequest, now = Date.now, instanceId = INSTANCE.instanceId } = {}) {
    Object.assign(this, { agents, request, now, instanceId });
    this.store = new DurableJson(path.join(dir, 'desktop-notifications.json'), { label: '桌面通知与回复草稿', recoveryReadOnly: true,
      empty: { enabled: true, seen: {}, drafts: {} },
      validate: v => v && typeof v.enabled === 'boolean' && v.seen && typeof v.seen === 'object' && !Array.isArray(v.seen) && v.drafts && typeof v.drafts === 'object' && !Array.isArray(v.drafts) });
    this.db = this.store.value; this.events = new Map(); this.issued = new Map(); this.devices = new Map(); this.flights = new Map(); this.startedAt = now(); this.closed = false;
  }
  save() { this.store.write(this.db); }
  start() {
    if (this.timer || this.closed) return;
    this.timer = setInterval(() => this.tick(), 1000); this.timer.unref(); this.tick();
  }
  close() { this.closed = true; clearInterval(this.timer); }
  tick() {
    if (this.closed || !this.db.enabled || !this.store.health.writable) return;
    let agents; try { agents = this.agents.list().agents.filter(a => a.kind === 'remote' && a.id !== 'local'); } catch { return; }
    const ids = new Set(agents.map(a => a.id));
    for (const id of this.devices.keys()) if (!ids.has(id)) this.devices.delete(id);
    for (const [id, e] of this.events) if (!ids.has(e.agent)) this.events.delete(id);
    for (const a of agents) {
      let agent; try { agent = { ...this.agents.get(a.id) }; } catch { continue; }
      const fingerprint = deviceFingerprint(agent);
      let state = this.devices.get(a.id);
      if (state?.fingerprint !== fingerprint) {
        state = { fingerprint, due: 0, failures: 0, status: 'connecting' }; this.devices.set(a.id, state);
        for (const [id, e] of this.events) if (e.agent === a.id) this.events.delete(id);
      }
      if (!state.busy && this.now() >= state.due) {
        state.busy = true;
        this.scan(agent, state).finally(() => { state.busy = false; });
      }
    }
  }
  async scan(agent, state) {
    const current = () => !this.closed && this.db.enabled && this.devices.get(agent.id) === state && deviceFingerprint(this.agents.get(agent.id)) === state.fingerprint;
    try {
      const identity = await this.request(this.agents, agent, '/instance');
      if (identity.application !== 'remote-codex' || !validId(identity.instanceId)) throw Error('Unknown device');
      if (identity.instanceId === this.instanceId) throw Object.assign(Error('Local device'), { code: 'SELF' });
      const status = await this.request(this.agents, agent, '/status');
      if (!current()) return;
      if (!status.connected) await this.request(this.agents, agent, '/connect', {});
      if (!current()) return;
      const result = await this.request(this.agents, agent, '/notification-state');
      if (!current()) return;
      if (result.schemaVersion !== 1 || result.supported !== true || !Array.isArray(result.threads)) throw Object.assign(Error('Update required'), { code: 'UNSUPPORTED' });
      this.observe(agent, state.fingerprint, result);
      state.status = result.partial ? 'partial' : 'connected'; state.failures = 0; state.due = this.now() + 5000;
    } catch (e) {
      state.status = e.code === 'SELF' ? 'local-excluded' : e.code === 'UNSUPPORTED' ? 'update-required' : 'unavailable';
      state.failures++; state.due = this.now() + (e.code === 'SELF' || e.code === 'UNSUPPORTED' ? 60000 : Math.min(30000, 1000 * 2 ** Math.min(5, state.failures - 1)));
    }
  }
  observe(agent, fingerprint, result) {
    const candidates = []; let changed = false;
    for (const row of result.threads) {
      if (!row.known || !validId(row.id) || row.mode !== 'codex' || !Array.isArray(row.events)) continue;
      const task = hash([fingerprint, row.id]), previous = this.db.seen[task];
      const eventKeys = row.events.filter(e => /^[a-f0-9]{64}$/.test(e.key) && ['completed', 'failed', 'question', 'approval'].includes(e.kind));
      const keys = eventKeys.map(e => e.key);
      // Seen IDs are deduplication only: never an unread/answered cache.
      const history = [...new Set([...(previous ?? []), ...keys])].slice(-128);
      if (!previous || JSON.stringify(previous) !== JSON.stringify(history)) { this.db.seen[task] = history; changed = true; }
      for (const [id, event] of this.events) if (event.task === task && !keys.includes(event.eventKey)) this.events.delete(id);
      for (const event of eventKeys) {
        if (previous?.includes(event.key) || (!previous && !(Number.isFinite(row.startedAt) && row.startedAt > this.startedAt))) continue;
        candidates.push({ id: hash([fingerprint, row.id, event.key]), task, fingerprint, agent: agent.id,
          device: String(agent.name).slice(0, 60), thread: row.id, mode: 'codex', title: String(row.title).slice(0, 180),
          eventKey: event.key, kind: event.kind, summary: String(event.summary ?? '').slice(0, 180), quickReply: event.quickReply === true, createdAt: this.now() });
      }
    }
    if (changed) {
      const keys = Object.keys(this.db.seen); for (const key of keys.slice(0, Math.max(0, keys.length - 10000))) delete this.db.seen[key];
      this.save(); // Commit dedup before publishing; failed storage never replays.
    }
    for (const event of candidates) if (!this.isViewing(event)) { this.events.set(event.id, event); this.issued.set(event.id, event); }
    while (this.events.size > 100) this.events.delete(this.events.keys().next().value);
    while (this.issued.size > 512) this.issued.delete(this.issued.keys().next().value);
  }
  isViewing(event) { return this.viewing && this.now() - this.viewing.at < 6000 && this.viewing.agent === event.agent && this.viewing.thread === event.thread && this.viewing.mode === event.mode; }
  poll(body = {}) {
    this.viewing = body.viewing && validId(body.viewing.agent) && validId(body.viewing.thread) ? { ...body.viewing, at: this.now() } : null;
    this.start();
    for (const [id, e] of this.events) if (this.isViewing(e) || this.now() - e.createdAt > 10 * 60 * 1000) this.events.delete(id);
    return { enabled: this.db.enabled, health: this.store.health, drafts: Object.keys(this.db.drafts).length,
      events: [...this.events.values()].map(e => ({ ...e, draft: this.db.drafts[e.id]?.text ?? '', outcome: this.db.drafts[e.id]?.outcome ?? 'draft' })),
      devices: [...this.devices].map(([id, s]) => ({ id, status: s.status })) };
  }
  settings(enabled) {
    if (typeof enabled !== 'boolean') throw Error('Invalid notification setting');
    this.db.enabled = enabled; this.save(); this.events.clear(); this.devices.clear();
    // Enabling establishes new baselines, so a paused interval does not flood the desktop.
    this.db.seen = {}; this.startedAt = this.now(); this.save(); return { enabled };
  }
  event(id) {
    if (!/^[a-f0-9]{64}$/.test(id ?? '')) throw Error('Invalid notification');
    const event = this.events.get(id) ?? this.db.drafts[id]?.event ?? this.issued.get(id);
    if (!event) throw Error('通知已结束'); return event;
  }
  draft(id, text) {
    if (typeof text !== 'string' || text.length > 20000) throw Error('回复最多 20000 字符');
    const event = this.event(id), old = this.db.drafts[id];
    if (this.flights.has(id)) {
      if (text !== old?.text) throw Error('正在提交；请先核对结果，原回复已保留。');
      return old;
    }
    if (old && old.outcome !== 'draft') {
      if (text !== old.text) throw Error('提交结果尚需核对；请打开任务确认，原回复已保留。');
      return old;
    }
    if (text) this.db.drafts[id] = { event, text, requestId: old?.text === text ? old.requestId : 'notification-' + randomUUID(), outcome: 'draft' };
    else delete this.db.drafts[id];
    this.save(); return this.db.drafts[id];
  }
  dismiss(id) { this.events.delete(id); return { saved: true }; }
  restore() {
    for (const [id, draft] of Object.entries(this.db.drafts)) this.events.set(id, { ...draft.event, createdAt: this.now() });
    return { restored: true };
  }
  discard(id) {
    this.event(id); if (this.flights.has(id)) throw Error('正在提交，请稍候');
    delete this.db.drafts[id]; this.save(); this.events.delete(id); return { saved: true };
  }
  async reply(id, text) {
    if (this.flights.has(id)) return this.flights.get(id);
    const event = this.event(id);
    if (!event.quickReply || !text?.trim()) throw Error('请打开任务处理');
    this.draft(id, text);
    const record = this.db.drafts[id];
    if (record.outcome !== 'draft') return { status: record.outcome, error: '提交结果尚需核对，不会重复发送。' };
    const run = (async () => {
      let agent;
      try {
        agent = { ...this.agents.get(event.agent) };
        if (agent.kind !== 'remote' || deviceFingerprint(agent) !== event.fingerprint) throw Error('Device changed');
        const identity = await this.request(this.agents, agent, '/instance');
        if (identity.application !== 'remote-codex' || identity.instanceId === this.instanceId || !validId(identity.instanceId)) throw Error('Invalid target');
      } catch { return { status: 'not-sent', error: '连接不可用或设备已变化，回复草稿已保留。' }; }
      record.outcome = 'outcome-unknown'; this.save();
      let result;
      try { result = await this.request(this.agents, agent, '/threads/' + event.thread + '/notification-reply', { prompt: text, requestId: record.requestId, eventKey: event.eventKey }); }
      catch { return { status: 'outcome-unknown', error: '提交结果未知，回复已保留。请打开任务核对，勿重复发送。' }; }
      if (result.status === 'accepted') { delete this.db.drafts[id]; this.save(); this.events.delete(id); }
      else if (result.status === 'not-sent') { record.outcome = 'draft'; this.save(); }
      return result;
    })();
    this.flights.set(id, run);
    try { return await run; } finally { this.flights.delete(id); }
  }
}
