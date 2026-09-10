// Conversational CI control: existing GitHub login stays in memory only.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { verifyBuildManifest } from './github-manifest.mjs';
import { verifyReleaseBundle, publishRelease } from './github-release.mjs';
import { updateSource, fetchUpdateAsset, readUpdateBytes } from '../src/update-channel.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repository = updateSource.repository;
const workflow = 'build.yml';
function credential() {
  if (process.env.GH_TOKEN || process.env.GITHUB_TOKEN) return process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
  try {
    const raw = execFileSync('git', ['-c', 'credential.interactive=false', 'credential', 'fill'], {
      cwd: root, input: 'protocol=https\nhost=github.com\n\n', encoding: 'utf8',
      windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, GCM_INTERACTIVE: 'never' },
    });
    const token = raw.split(/\r?\n/).find(x => x.startsWith('password='))?.slice(9);
    if (token) return token;
  } catch {}
  throw Error('GitHub authentication unavailable. Sign in with Git Credential Manager or provide GH_TOKEN through a secure environment, never in chat.');
}
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
function id(value) { if (!/^\d+$/.test(value ?? '')) throw Error('Numeric run ID required'); return value; }
function describe(run) { return { runId: run.id, status: run.status, conclusion: run.conclusion, commit: run.head_sha, url: run.html_url }; }
async function main() {
  const [action = 'status', value] = process.argv.slice(2), token = credential();
  const api = async (route, method = 'GET', body, redirect = 'error') => {
    const response = await fetch(`https://api.github.com/repos/${repository}/${route}`, {
      method, redirect, headers: { Authorization: 'Bearer '+token, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(30000),
    });
    if (redirect === 'manual' && response.status === 302) return response;
    if (!response.ok) throw Error(`GitHub API ${response.status} for ${route.split('?')[0]}`);
    return response.status === 204 ? null : response.json();
  };
  if (action === 'build') {
    const branch = await api('branches/main');
    const local = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, windowsHide: true, encoding: 'utf8' }).trim();
    const changes = execFileSync('git', ['status', '--porcelain', '--untracked-files=no'], { cwd: root, windowsHide: true, encoding: 'utf8' }).trim();
    if (local !== branch.commit.sha || changes) throw Error('Commit and push tracked changes, then synchronize GitHub main before building');
    const requestId = randomUUID();
    await api(`actions/workflows/${workflow}/dispatches`, 'POST', { ref: 'main', inputs: { request_id: requestId } });
    for (let attempt = 0; attempt < 15; attempt++) {
      const { workflow_runs: runs } = await api(`actions/workflows/${workflow}/runs?event=workflow_dispatch&branch=main&per_page=20`);
      const run = runs.find(x => x.display_title === 'Build '+requestId && x.head_sha === local);
      if (run) { console.log(JSON.stringify(describe(run), null, 2)); return; }
      await sleep(2000);
    }
    throw Error('Build dispatch accepted but run ID is not visible yet. Use status; do not dispatch again. Request: '+requestId);
  } else if (action === 'status' || action === 'watch') {
    if (!value) {
      const { workflow_runs: runs } = await api('actions/runs?per_page=10');
      console.log(JSON.stringify(runs.map(describe), null, 2)); return;
    }
    const runId = id(value), end = Date.now()+35*60*1000; let previous;
    for (;;) {
      const run = await api('actions/runs/'+runId), summary = describe(run);
      if (JSON.stringify(summary) !== previous) { console.log(JSON.stringify(summary)); previous = JSON.stringify(summary); }
      if (action !== 'watch' || run.status === 'completed' || run.status === 'waiting') {
        if (run.status === 'completed' && run.conclusion !== 'success') process.exitCode = 1;
        return;
      }
      if (Date.now() > end) throw Error('Watch timed out; the GitHub job was not cancelled');
      await sleep(10000);
    }
  } else if (action === 'download') {
    const runId = id(value), run = await api('actions/runs/'+runId);
    if (run.path !== '.github/workflows/'+workflow || run.conclusion !== 'success' || run.head_branch !== 'main')
      throw Error('Only a successful main dual-platform build can be downloaded');
    const { artifacts } = await api(`actions/runs/${runId}/artifacts`);
    const matches = artifacts.filter(a => !a.expired && a.name === `RemoteCodex-${run.run_number}-${run.head_sha}`);
    if (matches.length !== 1 || matches[0].size_in_bytes > 150*1024*1024) throw Error('Expected one bounded dual-platform artifact');
    const redirect = await api(`actions/artifacts/${matches[0].id}/zip`, 'GET', undefined, 'manual');
    const url = redirect.headers.get('location');
    if (!url?.startsWith('https://')) throw Error('GitHub did not return an HTTPS artifact download');
    // Never forward the GitHub credential to the artifact storage host.
    const response = await fetch(url, { signal: AbortSignal.timeout(180000) });
    if (!response.ok) throw Error('Artifact download failed: '+response.status);
    const folder = path.join(root, 'work/github-downloads', runId); fs.mkdirSync(folder, { recursive: true });
    const archive = path.join(folder, 'artifacts.zip');
    await pipeline(Readable.fromWeb(response.body), fs.createWriteStream(archive, { flags: 'wx' }));
    execFileSync('python', [path.join(root, 'scripts/extract-github-artifact.py'), archive], { cwd: root, windowsHide: true, stdio: 'inherit' });
    const provenance = JSON.parse(fs.readFileSync(path.join(folder, 'GITHUB-BUILD.json')));
    if (provenance.commit !== run.head_sha || String(provenance.runId) !== runId) throw Error('Downloaded build provenance mismatch');
    for (const [file, manifest] of [['RemoteCodex.exe','latest.json'],['RemoteCodex.apk','android-latest.json']]) {
      const meta = verifyBuildManifest(JSON.parse(fs.readFileSync(path.join(folder, manifest))), file, fs.readFileSync(path.join(root, 'src/update-public-key.pem')));
      const crypto = await import('node:crypto'), bytes = fs.readFileSync(path.join(folder, file));
      if (meta.bytes !== bytes.length || meta.version !== provenance.version || meta.sha256 !== crypto.createHash('sha256').update(bytes).digest('hex'))
        throw Error('Downloaded signed artifact hash mismatch');
      if (meta.releaseNotesSha256 !== crypto.createHash('sha256').update(fs.readFileSync(path.join(folder, 'RELEASE-NOTES.md'))).digest('hex'))
        throw Error('Downloaded release notes hash mismatch');
    }
    console.log(JSON.stringify({ ...describe(run), version: provenance.version, files: ['RemoteCodex.exe','RemoteCodex.apk'].map(f=>path.join(folder,f)), verified: true }, null, 2));
  } else if (action === 'publish') {
    const runId = id(value), run = await api('actions/runs/' + runId);
    const folder = path.join(root, 'work/github-downloads', runId);
    const bundle = verifyReleaseBundle(folder, run, fs.readFileSync(path.join(root, 'src/update-public-key.pem')));
    // Credentials only ever reach api.github.com or this repository's upload API.
    const client = {
      get: async (route, allow404 = false) => {
        try { return await api(route); }
        catch (error) { if (allow404 && error.message.startsWith('GitHub API 404 ')) return null; throw error; }
      },
      mutate: (route, method, body) => api(route, method, body),
      upload: async (releaseId, name, bytes) => {
        const response = await fetch(`https://uploads.github.com/repos/${repository}/releases/${id(String(releaseId))}/assets?name=${encodeURIComponent(name)}`, {
          method: 'POST', redirect: 'error', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/octet-stream' },
          body: bytes, signal: AbortSignal.timeout(180000),
        });
        if (!response.ok) throw Error('Release upload result unconfirmed (' + response.status + '); inspect the draft before retrying');
        return response.json();
      },
      readAsset: async (assetId, limit) => {
        const response = await fetch(`https://api.github.com/repos/${repository}/releases/assets/${id(String(assetId))}`, {
          redirect: 'manual', headers: { Authorization: 'Bearer ' + token, Accept: 'application/octet-stream' }, signal: AbortSignal.timeout(180000),
        });
        if (response.status === 200 && !response.headers.get('content-type')?.includes('json')) return readUpdateBytes(response, limit);
        if (response.status !== 302 || !response.headers.get('location')) throw Error('Cannot verify uploaded release asset');
        const download = await fetchUpdateAsset(response.headers.get('location'), { signal: AbortSignal.timeout(180000) });
        if (!download.ok) throw Error('Cannot download uploaded release asset for verification');
        return readUpdateBytes(download, limit);
      },
    };
    console.log(JSON.stringify(await publishRelease(client, bundle), null, 2));
  } else throw Error('Usage: node scripts/github-actions.mjs build | status [runId] | watch runId | download runId | publish runId');
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
