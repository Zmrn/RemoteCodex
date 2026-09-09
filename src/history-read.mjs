import { TOOLS } from "./official-protocol.mjs";

// The official sender has its own frame limit. Local UI paging happens too late
// to help it, so retry only this read operation with the same official cursor.
const reducedReads = new WeakMap();
const readFailure = error => /Codex app tool request failed|native pipe message exceeds frame limit/i.test(error?.message ?? "");
export async function readOfficialHistory(desktop, id, cursor, turnLimit, checkConnection) {
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
    if (!data)
      throw new Error("官方暂时无法读取这段历史，可能内容过大。请稍后重试。", { cause: error });
    reduced ??= new Set();
    reducedReads.set(desktop, reduced);
    reduced.add(id);
    if (reduced.size > 128) reduced.delete(reduced.values().next().value);
  }
  return {
    data,
    readNotice: reduced?.has(id)
      ? "部分历史未能批量读取，已先显示可读内容；更早的消息将逐轮加载。"
      : null,
  };
}
