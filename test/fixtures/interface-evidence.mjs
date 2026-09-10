import { OFFICIAL, observeDesktop } from '../../src/official-protocol.mjs';
export const fixtureCatalog = () => Object.values(OFFICIAL.tools).map(s => ({ namespace: OFFICIAL.discovery.toolsNamespace,
  name: s.name, inputSchema: { properties: Object.fromEntries(s.request.map(k => [k, {}])) } }));
export const fixtureProtocols = () => [{ methods: Object.fromEntries(Object.values(OFFICIAL.ipc).map(s => [s.method, s.version])) }];
// Synthetic connection evidence for existing behavior tests. Never used by production.
export function fixtureEvidence(desktop) {
  desktop.identity ??= {};
  desktop.ipc ??= {};
  const existing = desktop.catalog ?? [];
  desktop.catalog = fixtureCatalog().map(tool => {
    const prior = existing.find(t => t.name === tool.name);
    return { ...tool, ...prior, inputSchema: { ...tool.inputSchema, ...prior?.inputSchema,
      properties: { ...tool.inputSchema.properties, ...prior?.inputSchema?.properties } } };
  });
  observeDesktop(desktop, fixtureProtocols());
  return desktop;
}
