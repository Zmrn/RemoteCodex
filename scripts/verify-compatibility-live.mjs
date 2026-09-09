// Read-only upgrade preflight: no task creation, messages, queue writes or interrupts.
// Only logs version and schema property names; never tool descriptions or user data.
import { Desktop } from "../src/desktop.mjs";
import { OFFICIAL, desktopCompatibility } from "../src/official-protocol.mjs";
const desktop = new Desktop();
try {
  await desktop.connect();
  const compatibility = desktopCompatibility(desktop.identity.appToolsPipe?.image);
  const tools = Object.entries(OFFICIAL.tools).map(([key, expected]) => {
    const live = desktop.catalog.find(t => t.namespace === OFFICIAL.discovery.toolsNamespace && t.name === expected.name);
    const properties = Object.keys(live?.inputSchema?.properties ?? {});
    return { key, method: expected.name, available: !!live, declaredFieldsMissing: expected.request.filter(k => !properties.includes(k)) };
  });
  const matched = tools.every(t => t.available && !t.declaredFieldsMissing.length);
  console.log(JSON.stringify({ source: "Win32 pipe identity + official tools/list", connection: desktop.identity.connection, compatibility, tools, catalogMatches: matched,
    ownerIpcWritesTested: false, taskWrites: 0, note: "Schema names alone never validate owner IPC writes or automatically authorize a new version." }, null, 2));
  if (!matched) process.exitCode = 1;
} finally { desktop.close(); }
