const MAX_BYTES = 64 * 1024 * 1024;
// Only a byte-derived validator permits appending, never a media ID or path.
const strongTag = value => /^"sha256-[a-f0-9]{64}"$/.test(value ?? '');
export class ImagePartials {
  constructor({ maxBytes = 96 * 1024 * 1024, ttlMs = 30 * 60 * 1000 } = {}) {
    this.entries = new Map(); this.maxBytes = maxBytes; this.ttlMs = ttlMs;
  }
  prune() {
    let bytes = 0;
    for (const [key, entry] of [...this.entries].reverse()) {
      if (Date.now() - entry.at > this.ttlMs || bytes + entry.value.loaded > this.maxBytes) this.entries.delete(key);
      else bytes += entry.value.loaded;
    }
  }
  get(key) { this.prune(); return this.entries.get(key)?.value; }
  set(key, value) {
    this.entries.delete(key);
    if (value?.loaded > 0 && value.loaded < value.total && strongTag(value.etag))
      this.entries.set(key, { value, at: Date.now() });
    this.prune();
  }
}

// Partial bytes are a bounded device/task/image cache, never conversation state.
// Every retry reauthorizes the media ID and validates the current source bytes.
export function imageTransfer(request, { partial, savePartial = () => {}, signal, idleTimeoutMs = 75000 } = {}) {
  const listeners = new Set();
  let progress = { phase: 'requesting', loaded: partial?.loaded ?? 0, total: partial?.total ?? null };
  const update = next => { progress = next; for (const listener of listeners) listener(next); };
  const controller = new AbortController(), combined = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
  let timer;
  const resetIdle = () => { clearTimeout(timer); timer = setTimeout(() => controller.abort(new DOMException('No image data received', 'TimeoutError')), idleTimeoutMs); };
  const wait = promise => new Promise((resolve, reject) => {
    const abort = () => reject(combined.reason);
    if (combined.aborted) { Promise.resolve(promise).catch(() => {}); return abort(); }
    combined.addEventListener('abort', abort, {once:true});
    Promise.resolve(promise).then(resolve, reject).finally(() => combined.removeEventListener('abort', abort));
  });
  const promise = (async () => {
    let chunks = partial?.chunks.slice() ?? [], loaded = partial?.loaded ?? 0;
    let total = partial?.total ?? null, etag = partial?.etag, type = partial?.type;
    let resumable = !!partial && strongTag(etag), reader, invalid = false;
    resetIdle();
    try {
      const headers = resumable ? { Range: 'bytes=' + loaded + '-', 'If-Range': etag } : {};
      const response = await wait(Promise.resolve().then(() => request({headers, signal:combined})));
      resetIdle();
      if (!response.ok) {
        if ([400,401,403,404,410,416].includes(response.status)) invalid = true;
        let reason;
        if (response.headers.get('content-type')?.includes('application/json')) {
          reader = response.body?.getReader();
          if (reader) {
            const parts = []; let size = 0;
            try {
              for (;;) { const {done, value} = await wait(reader.read()); if (done) break;
                resetIdle(); if ((size += value.byteLength) > 16384) break; parts.push(value); }
              if (size <= 16384) reason = JSON.parse(await new Blob(parts).text()).error;
            } catch {}
          }
        }
        throw Error(typeof reason === 'string' && reason.trim() ? reason.slice(0,300) : '图片请求失败（HTTP ' + response.status + '）');
      }
      const length = response.headers.get('content-length'), encoding = response.headers.get('content-encoding');
      const responseTotal = (!encoding || encoding === 'identity') && /^\d+$/.test(length ?? '') && Number(length) > 0 ? Number(length) : null;
      const responseTag = response.headers.get('etag'), responseType = response.headers.get('content-type') || 'application/octet-stream';
      if (response.status === 206) {
        const range = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(response.headers.get('content-range') ?? '');
        if (!resumable || !range || responseTag !== etag || responseType !== type ||
            Number(range[1]) !== loaded || Number(range[2]) !== total - 1 || Number(range[3]) !== total ||
            responseTotal !== total - loaded) {
          invalid = true; throw Error('图片续传校验失败，请重新下载');
        }
      } else if (response.status === 200) {
        // An old server or changed image returns a whole body. Never append it.
        chunks = []; loaded = 0; total = responseTotal; etag = responseTag; type = responseType;
        resumable = strongTag(etag) && total !== null && total <= MAX_BYTES && (!encoding || encoding === 'identity');
        savePartial(null);
      } else { invalid = true; throw Error('图片响应状态无效，请重试'); }
      if (total !== null && (!Number.isSafeInteger(total) || total > MAX_BYTES)) {
        invalid = true; throw Error('图片超过接收上限（64 MiB）');
      }
      update({phase:'downloading', loaded, total});
      reader = response.body?.getReader();
      if (reader) {
        for (;;) {
          const {done, value} = await wait(reader.read()); if (done) break;
          if (!value.byteLength) continue;
          resetIdle(); loaded += value.byteLength;
          if (loaded > MAX_BYTES || total !== null && loaded > total) {
            invalid = true; throw Error('图片大小与响应不符或超过接收上限');
          }
          chunks.push(value); update({phase:'downloading', loaded, total});
        }
      } else {
        const blob = await wait(response.blob()); chunks.push(blob); loaded += blob.size;
        if (loaded > MAX_BYTES) { invalid = true; throw Error('图片超过接收上限（64 MiB）'); }
      }
      if (total !== null && loaded !== total) throw Error('图片下载中断，收到的数据不完整，请重试');
      clearTimeout(timer);
      const blob = new Blob(chunks, {type});
      if (strongTag(etag)) {
        const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer()))].map(x => x.toString(16).padStart(2,'0')).join('');
        if (etag !== '"sha256-' + hash + '"') { invalid = true; throw Error('图片内容校验失败，请重新下载'); }
      }
      savePartial(null); update({phase:'decoding', loaded, total}); return blob;
    } catch (error) {
      const retained = !invalid && resumable && loaded > 0 && loaded < total;
      savePartial(retained ? {chunks, loaded, total, etag, type} : null);
      if (retained) throw new Error(imageFailure(error) + '；已保留 ' + Math.floor(loaded / total * 100) + '%，重试将继续下载', {cause:error});
      throw error;
    } finally {
      clearTimeout(timer);
      if (reader) { reader.cancel().catch(() => {}); reader.releaseLock(); }
      controller.abort();
    }
  })();
  return { promise, subscribe(listener) { listeners.add(listener); listener(progress); return () => listeners.delete(listener); } };
}

export function imageFailure(error) {
  if (error?.name === 'TimeoutError') return '图片下载超时，请检查连接后重试';
  if (error?.name === 'AbortError') return '图片下载已中断，请重试';
  const message = error?.message ?? '';
  if (/ENOENT|ENOTDIR/.test(message)) return '找不到原图，文件可能已移动或删除';
  if (/Failed to fetch|fetch failed|NetworkError|Load failed/i.test(message) || error instanceof TypeError)
    return '图片下载连接中断，请检查目标设备后重试';
  return message.trim().slice(0, 300) || '图片无法显示，请重试';
}
