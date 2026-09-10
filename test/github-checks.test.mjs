import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { requireSuccessfulChecks } from '../scripts/github-checks.mjs';
const sha = 'a'.repeat(40);
const run = (extra = {}) => ({ id: 7, head_sha: sha, head_branch: 'main', path: '.github/workflows/ci.yml',
  event: 'push', status: 'completed', conclusion: 'success', updated_at: '2026-09-10T10:00:00Z', html_url: 'https://example.test/run/7', ...extra });
const api = entries => async route => { assert.equal(route, `actions/workflows/ci.yml/runs?branch=main&head_sha=${sha}&per_page=100`); return { workflow_runs: entries }; };

test('build gate accepts only successful main Checks for the exact final commit', async () => {
  assert.deepEqual(await requireSuccessfulChecks(api([run()]), sha), { commit: sha, checksRunId: 7, checksUrl: 'https://example.test/run/7', checksPassed: true });
  for (const change of [{ head_sha: 'b'.repeat(40) }, { head_branch: 'feature' }, { path: '.github/workflows/build.yml' }, { event: 'pull_request' }])
    await assert.rejects(requireSuccessfulChecks(api([run(change)]), sha), /No main Checks/);
  await assert.rejects(requireSuccessfulChecks(api([]), sha), /No main Checks/);
});

test('pending, failed, cancelled, skipped, and newer reruns cannot reuse stale success', async () => {
  for (const change of [{ status: 'queued', conclusion: null }, { status: 'in_progress', conclusion: null },
    { conclusion: 'failure' }, { conclusion: 'cancelled' }, { conclusion: 'skipped' }]) {
    const latest = run({ id: 8, updated_at: '2026-09-10T11:00:00Z', ...change });
    await assert.rejects(requireSuccessfulChecks(api([run(), latest]), sha), /build blocked/);
  }
  await assert.rejects(requireSuccessfulChecks(api([run(), run({ id: 6, status: 'in_progress', conclusion: null, updated_at: '2026-09-10T12:00:00Z' })]), sha), /build blocked/);
});

test('missing evidence or API failure never becomes permission to build', async () => {
  await assert.rejects(requireSuccessfulChecks(async () => ({}), sha), /unavailable/);
  await assert.rejects(requireSuccessfulChecks(async () => { throw Error('network unavailable'); }, sha), /network unavailable/);
  await assert.rejects(requireSuccessfulChecks(async () => { throw Error('must not query'); }, 'short'), /full commit/);
});

test('both dispatch and hosted build invoke the gate before mutation or signing setup', () => {
  const cli = fs.readFileSync(new URL('../scripts/github-actions.mjs', import.meta.url), 'utf8');
  const workflow = fs.readFileSync(new URL('../.github/workflows/build.yml', import.meta.url), 'utf8');
  assert.ok(cli.indexOf('const readiness = await requireSuccessfulChecks') < cli.indexOf("/dispatches`, 'POST'"));
  assert.match(cli, /action === 'preflight'.*return;/);
  assert.match(workflow, /actions: read/);
  assert.ok(workflow.indexOf('check-commit $env:GITHUB_SHA') < workflow.indexOf('run: node scripts/github-build.mjs configure'));
  assert.ok(workflow.indexOf('check-commit $env:GITHUB_SHA') < workflow.indexOf('secrets.REMOTE_CODEX'));
});
