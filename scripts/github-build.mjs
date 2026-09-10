// GitHub-hosted build adapter. The installed application keeps its DPAPI format.
// Secret values are never written to stdout, command arguments or artifacts.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPrivateKey, createPublicKey, createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { verifyManifest } from '../src/update-format.mjs';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ownedFiles = ['release.local.json', 'data/android-signing.p12',
  'data/android-signing-password.json', 'data/release-signing-key.json'];
const marker = path.join(ROOT, 'work/github-build-owned.json');

export function buildConfig(env) {
  const base = env.REMOTE_CODEX_UPDATE_BASE_URL;
  if (!base) throw Error('Set signing environment variable REMOTE_CODEX_UPDATE_BASE_URL');
  const url = new URL(base);
  if (!['https:', 'http:'].includes(url.protocol) || !url.hostname || url.username || url.password || url.search || url.hash)
    throw Error('Invalid update resource base URL');
  if (!env.ANDROID_HOME || !env.JAVA_HOME) throw Error('Android SDK and JDK environment required');
  certificateDigest(env.REMOTE_CODEX_ANDROID_CERT_SHA256);
  return { baseUrl: base.replace(/\/+$/, '') + '/', androidSdk: env.ANDROID_HOME,
    javaHome: env.JAVA_HOME, buildTools: '35.0.1', androidPlatform: 'android-35',
    // Required by the legacy local config parser; no SSH credentials or deploy step.
    sshHost: 'ci-build-only.invalid', remoteDirectory: '/ci-build-only' };
}

export function certificateDigest(value) {
  const digest = (value ?? '').replaceAll(':', '').toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(digest)) throw Error('Set original REMOTE_CODEX_ANDROID_CERT_SHA256');
  return digest;
}

export function signingMaterial(env, expectedPublicKey) {
  const required = ['REMOTE_CODEX_ANDROID_KEYSTORE_BASE64', 'REMOTE_CODEX_ANDROID_KEYSTORE_PASSWORD', 'REMOTE_CODEX_UPDATE_PRIVATE_KEY_PEM'];
  if (required.some(name => !env[name])) throw Error('Configure all three original signing secrets in the signing environment');
  const base64 = env.REMOTE_CODEX_ANDROID_KEYSTORE_BASE64.replace(/\s/g, '');
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) throw Error('Invalid Android signing container');
  const keystore = Buffer.from(base64, 'base64');
  if (keystore.length < 500 || keystore.length > 32768 || keystore.toString('base64') !== base64)
    throw Error('Invalid Android signing container');
  let privateKey;
  try { privateKey = createPrivateKey(env.REMOTE_CODEX_UPDATE_PRIVATE_KEY_PEM); }
  catch { throw Error('Invalid update signing key'); }
  if (createPublicKey(privateKey).export({ type: 'spki', format: 'pem' }) !==
      createPublicKey(expectedPublicKey).export({ type: 'spki', format: 'pem' }))
    throw Error('Update signing identity does not match the committed public key');
  return { keystore, password: env.REMOTE_CODEX_ANDROID_KEYSTORE_PASSWORD,
    privateKey: privateKey.export({ type: 'pkcs8', format: 'pem' }) };
}

