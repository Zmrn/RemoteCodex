// Read-only upgrade preflight: no task creation, messages, queue writes or interrupts.
// Only logs version and schema property names; never tool descriptions or user data.
import { Desktop } from "../src/desktop.mjs";
import { OFFICIAL, desktopPolicy } from "../src/official-protocol.mjs";
const desktop = new Desktop();
try {
  await desktop.connect();
  const compatibility = desktopPolicy(desktop);
  const tools = Object.entries(OFFICIAL.tools).map(([key, expected]) => {
    const live = desktop.catalog.find(t => t.namespace === OFFICIAL.discovery.toolsNamespace && t.name === expected.name);
    const properties = Object.keys(live?.inputSchema?.properties ?? {});
    return { key, method: expected.name, available: !!live, declaredFieldsMissing: expected.request.filter(k => !properties.includes(k)) };
  });
  const matched = tools.every(t => t.available && !t.declaredFieldsMissing.length);
  console.log(JSON.stringify({ source: "Win32 pipe identity + official tools/list", connection: desktop.identity.connection, compatibility, tools, catalogMatches: matched,
    ownerIpcWritesTested: false, taskWrites: 0, note: "Interface observations control only dependent features; matching declarations are not live behavior tests." }, null, 2));
  if (!matched) process.exitCode = 1;
} finally { desktop.close(); }
