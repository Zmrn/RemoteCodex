import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeLiveTurnItems, runtimeStatus } from '../src/state.mjs';
import { ConversationPages, compactConversation } from '../src/conversation-pages.mjs';
import { mergeTurns } from '../public/conversation-history.mjs';
import { messageTime } from '../public/message-content.mjs';
import { reportReceipt } from '../src/task-reports.mjs';

const start = Date.parse('2026-09-17T11:47:22Z');
const item = (id, extra = {}) => ({ id, type: 'agentMessage', text: 'Reply ' + id, ...extra });
const history = items => ({ thread: { id: 'thread' }, turns: [{ id: 'turn', startedAt: start / 1000, items }] });
const owner = turn => ({ id: 'thread', turns: [turn], threadRuntimeStatus: { type: 'idle' } });

for (const canonical of [false, true]) test((canonical ? 'canonical' : 'legacy') + ' owner projects distinct official message start times without changing messages or state', () => {
  const items = [item('a'), item('b'), item('async', { delivery: 'async', questions: [{ title: 'Choice' }] }),
    item('missing'), { id: 'user', type: 'userMessage', content: [{ type: 'text', text: 'Hello' }] }];
  const turn = { turnId: 'turn', status: 'completed', turnStartedAtMs: start, items,
    aeonAssistantMessageStartedAtMsById: { a: start + 10000, b: start + 60000, async: start + 70000, user: start } };
  const state = owner(turn);
  if (canonical) {
    state.turnHistory = { history: { entitiesByKey: { turn } } };
    state.turns = [{ ...turn, items: [], aeonAssistantMessageStartedAtMsById: { a: start } }];
  }
  const before = structuredClone(state), data = history([item('stale')]);
  const merged = mergeLiveTurnItems(data, state), compact = compactConversation(merged);
  assert.deepEqual(state, before);
  assert.deepEqual(merged.turns[0].items.map(i => i.id), items.map(i => i.id));
  assert.deepEqual(compact.turns[0].items.map(i => messageTime(i).iso), [
    new Date(start + 10000).toISOString(), new Date(start + 60000).toISOString(),
    new Date(start + 70000).toISOString(), null, null]);
  assert.equal(compact.turns[0].aeonAssistantMessageStartedAtMsById, undefined);
  assert.deepEqual(reportReceipt(merged), reportReceipt({ ...merged, turns: [{ ...merged.turns[0], items }] }));
  assert.deepEqual(runtimeStatus(state), { type: 'idle', confirmed: true });
  assert.equal(mergeLiveTurnItems(data, { ...state, id: 'other-thread' }), data);
});

test('message timing rejects invalid maps, wrong IDs/types and stale projected times', () => {
  const turn = { turnId: 'turn', items: [item('a', { bridgeMessageStartedAtMs: start })] };
  for (const times of [undefined, null, [], 'invalid', { b: start }, Object.create({ a: start }),
    ...[null, undefined, '1789645652033', 0, -1, NaN, Infinity, 1.5, 8.64e15 + 1].map(a => ({ a }))]) {
    const merged = mergeLiveTurnItems(history([]), owner({ ...turn, aeonAssistantMessageStartedAtMsById: times }));
    assert.equal(messageTime(merged.turns[0].items[0]).iso, null);
    assert.equal(Object.hasOwn(merged.turns[0].items[0], 'bridgeMessageStartedAtMs'), false);
  }
  const missingArray = owner({ turnId: 'turn', aeonAssistantMessageStartedAtMsById: { a: start + 1000 } });
  assert.equal(mergeLiveTurnItems(history([item('a')]), missingArray).turns[0].items[0].bridgeMessageStartedAtMs, start + 1000);
  assert.deepEqual(mergeLiveTurnItems(history([item('a')]), owner({ ...turn, items: [] })).turns[0].items, []);
  assert.equal(mergeLiveTurnItems(history([item('a')]), owner({ ...turn, turnId: 'another-turn' })).turns[0].items[0].bridgeMessageStartedAtMs, undefined);
});

test('owner-only new turns carry time but old cursor reads never reinsert them', () => {
  const state = owner({ turnId: 'new', turnStartedAtMs: start + 1000, items: [item('new')],
    aeonAssistantMessageStartedAtMsById: { new: start + 3000 } });
  assert.equal(mergeLiveTurnItems(history([]), state).turns[0].items[0].bridgeMessageStartedAtMs, start + 3000);
  assert.equal(mergeLiveTurnItems(history([]), state, { includeNewTurns: false }).turns.length, 1);
});

test('official times survive compact pages and refresh; older pages cannot overwrite corrected times', async () => {
  const items = Array.from({ length: 6 }, (_, n) => item('message-' + n));
  const turn = { turnId: 'turn', turnStartedAtMs: start, items,
    aeonAssistantMessageStartedAtMsById: Object.fromEntries(items.map((i, n) => [i.id, start + (n + 1) * 1000])) };
  const pages = new ConversationPages({ maxItems: 2 });
  const read = async () => ({ data: compactConversation(mergeLiveTurnItems(history([]), owner(turn))) });
  let page = await pages.read('thread', null, read), merged = page.data.turns, oldHead = page.data.turns;
  while (page.data.page.nextCursor) {
    page = await pages.read('thread', page.data.page.nextCursor, read);
    merged = mergeTurns(merged, page.data.turns, true);
  }
  assert.equal(merged[0].items.length, items.length);
  assert.deepEqual(merged[0].items.map(i => i.bridgeMessageStartedAtMs), items.map((_, n) => start + (n + 1) * 1000));
  turn.aeonAssistantMessageStartedAtMsById['message-5'] = start + 9000;
  delete turn.aeonAssistantMessageStartedAtMsById['message-4'];
  const fresh = await pages.read('thread', null, read);
  merged = mergeTurns(merged, fresh.data.turns);
  merged = mergeTurns(merged, oldHead, true);
  assert.equal(merged[0].items.at(-1).bridgeMessageStartedAtMs, start + 9000);
  assert.equal(messageTime(merged[0].items.at(-2)).iso, null);
});

test('display favors per-message starts, labels completed records separately, and never invents a time', () => {
  const received = item('a', { bridgeMessageStartedAtMs: start + 10000, bridgeRecordedAt: '2026-09-17T12:00:00Z' });
  assert.match(messageTime(received).text, /^开始接收 /);
  assert.equal(messageTime(received).iso, '2026-09-17T11:47:32.000Z');
  const fallback = messageTime({ ...received, bridgeMessageStartedAtMs: 'invalid' });
  assert.match(fallback.text, /^记录于 /); assert.equal(fallback.iso, '2026-09-17T12:00:00.000Z');
  for (const bridgeMessageStartedAtMs of [null, '1789645652033', 0, -1, Infinity, NaN, 1.5, 8.64e15 + 1])
    assert.equal(messageTime(item('a', { bridgeMessageStartedAtMs }), { startedAt: start / 1000 }).iso, null);
  assert.equal(messageTime({ type: 'userMessage', bridgeMessageStartedAtMs: start }).iso, null);
  assert.equal(messageTime(item('a', { createdAt: start, receivedAt: Date.now(), updatedAt: start }), { startedAt: start / 1000 }).iso, null);
});
