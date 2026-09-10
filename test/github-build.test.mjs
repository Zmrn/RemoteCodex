import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import fs from 'node:fs';
import { buildConfig, certificateDigest, signingMaterial } from '../scripts/github-build.mjs';
import { verifyBuildManifest } from '../scripts/github-manifest.mjs';
import { verifyManifest } from '../src/update-format.mjs';

test('cloud artifact validation accepts original signed APK metadata, rejects substitutions, and leaves Windows updater EXE-only', () => {
  const keys = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const meta = { schema: 1, platform: 'android', file: 'RemoteCodex.apk', version: '0.10.27',
    packageName: 'com.anso.remotecodex', versionCode: 10027, bytes: 240000, sha256: 'a'.repeat(64) };
  const envelope = value => {
    const bytes = Buffer.from(JSON.stringify(value));
    return { payload: bytes.toString('base64'), signature: sign('sha256', bytes, keys.privateKey).toString('base64') };
  };
  assert.deepEqual(verifyBuildManifest(envelope(meta), meta.file, keys.publicKey), meta);
  assert.throws(() => verifyManifest(envelope(meta), keys.publicKey));
  for (const change of [{ packageName: 'com.wrong.app' }, { versionCode: 10028 }, { platform: 'windows-x64' },
    { file: 'Other.apk' }, { sha256: 'bad' }, { bytes: 0 }, { version: '0.10.1000' }])
    assert.throws(() => verifyBuildManifest(envelope({ ...meta, ...change }), meta.file, keys.publicKey));
  assert.throws(() => verifyBuildManifest({ ...envelope(meta), payload: envelope({ ...meta, bytes: 240001 }).payload }, meta.file, keys.publicKey), /signature/);
  const win = { schema: 1, platform: 'windows-x64', file: 'RemoteCodex.exe', version: meta.version, bytes: 50000000, sha256: meta.sha256 };
  assert.deepEqual(verifyBuildManifest(envelope(win), win.file, keys.publicKey), win);
  assert.throws(() => verifyBuildManifest(envelope(meta), win.file, keys.publicKey));
});

test('cloud builds require explicit update URL and original APK certificate without importing deployment credentials', () => {
  const env = { REMOTE_CODEX_UPDATE_BASE_URL: 'https://updates.example.test/resources',
    REMOTE_CODEX_ANDROID_CERT_SHA256: 'AB:'.repeat(31)+'AB', ANDROID_HOME: 'C:/Android', JAVA_HOME: 'C:/Java',
    PRIVATE_SSH_KEY: 'must-never-be-copied' };
  const config = buildConfig(env);
  assert.equal(config.baseUrl, 'https://updates.example.test/resources/');
  assert.equal(config.androidSdk, env.ANDROID_HOME);
  assert.equal(config.javaHome, env.JAVA_HOME);
  assert.equal(config.sshHost, 'ci-build-only.invalid');
  assert.ok(!JSON.stringify(config).includes(env.PRIVATE_SSH_KEY));
  for (const url of ['', 'https://user:password@example.test/', 'file:///test', 'https://example.test/?secret=key', 'https://example.test/#fragment'])
    assert.throws(() => buildConfig({ ...env, REMOTE_CODEX_UPDATE_BASE_URL: url }));
  assert.throws(() => buildConfig({ ...env, REMOTE_CODEX_ANDROID_CERT_SHA256: '' }), /original/);
  assert.equal(certificateDigest(env.REMOTE_CODEX_ANDROID_CERT_SHA256), 'ab'.repeat(32));
});

test('cloud restore rejects missing/malformed or replacement signing identities without returning secrets in errors', () => {
  const keys = generateKeyPairSync('rsa', { modulusLength: 2048 }), other = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const publicKey = keys.publicKey.export({ type: 'spki', format: 'pem' });
  const env = { REMOTE_CODEX_ANDROID_KEYSTORE_BASE64: Buffer.alloc(700, 7).toString('base64'),
    REMOTE_CODEX_ANDROID_KEYSTORE_PASSWORD: 'fixture-sensitive-password',
    REMOTE_CODEX_UPDATE_PRIVATE_KEY_PEM: keys.privateKey.export({ type: 'pkcs8', format: 'pem' }) };
  const material = signingMaterial(env, publicKey);
  assert.equal(material.keystore.length, 700);
  assert.equal(material.password, env.REMOTE_CODEX_ANDROID_KEYSTORE_PASSWORD);
  for (const change of [{ REMOTE_CODEX_ANDROID_KEYSTORE_BASE64: 'invalid?' },
    { REMOTE_CODEX_ANDROID_KEYSTORE_BASE64: 'YQ==' }, { REMOTE_CODEX_ANDROID_KEYSTORE_PASSWORD: '' },
    { REMOTE_CODEX_UPDATE_PRIVATE_KEY_PEM: env.REMOTE_CODEX_ANDROID_KEYSTORE_PASSWORD },
    { REMOTE_CODEX_UPDATE_PRIVATE_KEY_PEM: other.privateKey.export({ type: 'pkcs8', format: 'pem' }) }]) {
    assert.throws(() => signingMaterial({ ...env, ...change }, publicKey), error =>
      !error.message.includes('fixture-sensitive-password') && !error.message.includes('BEGIN PRIVATE KEY'));
  }
});

test('untrusted PR checks do not receive keys, signed build only uploads explicit dual-platform outputs', () => {
  const ci = fs.readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8');
  const build = fs.readFileSync(new URL('../.github/workflows/build.yml', import.meta.url), 'utf8');
  assert.doesNotMatch(ci, /secrets\.|pull_request_target/);
  assert.match(build, /environment: signing/);
  assert.match(build, /github\.ref == 'refs\/heads\/main'/);
  assert.match(build, /retention-days: 3/);
  assert.match(build, /dist\/RemoteCodex.exe/);
  assert.match(build, /dist\/RemoteCodex.apk/);
  assert.doesNotMatch(build, /run:.*publish|path:.*\*|contents: write/);
  for (const workflow of [ci, build]) {
    const uses = [...workflow.matchAll(/uses: ([^\s]+)/g)].map(m => m[1]);
    assert.ok(uses.length > 0);
    assert.ok(uses.every(u => /^actions\/[\w-]+@[0-9a-f]{40}$/.test(u)));
  }
});
