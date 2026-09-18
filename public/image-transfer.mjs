// Progress is measured from response bytes. Cached transfers can have multiple
// viewers; each subscribes without owning/cancelling another viewer's request.
export function imageTransfer(request) {
  const listeners = new Set();
  let progress = { phase: 'requesting', loaded: 0, total: null };
  const update = next => { progress = next; for (const listener of listeners) listener(next); };
  const promise = Promise.resolve().then(request).then(async response => {
    if (!response.ok) {
      let reason;
      if (response.headers.get('content-type')?.includes('application/json')) {
        // Errors should be small, even if an older target returns an unexpected body.
        const reader = response.body?.getReader();
        if (reader) {
          const parts = []; let size = 0;
          try {
            for (;;) { const {done, value} = await reader.read(); if (done) break;
              if ((size += value.byteLength) > 16384) break; parts.push(value); }
            if (size <= 16384) reason = JSON.parse(await new Blob(parts).text()).error;
          } catch {} finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
        }
      }
      throw Error(typeof reason === 'string' && reason.trim() ? reason.slice(0, 300) : `图片请求失败（HTTP ${response.status}）`);
    }
    const length = response.headers.get('content-length');
    const total = !response.headers.get('content-encoding') && /^\d+$/.test(length ?? '') && Number(length) > 0 ? Number(length) : null;
    const type = response.headers.get('content-type') || 'application/octet-stream';
    let loaded = 0;
    update({phase:'downloading', loaded, total});
    const reader = response.body?.getReader();
    let blob;
    if (!reader) { blob = await response.blob(); loaded = blob.size;
      if (loaded > 64 * 1024 * 1024) throw Error('图片超过接收上限（64 MiB）'); }
    else {
      const chunks = [];
      try {
        for (;;) { const {done, value} = await reader.read(); if (done) break;
          loaded += value.byteLength;
          // Existing target-side bounds also apply to bytes kept in the viewer.
          if (loaded > 64 * 1024 * 1024) throw Error('图片超过接收上限（64 MiB）');
          chunks.push(value); update({phase:'downloading', loaded, total});
        }
        blob = new Blob(chunks, {type});
      } catch (e) { await reader.cancel().catch(() => {}); throw e; }
      finally { reader.releaseLock(); }
    }
    if (total !== null && loaded !== total) throw Error('图片下载中断，收到的数据不完整，请重试');
    update({phase:'decoding', loaded, total});
    return blob;
  });
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
