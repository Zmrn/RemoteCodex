import { OFFICIAL, protocolBroadcast } from './official-protocol.mjs';
import { OfficialReadState } from './official-read-state.mjs';
import { readCodexThreadMetadata } from './thread-metadata.mjs';
import { ownerReport } from './visible-report.mjs';

// User-triggered receipt synchronization only. No disk writes, task messages,
// UI automation, automatic reconnection or replay of an uncertain notification.
export async function markOfficialReportRead(bridge, id, token, { reader = new OfficialReadState(bridge.desktop),
  sleep = ms => new Promise(resolve => setTimeout(resolve, ms)), attempts = 20, snapshotAttempts = 40 } = {}) {
  const desktop = bridge.desktop, identity = desktop.identity;
  const current = () => { bridge.requireConnection(); if (desktop !== bridge.desktop || identity !== desktop.identity) throw Error('Connection changed'); };
  let dispatched = false;
  const result = status => ({ status, retryable: !dispatched && ['unavailable', 'report-changed'].includes(status) });
  try {
    current();
    if (!reader.supported()) return result('unsupported');
    const context = await reader.context(); current();
    if (!context) return result('unavailable');
    const marked = await reader.marked(context, id); current();
    if (marked === null) return result('unavailable');
    if (!marked) return result('already-read');
    const {thread} = await readCodexThreadMetadata(desktop,id,current);
    const previous = bridge.live?.get(id), owner = await bridge.follow(id); current();
    for(let i=0;i<snapshotAttempts && bridge.live?.get(id)===previous;i++) { await sleep(100); current(); }
    current();
    const matches = () => {
      current();
      const live = bridge.live?.get(id);
      return live && live!==previous && live.owner === owner.handledByClientId &&
        ownerReport(thread,live.state)?.receipt.token === token;
    };
    // Check the current stream immediately before dispatch. There is no await
    // between this guard and the notification. The official receiver separately
    // checks its active account and execution host. Its protocol has no turn CAS.
    if (!matches()) return result('unavailable');
    // A throwing transport may already have written the notification. From
    // this point onward, every uncertain result must remain non-retryable.
    dispatched = true;
    protocolBroadcast(desktop.ipc, 'readStateChanged', { hostId: OFFICIAL.discovery.hostId, conversationId: id,
      hasUnreadTurn: false, context: { identity: context.identity, executionHostKey: context.executionHostKey } });
    for (let i = 0; i < attempts; i++) {
      await sleep(150); current();
      if (!matches()) return result('unconfirmed');
      if (await reader.marked(context, id) === false) return result(matches() ? 'synced' : 'unconfirmed');
    }
    return result('unconfirmed');
  } catch { return result(dispatched ? 'unconfirmed' : 'unavailable'); }
}
