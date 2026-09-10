import { createHash } from 'node:crypto';
import { OfficialTaskState } from './official-task-state.mjs';
import { OFFICIAL, EVENTS } from './official-protocol.mjs';
import { liveTurns, runtimeStatus } from './state.mjs';
import { asyncQuestions, questionReply, itemText } from '../public/message-content.mjs';

const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const notificationText = value => String(value ?? '').replace(/[\x00-\x1f\x7f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 180);
// History identifies a result, never the current runtime or unread state.
export function notificationProjection(state, id) {
  if (state?.id !== id) throw Error('Official task identity changed');
  const runtime = runtimeStatus(state), turns = liveTurns(state), turn = turns.at(-1);
  if (!runtime.confirmed || !turn?.turnId) return { id, known: false };
  const events = [], items = turn.items ?? [];
  const add = (kind, identity, summary, quickReply = false) => events.push({
    key: digest([id, turn.turnId, kind, identity]), kind, summary: notificationText(summary), quickReply,
  });
  if (runtime.type === 'waiting-approval' || runtime.type === 'waiting-user-input') {
    const requests = state.requests ?? [];
    const request = requests.find(r => r.method === EVENTS.userInput);
    add(runtime.type === 'waiting-approval' ? 'approval' : 'question', requests.map(r => r.id).sort(),
      runtime.type === 'waiting-approval' ? '任务需要你审批，请打开任务处理。' : request?.params?.questions?.[0]?.question ?? '任务正在等待你的回答。');
  }
  // Async questions can arrive while the agent keeps working. Match only actual
  // official answers, not local accepted/done flags.
  const answered = new Set(turns.flatMap(t => t.items ?? []).flatMap(i =>
    i.type === 'userMessage' || (i.type === 'steeringUserMessage' && i.status === 'accepted')
      ? (questionReply(itemText(i)) ?? []).map(a => a.questionItemId) : []));
  if (runtime.type !== 'idle') for (const item of items) {
    const pending = asyncQuestions(item).filter(q => !answered.has(q.id));
    if (pending.length) add('question', pending.map(q => q.id), pending[0].title);
  }
  if (runtime.type === 'idle' && ['completed', 'failed'].includes(turn.status)) {
    const reply = items.filter(i => i.type === 'agentMessage' && i.delivery !== 'async' && typeof i.text === 'string').at(-1);
    add(turn.status === 'failed' ? 'failed' : 'completed', turn.turnId,
      turn.status === 'failed' ? turn.error?.message ?? '任务遇到问题，请打开任务查看。' : reply?.text ?? '任务已完成。', true);
  }
  return { id, known: true, runtime: runtime.type, turnId: turn.turnId, startedAt: turn.turnStartedAtMs, events };
}

export class NotificationSource {
  constructor(bridge, { stateFactory = d => new OfficialTaskState(d), now = Date.now } = {}) {
    Object.assign(this, { bridge, stateFactory, now }); this.nextTask = null;
  }
  async collect(id) {
    this.bridge.requireConnection();
    if (!id && this.pending) return this.pending;
    const run = this.scan(id);
    if (id) return run;
    this.pending = run.finally(() => { this.pending = null; }); return this.pending;
  }
  async scan(id) {
    const desktop = this.bridge.desktop, reader = this.stateFactory(desktop);
    const current = () => { this.bridge.requireConnection(); if (desktop !== this.bridge.desktop) throw Error('Official connection changed'); };
    if (!reader.supported()) return { schemaVersion: 1, supported: false, threads: [] };
    const list = (await this.bridge.threads(50, { timeoutMs: 6000 })).data; current();
    let rows = [...new Map([...(list.pinnedThreads ?? []), ...(list.threads ?? [])].filter(r =>
      r.kind === 'codex' && r.hostId === OFFICIAL.discovery.hostId && /^[a-f0-9-]{36}$/i.test(r.id)).map(r => [r.id, r])).values()];
    if (id) rows = rows.filter(r => r.id === id);
    else { const start = Math.max(0, rows.findIndex(r => r.id === this.nextTask)); rows = [...rows.slice(start), ...rows.slice(0, start)]; }
    const deadline = this.now() + 10000, threads = []; let next = 0;
    try {
      await reader.connect(); current();
      await Promise.all(Array.from({ length: Math.min(3, rows.length) }, async () => {
        for (;;) {
          const index = next++, row = rows[index]; if (!row) return;
          let projected = { id: row.id, known: false };
          if (this.now() < deadline) {
            if (!id) this.nextTask = rows[(index + 1) % rows.length].id;
            try { projected = await reader.read(row.id, Math.min(2500, deadline - this.now()), notificationProjection); } catch { current(); }
          }
          current(); threads.push({ ...projected, title: notificationText(row.title || '未命名任务'), mode: 'codex' });
        }
      }));
    } finally { reader.close(); }
    current();
    return { schemaVersion: 1, supported: true, observedAt: this.now(), threads,
      partial: (list.threads?.length ?? 0) >= 50 || !!(list.unavailableHosts?.length || list.unavailableSources?.length) || threads.some(t => !t.known),
      modes: ['codex'], source: 'fresh-official-owner-snapshot' };
  }
  async reply(id, body) {
    if (!/^[a-f0-9]{64}$/.test(body.eventKey ?? '')) throw Error('Invalid notification event');
    const result = await this.collect(id), row = result.threads.find(t => t.id === id);
    if (!row?.known || row.runtime !== 'idle' || !row.events.some(e => e.key === body.eventKey && e.quickReply))
      return { status: 'not-sent', error: '任务已变化或状态尚未确认，请打开任务继续编辑。' };
    const desktop = this.bridge.desktop;
    try { return await this.bridge.nativeSend(id, body.requestId, body.prompt, undefined, {}, async () => {
      const fresh = await this.collect(id), current = fresh.threads.find(t => t.id === id);
      if (desktop !== this.bridge.desktop || !current?.known || current.runtime !== 'idle' || !current.events.some(e => e.key === body.eventKey && e.quickReply))
        throw Error('Notification task changed before dispatch');
    }); } catch (error) {
      if (this.bridge.db?.requests?.[body.requestId]?.status === 'rejected')
        return { status: 'not-sent', error: '任务状态已变化，回复未发送，请打开任务继续编辑。' };
      throw error;
    }
  }
}
