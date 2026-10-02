import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseModels } from '../src/settings.mjs';
import { withServiceTiers, tierOverride } from '../src/service-tiers.mjs';
const scratch = new URL('./scratch/', import.meta.url);
fs.mkdirSync(scratch, { recursive: true });
function cacheFixture() {
  const home = fs.mkdtempSync(path.join(fileURLToPath(scratch), 'speed-'));
  const save = value => fs.writeFileSync(path.join(home, 'models_cache.json'), JSON.stringify(value));
  return { home, save };
}

test('official model catalog keeps ultrafast only on the model which declares it and rejects forged tiers', () => {
  const f = cacheFixture(), models = [{ id: 'eligible' }, { id: 'other' }];
  f.save({ fetched_at: new Date().toISOString(), models: [
    { slug: 'eligible', service_tiers: [{ id: 'priority', name: 'Fast' }, { id: 'ultrafast', name: 'Ultrafast' }, { id: 'invented' }] },
    { slug: 'other', service_tiers: [{ id: 'priority', name: 'Fast' }] },
  ] });
  const observed = withServiceTiers(models, f.home);
  assert.deepEqual(observed[0].serviceTiers.map(t => t.id), ['priority', 'ultrafast']);
  assert.deepEqual(observed[1].serviceTiers.map(t => t.id), ['priority']);
  assert.deepEqual(tierOverride('ultrafast', 'eligible', observed), { serviceTier: 'ultrafast' });
  assert.throws(() => tierOverride('ultrafast', 'other', observed), /未提供此加速档位/);
  assert.throws(() => tierOverride('invented', 'eligible', observed), /未提供此加速档位/);
  assert.deepEqual(tierOverride('default', 'other', []), { serviceTier: 'default' });
  assert.deepEqual(withServiceTiers(models)[0].serviceTiers, [], 'no guessed official home');
});

test('expired, future and malformed catalog cannot authorize ultrafast', () => {
  const f = cacheFixture(), models = [{ id: 'eligible' }];
  for (const data of [
    { fetched_at: new Date(Date.now() - 86400001).toISOString(), models: [{ slug: 'eligible', service_tiers: [{ id: 'ultrafast' }] }] },
    { fetched_at: new Date(Date.now() + 86400000).toISOString(), models: [{ slug: 'eligible', service_tiers: [{ id: 'ultrafast' }] }] },
    { fetched_at: new Date().toISOString(), models: {} },
    { fetched_at: new Date().toISOString(), models: [{ slug: 'eligible', service_tiers: {} }] },
  ]) {
    f.save(data);
    const observed = withServiceTiers(models, f.home);
    assert.deepEqual(observed[0].serviceTiers, []);
    assert.throws(() => tierOverride('ultrafast', 'eligible', observed), /未提供此加速档位/);
  }
});

test('model schemas with per-model service tiers retain efforts and supersede older cache declarations', () => {
  const catalog = [{ namespace: 'codex_app', name: 'send_message_to_thread', inputSchema: { properties: {
    model: { description: 'Models: eligible (Fixture; supported reasoning efforts: low, medium, ultra; service tiers: priority, ultrafast), other (Fixture; supported reasoning efforts: low, high; service tiers: priority), old (Legacy; supported reasoning efforts: low, high).' },
  } } }];
  const parsed = parseModels(catalog), f = cacheFixture();
  assert.deepEqual(parsed.map(m => m.efforts), [['low', 'medium', 'ultra'], ['low', 'high'], ['low', 'high']]);
  f.save({ fetched_at: new Date().toISOString(), models: [
    { slug: 'eligible', service_tiers: [{ id: 'priority' }] },
    { slug: 'other', service_tiers: [{ id: 'ultrafast' }] },
    { slug: 'old', service_tiers: [{ id: 'fast' }] },
  ] });
  const observed = withServiceTiers(parsed, f.home);
  assert.deepEqual(observed.map(m => m.serviceTiers.map(t => t.id)), [['priority', 'ultrafast'], ['priority'], ['fast']]);
  assert.equal(observed[0].serviceTiersSource, 'official-desktop-tools-schema-live');
  assert.throws(() => tierOverride('ultrafast', 'other', observed), /未提供此加速档位/);
});
