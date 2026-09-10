import { TOOLS } from "./official-protocol.mjs";

// The official sender has its own frame limit. Local UI paging happens too late
// to help it, so retry only this read operation with the same official cursor.
const reducedReads = new WeakMap();
const fallbackReads = new WeakMap(), anchors = new WeakMap();
const readFailure = error => /Codex app tool request failed|native pipe message exceeds frame limit/i.test(error?.message ?? "");
export async function readOfficialHistory(desktop, id, cursor, turnLimit, checkConnection, fallback) {
  let fallbackThreads = fallbackReads.get(desktop);
  const fromDisk = async () => {
    checkConnection();
    const internal = cursor?.startsWith('rollout:');
    const beforeTurnId = cursor && !internal ? anchors.get(desktop)?.get(id + ':' + cursor) : null;
    if (cursor && !internal && !beforeTurnId) throw Error('无法对齐官方历史游标，请重新打开会话；当前内容已保留');
    const data = await fallback({cursor:internal ? cursor : null,beforeTurnId});
    checkConnection();
    fallbackThreads ??= new Set(); fallbackThreads.add(id); fallbackReads.set(desktop,fallbackThreads);
    if (fallbackThreads.size > 128) fallbackThreads.delete(fallbackThreads.values().next().value);
    return {data, readNotice:'已改用官方原始历史分段读取，图片按需加载；实时状态仍以官方连接为准。'};
  };
  if (fallback && (cursor?.startsWith('rollout:') || !cursor && fallbackThreads?.has(id))) return fromDisk();
  let reduced = reducedReads.get(desktop);
  const alreadyReduced = reduced?.has(id) ?? false;
  const request = async limit => {
    checkConnection();
    const data = await desktop.call(TOOLS.readThread, {
      threadId: id, turnLimit: limit, includeOutputs: true,
      maxOutputCharsPerItem: 12000, ...(cursor ? { cursor } : {}),
    });
    checkConnection();
    return data;
  };
  let data;
  try {
    data = await request(alreadyReduced ? 1 : turnLimit);
  } catch (error) {
    checkConnection();
    if (!readFailure(error)) throw error;
    if (!alreadyReduced && turnLimit > 1) {
      try { data = await request(1); }
      catch (singleError) {
        checkConnection();
        if (!readFailure(singleError)) throw singleError;
        error = singleError;
      }
    }
    if (!data) {
      if (fallback) return fromDisk();
      throw new Error("官方读取接口未能返回这段历史，可能超过单次传输上限；当前内容已保留。", { cause: error });
    }
    reduced ??= new Set();
    reducedReads.set(desktop, reduced);
    reduced.add(id);
    if (reduced.size > 128) reduced.delete(reduced.values().next().value);
  }
  if (fallback && data.page?.nextCursor && data.turns?.length) {
    let entries = anchors.get(desktop); if (!entries) anchors.set(desktop,entries=new Map());
    entries.set(id + ':' + data.page.nextCursor,data.turns.at(-1).id);
    while (entries.size>1024) entries.delete(entries.keys().next().value);
  }
  return {
    data,
    readNotice: reduced?.has(id)
      ? "部分历史未能批量读取，已先显示可读内容；更早的消息将逐轮加载。"
      : null,
  };
}
