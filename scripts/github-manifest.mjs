// Build/download validation only. Keep the installed Windows updater EXE-only.
import { verify } from 'node:crypto';
import { verifyManifest } from '../src/update-format.mjs';

export function verifyBuildManifest(envelope, file, publicKey) {
  if (file === 'RemoteCodex.exe') return verifyManifest(envelope, publicKey);
  if (file !== 'RemoteCodex.apk') throw Error('Unexpected build artifact');
  if (!envelope || typeof envelope.payload !== 'string' || typeof envelope.signature !== 'string' ||
      envelope.payload.length > 16000 || envelope.signature.length > 2048)
    throw Error('Invalid Android update envelope');
  const payload = Buffer.from(envelope.payload, 'base64');
  if (!verify('sha256', payload, publicKey, Buffer.from(envelope.signature, 'base64')))
    throw Error('Android update signature mismatch');
  const meta = JSON.parse(payload);
  const parts = /^\d+\.\d+\.\d+$/.test(meta.version) ? meta.version.split('.').map(Number) : [];
  const code = parts.reduce((n, v) => n * 1000 + v, 0);
  if (meta.schema !== 1 || meta.platform !== 'android' || meta.file !== file ||
      meta.packageName !== 'com.anso.remotecodex' || parts.length !== 3 ||
      parts.some(v => !Number.isSafeInteger(v)) || parts[1] >= 1000 || parts[2] >= 1000 ||
      !Number.isSafeInteger(code) || code <= 0 || meta.versionCode !== code ||
      !/^[a-f0-9]{64}$/.test(meta.sha256) || !Number.isSafeInteger(meta.bytes) ||
      meta.bytes < 1024 || meta.bytes > 150 * 1024 * 1024)
    throw Error('Invalid Android update manifest');
  return meta;
}
