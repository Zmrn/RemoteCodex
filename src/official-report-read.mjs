import { OFFICIAL, TOOLS, protocolBroadcast } from './official-protocol.mjs';
import { OfficialReadState } from './official-read-state.mjs';
import { reportReceipt } from './task-reports.mjs';
import { mergeLiveTurnItems, runtimeStatus } from './state.mjs';

// User-triggered receipt synchronization only. No disk writes, task messages,
// UI automation, automatic reconnection or replay of an uncertain notification.
export async function markOfficialReportRead(bridge, id, token, { reader = new OfficialReadState(bridge.desktop),
  sleep = ms => new Promise(resolve => setTimeout(resolve, ms)), attempts = 20 } = {}) {
  const desktop = bridge.desktop;
  const current = () => { bridge.requireConnection(); if (desktop !== bridge.desktop) throw Error('Connection changed'); };
  let dispatched = false;
  try {
    current();
    if (!reader.supported()) return { status: 'unsupported' };
    const context = await reader.context(); current();
    if (!context) return { status: 'unavailable' };
    const marked = await reader.marked(context, id); current();
    if (marked === null) return { status: 'unavailable' };
    if (!marked) return { status: 'already-read' };
    const owner = await desktop.owner(id); current();
    const data = await desktop.call(TOOLS.readThread, { threadId: id, hostId: OFFICIAL.discovery.hostId,
      turnLimit: 1, includeOutputs: false, maxOutputCharsPerItem: 0 }, undefined, { timeoutMs: 4000 });
    current();
    if (data.thread?.id !== id || data.thread?.kind !== 'codex' || data.thread?.status?.type !== 'idle' || reportReceipt(data)?.token !== token)
      return { status: 'report-changed' };
    const matches = () => {
      current();
      const live = bridge.live?.get(id);
      return live?.owner === owner.handledByClientId && live.state?.id === id &&
        runtimeStatus(live.state).type === 'completed' && reportReceipt(mergeLiveTurnItems(data, live.state))?.token === token;
    };
    // Check the current stream immediately before dispatch. There is no await
    // between this guard and the notification. The official receiver separately
    // checks its active account and execution host. Its protocol has no turn CAS.
    if (!matches()) return { status: 'unavailable' };
    protocolBroadcast(desktop.ipc, 'readStateChanged', { hostId: OFFICIAL.discovery.hostId, conversationId: id,
      hasUnreadTurn: false, context: { identity: context.identity, executionHostKey: context.executionHostKey } });
    dispatched = true;
    for (let i = 0; i < attempts; i++) {
      await sleep(150); current();
      if (!matches()) return { status: 'unconfirmed' };
      if (await reader.marked(context, id) === false) return { status: matches() ? 'synced' : 'unconfirmed' };
    }
    return { status: 'unconfirmed' };
  } catch { return { status: dispatched ? 'unconfirmed' : 'unavailable' }; }
}
