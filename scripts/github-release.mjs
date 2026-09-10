import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { verifyBuildManifest } from './github-manifest.mjs';
import { newerVersion } from '../src/update-format.mjs';
import { updateSource } from '../src/update-channel.mjs';

export const releaseFiles = ['RemoteCodex.exe', 'RemoteCodex.apk', 'RemoteCodex.build.json',
  'RemoteCodex.apk.build.json', 'latest.json', 'android-latest.json', 'RELEASE-NOTES.md', 'GITHUB-BUILD.json'];
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
export function verifyReleaseBundle(folder, run, publicKey) {
  if (run.conclusion !== 'success' || run.head_branch !== 'main' || run.path !== '.github/workflows/build.yml' ||
      !/^[0-9a-f]{40}$/.test(run.head_sha)) throw Error('A successful main GitHub dual build is required');
  const files = new Map(releaseFiles.map(name => [name, fs.readFileSync(path.join(folder, name))]));
  const provenance = JSON.parse(files.get('GITHUB-BUILD.json'));
  if (provenance.commit !== run.head_sha || String(provenance.runId) !== String(run.id) ||
      provenance.updateBaseUrl !== updateSource.baseUrl)
    throw Error('Build provenance or GitHub update channel mismatch; old server-based builds cannot be published here');
  let support;
  for (const [file, envelope, report] of [
    ['RemoteCodex.exe','latest.json','RemoteCodex.build.json'],
    ['RemoteCodex.apk','android-latest.json','RemoteCodex.apk.build.json'],
  ]) {
    const meta = verifyBuildManifest(JSON.parse(files.get(envelope)), file, publicKey);
    const built = JSON.parse(files.get(report)), bytes = files.get(file);
    if (meta.version !== provenance.version || meta.bytes !== bytes.length || meta.sha256 !== digest(bytes) ||
        meta.releaseNotesSha256 !== digest(files.get('RELEASE-NOTES.md')) ||
        built.version !== meta.version || built.bytes !== meta.bytes || built.sha256 !== meta.sha256 ||
        !meta.desktopCompatibility || !isDeepStrictEqual(built.desktopCompatibility, meta.desktopCompatibility) ||
        support && !isDeepStrictEqual(support, meta.desktopCompatibility)) throw Error('Dual release artifacts or metadata differ');
    support = meta.desktopCompatibility;
  }
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(provenance.version)) throw Error('Invalid release version');
  return { version: provenance.version, files, runId: String(run.id), commit: run.head_sha };
}

// All assets are verified in a draft before publication. Retries inspect the same
// version/run and never replace a published release or an ambiguous upload.
export async function publishRelease(client, bundle) {
  const { files, version, runId, commit } = bundle;
  const tag = 'v' + version, marker = `<!-- remote-codex-build:${runId}:${commit} -->`;
  const body = files.get('RELEASE-NOTES.md').toString('utf8') + '\n\n' + marker;
  const checkLatest = async () => {
    const latest = await client.get('releases/latest', true);
    if (latest && latest.tag_name !== tag &&
        (!/^v\d+\.\d+\.\d+$/.test(latest.tag_name) || !newerVersion(version, latest.tag_name.slice(1))))
      throw Error('A newer or unrecognized release is already current; refusing rollback');
  };
  await checkLatest();
  const ref = await client.get('git/ref/tags/' + tag, true);
  if (ref && (ref.object?.type !== 'commit' || ref.object.sha !== commit)) throw Error('Version tag targets another commit');
  let release = await client.get('releases/tags/' + tag, true);
  // The tag endpoint may omit drafts. List authenticated releases so an upload
  // with a lost response resumes its original draft instead of creating another.
  if (!release) {
    for (let page = 1; page <= 10; page++) {
      const listed = await client.get(`releases?per_page=100&page=${page}`);
      const matching = listed.filter(item => item.tag_name === tag);
      if (matching.length > 1) throw Error('Multiple drafts use this version; inspect before publishing');
      if (matching.length === 1) { release = matching[0]; break; }
      if (listed.length < 100) break;
      if (page === 10) throw Error('Release listing incomplete; refusing to create a duplicate draft');
    }
  }
  if (release && (release.body !== body || release.prerelease)) throw Error('This version belongs to another build');
  if (!release) release = await client.mutate('releases', 'POST', {
    tag_name: tag, target_commitish: commit, name: 'Remote Codex ' + version,
    body, draft: true, prerelease: false,
  });
  if (release.tag_name !== tag || release.body !== body || !ref && release.target_commitish !== commit)
    throw Error('Unexpected release identity');
  const assets = await client.get(`releases/${release.id}/assets?per_page=100`);
  if (assets.some(asset => !files.has(asset.name)) || new Set(assets.map(a => a.name)).size !== assets.length)
    throw Error('Release has unexpected or duplicate assets; left unchanged');
  for (const [name, bytes] of files) {
    let asset = assets.find(item => item.name === name);
    if (!asset) {
      if (!release.draft) throw Error('Published release is incomplete; refusing to modify it');
      asset = await client.upload(release.id, name, bytes);
    }
    if (asset.name !== name || asset.state !== 'uploaded' || asset.size !== bytes.length ||
        digest(await client.readAsset(asset.id, bytes.length)) !== digest(bytes)) throw Error('Uploaded asset verification failed: ' + name);
  }
  if (!release.draft) return { published: true, alreadyPublished: true, version, url: release.html_url };
  await checkLatest();
  await client.mutate('releases/' + release.id, 'PATCH', { draft: false, make_latest: 'legacy' });
  release = await client.get('releases/' + release.id);
  if (release.draft || release.tag_name !== tag || !release.body?.includes(marker))
    throw Error('Publication result not confirmed; inspect this version before retrying');
  return { published: true, version, url: release.html_url };
}
