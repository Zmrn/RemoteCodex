import { TOOLS } from './official-protocol.mjs';
export async function renameThread(bridge, id, input) {
  const key = input?.requestId;
  try {
    bridge.guard(id); bridge.requireConnection();
    if (!input || Object.keys(input).some(k => !['requestId', 'title', 'expectedTitle'].includes(k)) ||
        typeof input.title !== 'string' || !input.title.trim() || input.title.trim().length > 200 || /[\r\n\x00-\x1f]/.test(input.title) ||
        !(input.expectedTitle === null || typeof input.expectedTitle === 'string') || !/^[\w-]{8,100}$/.test(key ?? ''))
      throw Error('请输入 1–200 字的单行会话名');
    const title = input.title.trim();
    return await bridge.once(key, 'rename-thread', { id, title, expectedTitle: input.expectedTitle }, async dispatch => {
      const desktop = bridge.desktop;
      const read = await bridge.codexThread(id);
      if ((read.thread.title ?? null) !== input.expectedTitle) throw Error('官方会话名已变化，请刷新列表后重新修改');
      bridge.requireConnection();
      if (bridge.desktop !== desktop) throw Error('目标连接已变化，改名未发送');
      dispatch();
      const result = await desktop.call(TOOLS.setTitle, { threadId: id, title });
      if (desktop !== bridge.desktop || !bridge.connected || result.threadId !== id || result.title !== title)
        throw Error('改名回执未确认，请刷新官方列表核对，不要重复提交');
      bridge.emitEvent('thread-title-submitted', { threadId: id });
      return { threadId: id, submitted: true };
    }, { deferredDispatch: true });
  } catch (error) {
    const record = bridge.db.requests[key];
    return { status: !record || ['preparing', 'rejected'].includes(record.status) ? 'not-sent' : 'outcome-unknown', error: error.message };
  }
}
