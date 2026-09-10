import { OFFICIAL, TOOLS } from './official-protocol.mjs';

// Operation preflight needs current task metadata, never message bodies. The
// official list reads runtime metadata without serializing whole turns.
export async function readCodexThreadMetadata(desktop, id, check) {
  let list;
  try { list = await desktop.call(TOOLS.listThreads, { limit: 50 }); }
  catch { check(); } // A missing/broken list must not disable a healthy read tool.
  check();
  const matches = [...(Array.isArray(list?.pinnedThreads) ? list.pinnedThreads : []),
    ...(Array.isArray(list?.threads) ? list.threads : [])].filter(t => t?.id === id);
  if (matches.length) {
    if (matches.some(t => t.kind !== 'codex' || t.hostId !== OFFICIAL.discovery.hostId))
      throw Error('无法确认这是当前设备的 Codex 会话，操作未发送');
    const row = matches[0], type = typeof row.status === 'string' ? row.status : row.status?.type;
    const metadata = t => JSON.stringify([t.kind,t.hostId,t.cwd,t.title,t.status]);
    if (matches.some(t => metadata(t) !== metadata(row))) throw Error('官方任务信息不一致，请刷新后重试');
    return { source: 'official-list-live', thread: { ...row, status: typeof row.status === 'string' ? { type } : row.status ?? {type:'unknown'} } };
  }
  // Newly created or older unpinned tasks may be absent from the bounded list.
  // Retain the official per-task path, without a disk/status fallback.
  let result;
  try { result = await desktop.call(TOOLS.readThread, { threadId: id, turnLimit: 1, includeOutputs: false, maxOutputCharsPerItem: 1 }); }
  catch (error) {
    check();
    if (/Codex app tool request failed|native pipe message exceeds frame limit/i.test(error.message))
      throw new Error('官方接口无法确认当前任务状态，可能是历史超过传输上限；操作未发送，草稿已保留。请在官方应用打开或固定此任务后刷新重试。', { cause: error });
    throw error;
  }
  check();
  if (result.thread?.id !== id || result.thread.kind !== 'codex' ||
      result.thread.hostId !== undefined && result.thread.hostId !== OFFICIAL.discovery.hostId)
    throw Error('目前仅支持 Codex 会话写入，且必须属于当前设备');
  return { thread: result.thread, source: 'official-thread-live' };
}
