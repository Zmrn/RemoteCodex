import { TOOLS } from './official-protocol.mjs';

const pending = new WeakMap();
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

// Loading uses the official desktop's navigation, never a synthetic prompt or
// an independent executor. A navigation acknowledgement is not a ready owner.
export function activateThread(bridge, id, viewerId, { timeoutMs = 20000, pollMs = 200 } = {}) {
  bridge.guard(id, 'activate');
  bridge.requireConnection();
  bridge.subscriptions.touch(id, viewerId);
  const desktop = bridge.desktop, identity = desktop.identity, ipc = desktop.ipc;
  const generation = bridge.connectionGeneration;
  let tasks = pending.get(bridge);
  if (!tasks) pending.set(bridge, tasks = new Map());
  const existing = tasks.get(id);
  if (existing?.desktop === desktop && existing.identity === identity && existing.ipc === ipc && existing.generation === generation)
    return existing.promise;
  const deadline = Date.now() + timeoutMs;
  const timeout = () => Error('官方会话加载超时；消息没有发送，草稿已保留，可重试加载');
  const check = () => {
    bridge.requireConnection();
    if (bridge.desktop !== desktop || desktop.identity !== identity || desktop.ipc !== ipc || bridge.connectionGeneration !== generation)
      throw Error('官方连接已变化，加载已停止；消息没有发送');
    if (!bridge.subscriptions.has(id)) throw Error('已离开此会话，加载等待已停止');
    if (Date.now() >= deadline) throw timeout();
  };
  const entry = { desktop, identity, ipc, generation };
  const work = async () => {
    const metadata = await bridge.codexThread(id);
    check();
    if (!['notLoaded', 'idle', 'active'].includes(metadata.thread.status?.type))
      throw Error('官方会话状态未知，暂不能激活；草稿已保留');
    if (metadata.thread.status.type === 'notLoaded') {
      await desktop.call(TOOLS.navigate, { threadId: id }, undefined, { timeoutMs: Math.max(1, deadline - Date.now()) });
      check();
    }
    const previous = bridge.live.get(id);
    let owner = null;
    while (true) {
      check();
      if (!owner) {
        try { owner = await bridge.follow(id, undefined, false); }
        catch (e) { check(); if (!/no-client-found/.test(e.message)) throw e; }
        check();
      }
      const live = bridge.live.get(id), state = live?.state;
      if (owner && live && live !== previous && live.owner === owner.handledByClientId &&
          bridge.owners?.get(id) === owner.handledByClientId && state?.id === id) {
        if (state.resumeState === 'resumed' && ['idle', 'active'].includes(state.threadRuntimeStatus?.type))
          return { threadId: id, ready: true, source: 'official-desktop-navigation-and-owner', observedAt: live.at };
        if (['failed', 'error'].includes(state.resumeState)) throw Error('官方会话加载失败；草稿已保留，可重试加载');
      }
      await delay(pollMs);
    }
  };
  let timer;
  entry.promise = Promise.race([work(), new Promise((_, reject) => { timer = setTimeout(() => reject(timeout()), timeoutMs); })])
    .finally(() => { clearTimeout(timer); if (tasks.get(id) === entry) tasks.delete(id); });
  tasks.set(id, entry);
  return entry.promise;
}
