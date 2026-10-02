// Read-only upgrade preflight. No task creation, messages, queue writes or interrupts.
// Only logs versions, interface evidence and response shape; never user/account data.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Desktop } from '../src/desktop.mjs';
import { OFFICIAL, TOOLS, desktopPolicy } from '../src/official-protocol.mjs';
import { isUsageResponse } from '../src/usage.mjs';

export function preflightReport(desktop, usageRead) {
  const compatibility = desktopPolicy(desktop);
  const tools = Object.entries(OFFICIAL.tools).map(([key, expected]) => {
    const live = desktop.catalog.find(t => t.namespace === OFFICIAL.discovery.toolsNamespace && t.name === expected.name);
    const properties = Object.keys(live?.inputSchema?.properties ?? {});
    return { key, method: expected.name, available: !!live,
      declaredFieldsMissing: expected.request.filter(k => !properties.includes(k)),
      observed: compatibility.interfaces[key]?.status ?? 'unknown' };
  });
  return { source: 'Win32 pipe identity + official tools/list + read-only list_projects and quota query',
    connection: desktop.identity.connection, compatibility, tools,
    catalogMatches: tools.every(t => t.available && !t.declaredFieldsMissing.length),
    toolInterfacesMatch: tools.every(t => t.observed === 'matched'),
    toolCall: desktop.toolCallObservation, quotaProbe: desktop.usageObservation, usageRead,
    ownerIpcWritesTested: false, taskWrites: 0,
    note: 'A missing quota catalog entry needs a valid live read. Matching other declarations is not a live behavior test.' };
}

export async function verifyLive(desktop = new Desktop()) {
  try {
    await desktop.connect();
    let usageRead;
    try {
      const value = await desktop.call(TOOLS.usage, {});
      usageRead = { matched: isUsageResponse(value),
        fields: ['rateLimits', 'rateLimitsByLimitId'].filter(key => Object.hasOwn(value, key)) };
    } catch { usageRead = { matched: false, detail: '只读额度查询未获确认' }; }
    return preflightReport(desktop, usageRead);
  } finally { desktop.close(); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const report = await verifyLive();
  console.log(JSON.stringify(report, null, 2));
  if (!report.toolInterfacesMatch || report.toolCall?.status !== 'matched' || !report.usageRead.matched) process.exitCode = 1;
}
