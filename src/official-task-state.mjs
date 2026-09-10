import { Pipe } from './transport.mjs';
import { OFFICIAL, EVENTS, protocolBroadcast, protocolRequest, desktopCompatibility } from './official-protocol.mjs';
import { runtimeStatus } from './state.mjs';

export function officialTaskFlags(state, id) {
  if (state?.id !== id) throw Error('Official task identity changed');
  const runtime = runtimeStatus(state), runtimeKnown = runtime.confirmed === true;
  const running = runtimeKnown && ['running', 'waiting-approval', 'waiting-user-input'].includes(runtime.type);
  const readStateKnown = typeof state.hasUnreadTurn === 'boolean';
  return { running, unread: runtimeKnown && !running && readStateKnown && state.hasUnreadTurn,
    runtimeKnown, readStateKnown, unknown: !runtimeKnown || (!running && !readStateKnown), stateSource: 'official-owner-snapshot' };
}

// A separate, short-lived subscriber: never reuses a viewer's old state, never
// marks a task read, and cannot cancel the main viewer's subscriptions.
export class OfficialTaskState {
  constructor(desktop, { pipeFactory = p => new Pipe(p, 'desktop') } = {}) {
    this.desktop = desktop; this.identity = desktop.identity; this.pipeFactory = pipeFactory;
  }
  supported() {
    return OFFICIAL.storage.readState.verifiedVersions.includes(desktopCompatibility(this.identity?.appToolsPipe?.image).detectedVersion);
  }
  async connect() {
    if (!this.supported()) throw Error('Official task state unsupported');
    this.pipe = this.pipeFactory(this.identity.brokerPipe.path);
    await this.pipe.connect();
    if (this.identity !== this.desktop.identity) throw Error('Official connection changed');
  }
  async read(id, timeoutMs = 2500, project = officialTaskFlags) {
    const pipe = this.pipe;
    if (!pipe || this.identity !== this.desktop.identity) throw Error('Official state unavailable');
    const started = Date.now();
    const owner = await protocolRequest(pipe, 'owner', { hostId: OFFICIAL.discovery.hostId, conversationId: id }, { timeoutMs });
    if (typeof owner.handledByClientId !== 'string' || !/^[a-f0-9-]{36}$/i.test(owner.handledByClientId)) throw Error('Official owner unavailable');
    const target = owner.handledByClientId;
    let timer, onFrame, onDisconnect;
    try {
      return await new Promise((resolve, reject) => {
        onFrame = f => {
          if (f.type !== 'broadcast' || f.method !== EVENTS.stream || f.sourceClientId !== target ||
              f.params?.hostId !== OFFICIAL.discovery.hostId || f.params?.conversationId !== id || f.params?.change?.type !== 'snapshot') return;
          try {
            if (this.identity !== this.desktop.identity) throw Error('Official connection changed');
            const state = f.params.change.conversationState;
            if (state?.id !== id) throw Error('Official task identity changed');
            resolve(project(state, id));
          } catch (e) { reject(e); }
        };
        onDisconnect = () => reject(Error('Official state connection interrupted'));
        pipe.on('frame', onFrame); pipe.on('disconnected', onDisconnect);
        timer = setTimeout(() => reject(Error('Official state timed out')), Math.max(1, timeoutMs - (Date.now() - started)));
        protocolBroadcast(pipe, 'following', { hostId: OFFICIAL.discovery.hostId, conversationId: id, following: true }, [target]);
      });
    } finally {
      clearTimeout(timer); pipe.off('frame', onFrame); pipe.off('disconnected', onDisconnect);
      try { protocolBroadcast(pipe, 'following', { hostId: OFFICIAL.discovery.hostId, conversationId: id, following: false }, [target]); } catch {}
    }
  }
  close() { this.pipe?.close(); }
}
