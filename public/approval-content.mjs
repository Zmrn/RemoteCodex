// Pure presentation of the narrow browser-origin approval shape we support.
// Other MCP forms may carry data or different consent scopes; never auto-accept them.
export function browserApproval(params) {
  if (params?.mode !== 'form' || params.requestedSchema?.type !== 'object' ||
      !params.requestedSchema.properties || typeof params.requestedSchema.properties !== 'object' || Array.isArray(params.requestedSchema.properties) ||
      Object.keys(params.requestedSchema.properties).length ||
      (params.requestedSchema.required != null && (!Array.isArray(params.requestedSchema.required) || params.requestedSchema.required.length))) return null;
  if (Object.keys(params.requestedSchema).some(k => !['type', 'properties', 'required', 'additionalProperties', 'title', 'description', '$schema'].includes(k))) return null;
  const meta = params._meta;
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) return null;
  const named = ['cua_repl', 'node_repl'].includes(params.serverName) &&
    meta.codex_approval_kind === 'mcp_tool_call' && meta.connector_id === 'browser-use' && meta.tool_name === 'access_browser_origin';
  const legacy = ['browser', 'browser-use'].includes(params.serverName) &&
    (meta.codex_approval_kind == null || meta.codex_approval_kind === 'mcp_tool_call') &&
    (typeof meta.persist === 'string' || Array.isArray(meta.persist));
  if (!named && !legacy) return null;
  const raw = meta.origin ?? meta.tool_params?.origin;
  if (typeof raw !== 'string' || raw.length > 2048) return null;
  let origin;
  try {
    const url = new URL(raw);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password ||
        (url.pathname !== '/' && url.pathname !== '') || url.search || url.hash) return null;
    origin = url.origin;
    if (meta.origin && meta.tool_params?.origin) {
      const other = new URL(meta.tool_params.origin);
      if (other.origin !== origin || other.username || other.password || other.pathname !== '/' || other.search || other.hash) return null;
    }
  } catch { return null; }
  const persist = Array.isArray(meta.persist) ? meta.persist : [meta.persist];
  return { origin, message: typeof params.message === 'string' ? params.message.slice(0, 4000) : '',
    reason: String(meta.reason ?? meta.tool_params?.reason ?? '').slice(0, 2000),
    decisions: ['deny', 'once', ...(persist.includes('session') ? ['session'] : []), ...(persist.includes('always') ? ['site'] : [])] };
}

// Only the official command string is approvable; parsed actions or a prefix
// alone cannot stand in for the complete command the user is authorizing.
export function commandApproval(params) {
  if (typeof params?.command !== 'string' || !params.command.trim() || params.command.length > 65536 ||
      typeof params.itemId !== 'string' || !params.itemId || typeof params.turnId !== 'string' || !params.turnId ||
      params.networkApprovalContext != null || params.availableDecisions != null ||
      (params.reason != null && (typeof params.reason !== 'string' || params.reason.length > 8000)) ||
      (params.cwd != null && (typeof params.cwd !== 'string' || params.cwd.length > 8000))) return null;
  const proposed = params.proposedExecpolicyAmendment;
  const prefix = Array.isArray(proposed) && proposed.length > 0 && proposed.length <= 128 &&
    proposed.every(p => typeof p === 'string' && p.length > 0 && p.length <= 4096 && !/[\r\n\0]/.test(p)) &&
    proposed.join(' ').length <= 16384 ? [...proposed] : null;
  return { command: params.command, cwd: params.cwd ?? '', reason: params.reason ?? '',
    prefix, decisions: ['deny', 'once', ...(prefix ? ['prefix'] : [])] };
}

export const approvalLabels = { deny: '拒绝', once: '允许一次', session: '本会话允许', site: '始终允许此网站', prefix: '允许类似命令' };
