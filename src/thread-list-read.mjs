import { TOOLS } from './official-protocol.mjs';
import { readOfficialThreadIndex, supplementOfficialThreads } from './official-thread-index.mjs';

export const THREAD_LIST_TIMEOUT_MS = 6000;
const retryDelay = 30000;
const slots = new WeakMap();
const notice = '官方会话列表暂未响应，先显示官方本机索引中的 Codex 任务。列表可能不完整，Chat 列表暂不可用；状态以可读取的官方实时数据为准。';

// Coalesce live reads and back off a failing tool. Never retain task rows or
// use an index record to authorize an operation or infer running/unread state.
export async function readThreadList(bridge, limit = 50, options = {}, { indexRead = readOfficialThreadIndex, now = Date.now } = {}) {
  bridge.requireConnection();
  limit = Math.max(0, Math.min(50, limit));
  const desktop = bridge.desktop, identity = desktop.identity, home = bridge.officialDataHome();
  const check = () => {
    bridge.requireConnection();
    if (desktop !== bridge.desktop || identity !== desktop.identity || home !== bridge.officialDataHome())
      throw Error('列表读取期间官方连接已变化，请重新读取');
  };
  let slot = slots.get(bridge);
  if (!slot || slot.desktop !== desktop || slot.identity !== identity || slot.home !== home || slot.limit !== limit) {
    slot = { desktop, identity, home, limit, pending: null, failedUntil: 0, error: null };
    slots.set(bridge, slot);
  }
  const index = Promise.resolve().then(() => indexRead(home)).catch(() => ({status:'unavailable',threads:[]}));
  if (!slot.pending && now() >= slot.failedUntil) {
    const timeoutMs = Math.min(THREAD_LIST_TIMEOUT_MS, Math.max(1, options.timeoutMs ?? THREAD_LIST_TIMEOUT_MS));
    slot.pending = Promise.resolve().then(() => desktop.call(TOOLS.listThreads, {limit}, undefined, {timeoutMs}))
      .then(data => {
        check();
        if (!Array.isArray(data?.threads) || data.pinnedThreads != null && !Array.isArray(data.pinnedThreads)) throw Error('官方会话列表返回结构无法识别');
        slot.failedUntil = 0; slot.error = null; return {data};
      }).catch(error => {
        check();
        slot.error = error; slot.failedAt = now(); slot.failedUntil = slot.failedAt + retryDelay; return {error};
      }).finally(() => { slot.pending = null; });
  }
  const [live, snapshot] = await Promise.all([slot.pending ?? {error:slot.error}, index]);
  check();
  const checkedAt = new Date(now()).toISOString();
  if (live.error) {
    if (slots.get(bridge) === slot) bridge.threadListRead = {status:snapshot.status === 'available' ? 'partial' : 'unavailable',checkedAt:new Date(slot.failedAt).toISOString()};
    if (snapshot.status !== 'available') throw live.error;
    const data = supplementOfficialThreads({schemaVersion:4,pinnedThreads:[],threads:[],unavailableSources:['official-desktop-tool'],listAvailability:'partial'}, snapshot, limit);
    return {source:'official-local-index-read-only',observedAt:checkedAt,listNotice:notice,data};
  }
  const data = supplementOfficialThreads(live.data,snapshot,limit);
  if (slots.get(bridge) === slot) bridge.threadListRead = {status:'available',checkedAt};
  return {source:data === live.data ? 'official-desktop-tool-live' : 'official-desktop-tool-live + official-local-index',observedAt:checkedAt,data};
}
