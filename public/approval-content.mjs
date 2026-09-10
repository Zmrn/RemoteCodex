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

export const approvalLabels = { deny: '拒绝', once: '允许一次', session: '本会话允许', site: '始终允许此网站' };
