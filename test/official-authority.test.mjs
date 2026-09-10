import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { EventEmitter } from 'node:events';
import { Bridge } from '../src/bridge.mjs';
import { OfficialQueue } from '../src/queue.mjs';
import { withServiceTiers } from '../src/service-tiers.mjs';
import { OFFICIAL } from '../src/official-protocol.mjs';
import { mergeLiveTurnItems } from '../src/state.mjs';
import { ConversationPages } from '../src/conversation-pages.mjs';
import { mergeTurns } from '../public/conversation-history.mjs';

test('current owner item removals replace old tool history; missing array still preserves readable history', () => {
  const data = { thread: { id: 'task' }, turns: [{ id: 'turn', items: [{ id: 'stale', text: 'old answer' }] }] };
  const turn = { turnId: 'turn', items: [] };
  const state = { id: 'task', turnHistory: { history: { entitiesByKey: { turn } } } };
  assert.deepEqual(mergeLiveTurnItems(data, state).turns[0].items, []);
  delete turn.items;
  assert.deepEqual(mergeLiveTurnItems(data, state).turns[0].items, data.turns[0].items);
});

test('head snapshot removes deleted items, updates order and rejects resurrection by old cursors', async () => {
  const pages = new ConversationPages({ maxItems: 2 });
  let ids = ['a', 'b', 'c', 'd'];
  const read = async () => ({ data: { thread: { id: 'task' }, turns: [{ id: 'turn',
    items: ids.map(id => ({ id, text: id })) }] } });
  const old = await pages.read('task', null, read);
  let rows = mergeTurns(old.data.turns, (await pages.read('task', old.data.page.nextCursor, read)).data.turns, true);
  assert.deepEqual(rows[0].items.map(i => i.id), ids);
  ids = ['d', 'a'];
  rows = mergeTurns(rows, (await pages.read('task', null, read)).data.turns);
  rows = mergeTurns(rows, old.data.turns, true);
  assert.deepEqual(rows[0].items.map(i => i.id), ids);
  ids = [];
  rows = mergeTurns(rows, (await pages.read('task', null, read)).data.turns);
  assert.deepEqual(rows[0].items, []);
});

test('queue and service tiers never use the bridge process CODEX_HOME; verified desktop directory owns the data', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'official-authority-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const wrong = path.join(root, 'wrong'), official = path.join(root, 'official');
  for (const dir of [wrong, official]) fs.mkdirSync(dir);
  const old = process.env.CODEX_HOME;
  t.after(() => old === undefined ? delete process.env.CODEX_HOME : process.env.CODEX_HOME = old);
  process.env.CODEX_HOME = wrong;
  const model = { id: 'fixture' };
  const catalog = { fetched_at: new Date().toISOString(), models: [{ slug: model.id,
    service_tiers: [{ id: 'priority', name: 'Fast' }] }] };
  fs.writeFileSync(path.join(wrong, 'models_cache.json'), JSON.stringify(catalog));
  fs.writeFileSync(path.join(wrong, OFFICIAL.storage.globalStateFile), JSON.stringify({ [OFFICIAL.storage.queueKey]: {} }));
  const b = new Bridge(path.join(root, 'bridge'));
  b.connected = true; b.desktop = { identity: {} };
  assert.throws(() => b.queue.read('task'), /目录尚未确认/);
  assert.deepEqual(withServiceTiers([model])[0].serviceTiers, []);
  b.officialStorage = { desktop: b.desktop, identity: b.desktop.identity, home: official };
  fs.writeFileSync(path.join(official, OFFICIAL.storage.globalStateFile), JSON.stringify({ [OFFICIAL.storage.queueKey]: {} }));
  fs.writeFileSync(path.join(official, 'models_cache.json'), JSON.stringify(catalog));
  assert.deepEqual(b.queue.read('task').messages, []);
  assert.equal(withServiceTiers([model], b.officialDataHome())[0].serviceTiers[0].id, 'priority');
  b.desktop.identity = {};
  assert.throws(() => b.queue.read('task'), /目录尚未确认/);
  assert.deepEqual(withServiceTiers([model], b.officialDataHome())[0].serviceTiers, []);
  assert.deepEqual(fs.readdirSync(official).sort(), [OFFICIAL.storage.globalStateFile, 'models_cache.json'].sort());
  clearInterval(b.subscriptionTimer);
});

test('connect resolves directory from the actual official identity; disconnect during resolution cannot activate it', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'official-connect-'));
  let resolve;
  const b = new Bridge(dir, { desktopFactory: () => ({ identity: { officialPid: 111 }, ipc: new EventEmitter(),
    tools: new EventEmitter(), async connect() {}, close() {} }),
    homeResolver: identity => { assert.equal(identity.officialPid, 111); return new Promise(r => resolve = r); } });
  t.after(() => { b.disconnect(); clearInterval(b.subscriptionTimer); fs.rmSync(dir, { recursive: true, force: true }); });
  const connected = b.connect();
  await new Promise(r => setImmediate(r));
  b.disconnect(); resolve(dir);
  await assert.rejects(connected, /cancelled/);
  assert.equal(b.officialDataHome(), null);
});
