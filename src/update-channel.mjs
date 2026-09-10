import fs from 'node:fs';
export const updateSource = Object.freeze(JSON.parse(fs.readFileSync(new URL('./update-source.json', import.meta.url))));
const files = new Set(['latest.json', 'android-latest.json', 'RemoteCodex.exe', 'RemoteCodex.apk', 'RELEASE-NOTES.md']);
export function releaseAssetUrl(version, file) {
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version) || !files.has(file))
    throw Error('Invalid release asset');
  return `https://github.com/${updateSource.repository}/releases/download/v${version}/${file}`;
}
function checkUrl(value) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.port || url.hash ||
      !(url.hostname === 'github.com' && url.pathname.startsWith(`/${updateSource.repository}/releases/`) ||
        ['release-assets.githubusercontent.com', 'objects.githubusercontent.com'].includes(url.hostname)))
    throw Error('更新下载地址不属于 GitHub Releases');
  return url;
}
// GitHub redirects release assets to its CDN. Never forward app or account credentials.
export async function fetchUpdateAsset(value, { signal, fetcher = fetch } = {}) {
  let url = checkUrl(value);
  for (let hop = 0; hop <= 5; hop++) {
    const response = await fetcher(url, { redirect: 'manual', signal, cache: 'no-store',
      headers: { 'User-Agent': 'RemoteCodex-Updater' } });
    if (![301, 302, 303, 307, 308].includes(response.status)) return response;
    await response.body?.cancel();
    const location = response.headers.get('location');
    if (!location || hop === 5) throw Error('GitHub 更新重定向异常');
    url = checkUrl(new URL(location, url));
  }
}

export async function readUpdateBytes(response, limit) {
  if (Number(response.headers.get('content-length')) > limit) {
    await response.body?.cancel(); throw Error('更新资源超过允许大小');
  }
  let total = 0; const chunks = [];
  for await (const chunk of response.body) {
    total += chunk.length;
    if (total > limit) throw Error('更新资源超过允许大小');
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}
