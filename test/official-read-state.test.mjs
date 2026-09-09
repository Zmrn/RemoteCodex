import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { OfficialReadState, parseOfficialReadState } from '../src/official-read-state.mjs';
import { OFFICIAL } from '../src/official-protocol.mjs';
const key = OFFICIAL.storage.readState.key, account = 'a'.repeat(64), host = 'local:' + 'b'.repeat(64);
const stored = (ids = []) => ({ [key]: { version: 1, unreadByIdentity: { [account]: { [host]: ids } } } });
const desktop = version => ({ identity: { officialPid: 123, appToolsPipe: { image: OFFICIAL.support.packagePrefix + version + OFFICIAL.support.packageSuffix + '\\app\\ChatGPT.exe' } } });
test('only absence across all stored partitions excludes a task; no current account is guessed', () => {
  const value = stored(['task-a']); value[key].unreadByIdentity['c'.repeat(64)] = { ['other:' + 'd'.repeat(64)]: ['task-b'] };
  const before = JSON.stringify(value), state = parseOfficialReadState(value);
  assert.equal(state.status, 'available'); assert.equal(state.excludes('task-a'), false); assert.equal(state.excludes('task-b'), false);
  assert.equal(state.excludes('read-task'), true); assert.equal(JSON.stringify(value), before);
  assert.deepEqual(Object.keys(state), ['status', 'excludes']);
});
test('missing, newer, malformed, logged-out and uninitialized local state never becomes an empty unread list', () => {
  for (const value of [{}, { [key]: { version: 2, unreadByIdentity: {} } }, { [key]: { version: 1, unreadByIdentity: {} } },
    { [key]: { version: 1, unreadByIdentity: { bad: {} } } }, stored([null]), stored({}),
    { [key]: { version: 1, unreadByIdentity: { [account]: { remote: [] } } } }]) {
    const state = parseOfficialReadState(value); assert.equal(state.status, 'unavailable'); assert.equal(state.excludes('task'), false);
  }
});
test('pending legacy migrations retain marks, adopted and cleared migrations cannot resurrect old unread IDs', () => {
  const value = stored();
  value[key].legacyMigration = { identityKey: account, unreadThreadIdsByHostId: { local: ['old'], remote: ['pending'] }, adoptedHostIds: { local: host } };
  let state = parseOfficialReadState(value); assert.equal(state.excludes('old'), true); assert.equal(state.excludes('pending'), false);
  value[key].legacyMigration.cleared = true; assert.equal(parseOfficialReadState(value).excludes('pending'), true);
  delete value[key].legacyMigration;
  value[OFFICIAL.storage.readState.atomKey] = { [OFFICIAL.storage.readState.legacyKey]: { local: ['pending'] } };
  assert.equal(parseOfficialReadState(value).excludes('pending'), false);
});
test('reader follows the verified desktop home, rereads changes and never modifies official or Remote Codex files', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'official-read-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, OFFICIAL.storage.globalStateFile), d = desktop('26.903.8094.0');
  let calls = 0; const reader = new OfficialReadState(d, { homeResolver: async identity => { assert.equal(identity, d.identity); calls++; return dir; } });
  fs.writeFileSync(file, JSON.stringify(stored(['new'])));
  const before = fs.readFileSync(file); assert.equal((await reader.snapshot()).excludes('new'), false); assert.deepEqual(fs.readFileSync(file), before);
  fs.writeFileSync(file, JSON.stringify(stored())); assert.equal((await reader.snapshot()).excludes('new'), true);
  fs.writeFileSync(file, JSON.stringify(stored(['new']))); assert.equal((await reader.snapshot()).excludes('new'), false);
  assert.equal(calls, 1); assert.deepEqual(fs.readdirSync(dir), [OFFICIAL.storage.globalStateFile]);
  fs.writeFileSync(file, '{'); assert.equal((await reader.snapshot()).status, 'unavailable'); assert.equal(fs.readFileSync(file, 'utf8'), '{');
  fs.writeFileSync(file, Buffer.alloc(OFFICIAL.storage.readState.maxBytes + 1)); assert.equal((await reader.snapshot()).status, 'unavailable');
});
test('unverified versions never inspect a home; resolver failures, replacement and retry remain optional', async () => {
  for (const version of ['26.901.6511.0', '99.1.1.1']) {
    const reader = new OfficialReadState(desktop(version), { homeResolver: () => { throw Error('must not inspect'); } });
    assert.equal((await reader.snapshot()).status, 'unsupported');
  }
  const d = desktop('26.903.8094.0'); let calls = 0, now = 0;
  const reader = new OfficialReadState(d, { now: () => now, homeResolver: async () => { calls++; throw Error('denied'); } });
  assert.equal((await reader.snapshot()).status, 'unavailable'); await reader.snapshot(); assert.equal(calls, 1);
  now = 60001; await reader.snapshot(); assert.equal(calls, 2);
  d.identity = { ...d.identity }; await reader.snapshot(); assert.equal(calls, 3);
});
