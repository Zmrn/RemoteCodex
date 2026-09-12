import { createHash } from 'node:crypto';
import { OFFICIAL, EVENTS, protocolRequest } from './official-protocol.mjs';
import { browserApproval, commandApproval } from '../public/approval-content.mjs';

const canonical = v => Array.isArray(v) ? '[' + v.map(canonical).join(',') + ']'
  : v && typeof v === 'object' ? '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + canonical(v[k])).join(',') + '}' : JSON.stringify(v);
const digest = v => createHash('sha256').update(canonical(v)).digest('hex');
export function approvalView(request, threadId) {
  if (![EVENTS.mcpElicitation, EVENTS.commandApproval].includes(request?.method) || request.completed === true || request.params?.threadId !== threadId ||
      !['string', 'number'].includes(typeof request.id)) return null;
  const kind = request.method === EVENTS.commandApproval ? 'command' : 'browser';
  const parsed = kind === 'command' ? commandApproval(request.params) : browserApproval(request.params);
  return { requestId: String(request.id), turnId: request.params.turnId ?? null, token: digest(request),
    kind, supported: !!parsed, ...(parsed ?? { message: String(request.params.message ?? request.params.reason ?? '此请求需要在官方应用处理').slice(0, 4000), decisions: [] }) };
}
// Keep command requests out of the legacy browser-only field: older clients
// cannot show the command and must never offer a blind approval button.
export const pendingApprovals = (state, kind = 'browser') => (state?.requests ?? []).map(r => approvalView(r, state.id)).filter(v => v?.kind === kind);
export function approvalResponse(view, decision) {
  if (!view?.supported || !view.decisions.includes(decision)) throw Error('此授权选项不受支持，请在官方应用处理');
  if (view.kind === 'command') return decision === 'deny' ? 'decline' : decision === 'once' ? 'accept'
    : { acceptWithExecpolicyAmendment: { execpolicy_amendment: [...view.prefix] } };
  return decision === 'deny' ? { action: 'decline', content: null, _meta: null }
    : { action: 'accept', content: {}, _meta: decision === 'once' ? null : { persist: decision === 'site' ? 'always' : 'session' } };
}

export async function answerApproval(bridge, id, key, input) {
  let operationKey;
  try {
    bridge.guard(id, "read"); bridge.requireConnection();
    if (!/^[\w-]{8,100}$/.test(key ?? '') || typeof input?.approvalRequestId !== 'string' || input.approvalRequestId.length > 250 ||
        !/^[a-f0-9]{64}$/.test(input.token ?? '') || !['deny', 'once', 'session', 'site', 'prefix'].includes(input.decision) ||
        Object.keys(input).some(k => !['requestId', 'approvalRequestId', 'token', 'decision'].includes(k)))
      throw Error('无效的授权请求，请刷新后重试');
    // Bind uncertainty to the official request, across devices and client request IDs.
    // This stores dispatch protection only, never the official approval state.
    operationKey = 'approval-' + digest([id, input.approvalRequestId, input.token]);
    // Retain the original operation name/hash so pending browser submissions
    // keep their cross-version dispatch protection.
    return await bridge.once(operationKey, 'browser-approval', { id, approvalRequestId: input.approvalRequestId, token: input.token }, async dispatch => {
      const desktop = bridge.desktop;
      await bridge.codexThread(id);
      const previous = bridge.live.get(id), owner = await bridge.follow(id);
      for (let i = 0; i < 40 && bridge.live.get(id) === previous; i++) await new Promise(r => setTimeout(r, 100));
      bridge.requireConnection();
      const live = bridge.live.get(id);
      if (desktop !== bridge.desktop || !live || live === previous || live.owner !== owner.handledByClientId || live.state?.id !== id)
        throw Error('尚未取得当前官方授权请求，请刷新后重试');
      const matches = (live.state.requests ?? []).filter(r => String(r.id) === input.approvalRequestId && approvalView(r, id)?.token === input.token);
      const request = matches.length === 1 ? matches[0] : null;
      const view = approvalView(request, id);
      if (!view || view.token !== input.token) throw Error('此授权请求已结束或内容已变化，请刷新');
      const protocol = view.kind === 'command' ? 'commandApproval' : 'mcpElicitation';
      bridge.guard(id, view.kind === 'command' ? 'commandApproval' : 'browserApproval');
      const response = approvalResponse(view, input.decision);
      // No async gap between final official snapshot check and dispatch.
      dispatch();
      const result = await protocolRequest(desktop.ipc, protocol, { conversationId: id, requestId: request.id,
        ...(view.kind === 'command' ? { decision: response } : { response }) },
        { targetClientId: owner.handledByClientId, timeoutMs: 30000 })
        .catch(() => { throw Error('官方授权发送结果未知，请刷新核对或在官方应用处理，不要重复提交'); });
      if (desktop !== bridge.desktop || !bridge.connected || result.handledByClientId !== owner.handledByClientId || result.result?.result?.ok !== true ||
          view.kind === 'command' && result.result?.method !== OFFICIAL.ipc.commandApproval.method)
        throw Error('授权回执未确认，结果未知；请刷新官方状态，不要重复提交');
      bridge.emitEvent('approval-submitted', { threadId: id });
      return { threadId: id, submitted: true, decision: input.decision };
    }, { deferredDispatch: true });
  } catch (error) {
    const record = operationKey && bridge.db.requests[operationKey];
    return { status: !record || ['preparing', 'rejected'].includes(record.status) ? 'not-sent' : 'outcome-unknown',
      error: error.message };
  }
}
