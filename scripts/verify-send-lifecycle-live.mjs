// Dedicated durable probe only; retries keep the same request IDs.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Bridge, ROOT } from '../src/bridge.mjs';
import { parseModels } from '../src/settings.mjs';
const dir = path.join(ROOT, 'work/send-lifecycle-official-probe');
fs.mkdirSync(dir, { recursive: true });
const file = path.join(dir, 'probe.json');
const probe = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file)) : { createKey: randomUUID(), sendKey: randomUUID() };
const save = () => fs.writeFileSync(file, JSON.stringify(probe, null, 2)); save();
const b = new Bridge(path.join(dir, 'bridge'));
const result = { source: 'official-desktop-owner-IPC', time: new Date().toISOString() };
async function until(fn) {
  const deadline = Date.now() + 90000;
  while (Date.now() < deadline) { const r = await fn(); if (r) return r; await new Promise(resolve => setTimeout(resolve, 1000)); }
  throw Error('Probe timed out; inspect this same probe before retrying');
}
try {
  await b.connect(); result.officialPid = b.desktop.identity.officialPid;
  if (!probe.id) {
    const models = parseModels(b.desktop.catalog), model = models.find(m => m.id === 'gpt-5.6-luna') ?? models.find(m => m.efforts.includes('low'));
    assert.ok(model);
    const created = await b.createProbe(probe.createKey, '只回复 READY。不要使用工具。', { model: model.id, effort: 'low', permissionMode: 'read-only' });
    probe.id = created.result?.threadId; assert.ok(probe.id); save();
  }
  b.guardProbe(probe.id); result.threadId = probe.id;
  await until(async () => (await b.codexThread(probe.id)).thread.status.type === 'idle');
  const r = await b.nativeSend(probe.id, probe.sendKey, '只回复 REMOTE_REVIEW_SEND_OK。不要使用工具。');
  assert.equal(r.status, 'accepted'); result.ownerClientId = r.result.handledByClientId;
  result.turnId = r.result.result?.result?.turn?.id; assert.ok(result.turnId);
  assert.equal((await b.nativeSend(probe.id, probe.sendKey, '只回复 REMOTE_REVIEW_SEND_OK。不要使用工具。')).deduplicated, true);
  await until(async () => {
    const read = await b.read(probe.id), turn = read.data.turns.find(t => t.id === result.turnId);
    return turn?.status === 'completed' && turn.items.some(i => i.type === 'agentMessage' && i.text?.includes('REMOTE_REVIEW_SEND_OK'));
  });
  await b.follow(probe.id, 'review-viewer-one'); await b.follow(probe.id, 'review-viewer-two');
  b.subscriptions.remove(probe.id, undefined);
  b.unfollow(probe.id, 'review-viewer-one'); assert.equal(b.watching.has(probe.id), true);
  b.unfollow(probe.id, 'review-viewer-two'); assert.equal(b.watching.has(probe.id), false); assert.equal(b.live.has(probe.id), false);
  assert.equal((await b.codexThread(probe.id)).thread.status.type, 'idle');
  result.result = 'passed'; result.deduplicated = true; result.viewerReleased = true;
} catch (e) { result.result = 'failed'; result.error = e.message; process.exitCode = 1; }
finally { b.disconnect(); fs.writeFileSync(path.join(dir, 'result.json'), JSON.stringify(result, null, 2)); console.log(JSON.stringify(result)); }