function requireHostedRunner(env = process.env) {
  if (env.GITHUB_ACTIONS !== 'true' || env.RUNNER_ENVIRONMENT !== 'github-hosted' ||
      env.GITHUB_REPOSITORY !== 'Zmrn/RemoteCodex' || env.GITHUB_REF !== 'refs/heads/main' ||
      !env.GITHUB_WORKSPACE || path.resolve(env.GITHUB_WORKSPACE).toLowerCase() !== ROOT.toLowerCase())
    throw Error('Signing adapter only runs in this repository main GitHub-hosted job');
}
function run(command, args) {
  execFileSync(command, args, { cwd: ROOT, windowsHide: true, stdio: 'inherit', env: process.env });
}
function seal(value) {
  // Error output is deliberately withheld: child stdin contains a signing secret.
  try {
    const out = execFileSync('python', ['src/win_secret.py'], { cwd: ROOT, windowsHide: true,
      input: JSON.stringify({ value, operation: 'protect' }), encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
    return JSON.parse(out).value;
  } catch { throw Error('Unable to protect signing material on the runner'); }
}
function markOwnership(files) {
  fs.mkdirSync(path.dirname(marker), { recursive: true });
  fs.writeFileSync(marker, JSON.stringify({ run: process.env.GITHUB_RUN_ID, files }));
}
async function main(action) {
  requireHostedRunner();
  if (action === 'configure') {
    const config = buildConfig(process.env);
    if (ownedFiles.some(f => fs.existsSync(path.join(ROOT, f))) || fs.existsSync(marker))
      throw Error('Refusing to overwrite existing local configuration or signing identity');
    markOwnership(ownedFiles);
    fs.writeFileSync(path.join(ROOT, 'release.local.json'), JSON.stringify(config), { flag: 'wx' });
  } else if (action === 'restore') {
    const state = JSON.parse(fs.readFileSync(marker));
    if (state.run !== process.env.GITHUB_RUN_ID || ownedFiles.slice(1).some(f => fs.existsSync(path.join(ROOT, f))))
      throw Error('Signing workspace already initialized or belongs to another run');
    const material = signingMaterial(process.env, fs.readFileSync(path.join(ROOT, 'src/update-public-key.pem')));
    const sealedPassword = seal(material.password), sealedPrivateKey = seal(material.privateKey);
    fs.mkdirSync(path.join(ROOT, 'data'), { recursive: true });
    fs.writeFileSync(path.join(ROOT, ownedFiles[1]), material.keystore, { flag: 'wx' });
    fs.writeFileSync(path.join(ROOT, ownedFiles[2]), JSON.stringify({ sealedPassword }), { flag: 'wx' });
    fs.writeFileSync(path.join(ROOT, ownedFiles[3]), JSON.stringify({ sealedPrivateKey }), { flag: 'wx' });
  } else if (action === 'verify') {
    const version = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'))).version;
    const publicKey = fs.readFileSync(path.join(ROOT, 'src/update-public-key.pem'));
    for (const [file, manifest] of [['RemoteCodex.exe', 'latest.json'], ['RemoteCodex.apk', 'android-latest.json']]) {
      run('node', ['scripts/sign-release.mjs', 'dist/' + file, version, 'dist/' + manifest]);
      const meta = verifyManifest(JSON.parse(fs.readFileSync(path.join(ROOT, 'dist', manifest))), publicKey);
      const data = fs.readFileSync(path.join(ROOT, 'dist', file));
      if (meta.version !== version || meta.bytes !== data.length || meta.sha256 !== createHash('sha256').update(data).digest('hex'))
        throw Error('Signed artifact verification failed');
    }
    run('python', ['-X', 'utf8', 'scripts/verify-compatibility-release.py']);
    const certText = execFileSync(path.join(process.env.JAVA_HOME, 'bin/java.exe'), ['-jar',
      path.join(process.env.ANDROID_HOME, 'build-tools/35.0.1/lib/apksigner.jar'),
      'verify', '--print-certs', 'dist/RemoteCodex.apk'], { cwd: ROOT, windowsHide: true, encoding: 'utf8' });
    const actual = /Signer #1 certificate SHA-256 digest:\s*([a-f0-9]+)/i.exec(certText)?.[1];
    if (certificateDigest(actual) !== certificateDigest(process.env.REMOTE_CODEX_ANDROID_CERT_SHA256))
      throw Error('APK certificate changed; refusing to upload');
    run('python', ['-X', 'utf8', 'scripts/verify-github-artifacts.py']);
    fs.writeFileSync(path.join(ROOT, 'dist/GITHUB-BUILD.json'), JSON.stringify({
      version, commit: process.env.GITHUB_SHA, runId: process.env.GITHUB_RUN_ID,
      runUrl: `https://github.com/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`,
      androidCertificateSha256: actual, liveDesktopTested: false, apkExecuted: false, published: false,
    }, null, 2));
  } else if (action === 'clean') {
    if (!fs.existsSync(marker)) return;
    const state = JSON.parse(fs.readFileSync(marker));
    if (state.run !== process.env.GITHUB_RUN_ID || JSON.stringify(state.files) !== JSON.stringify(ownedFiles))
      throw Error('Unexpected signing cleanup scope');
    for (const file of ownedFiles) fs.rmSync(path.join(ROOT, file), { force: true });
    fs.rmSync(marker);
  } else throw Error('Use configure, restore, verify or clean');
  console.log('GitHub build ' + action + ' completed; secret values omitted.');
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv[2]).catch(error => { console.error(error.message); process.exitCode = 1; });
}
