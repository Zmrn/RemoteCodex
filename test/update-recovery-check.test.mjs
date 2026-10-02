import test from 'node:test';
import assert from 'node:assert/strict';
import { confirmRestart } from '../src/update-recovery-check.mjs';

const expected = { version: '0.10.53', instanceId: 'old-instance', application: 'remote-codex' };
const actual = { ...expected, instanceId: 'new-instance', pid: 1234 };

test('a focused old desktop and wrong service cannot count as restart or rollback success', () => {
  for (const value of [undefined, { ...actual, instanceId: expected.instanceId },
    { ...actual, version: '0.10.52' }, { ...actual, application: 'limit-remote-codex' },
    { ...actual, instanceId: '' }, { ...actual, pid: 0 }, { ...actual, pid: undefined }])
    assert.throws(() => confirmRestart(value, expected), /尚未恢复/);
  assert.deepEqual(confirmRestart(actual, expected), actual);
  const limited = { version: '0.10.53', instanceId: 'old-limit', application: 'limit-remote-codex' };
  assert.deepEqual(confirmRestart({ ...actual, application: limited.application }, limited), { ...actual, application: limited.application });
});
