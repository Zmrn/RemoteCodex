import { fixtureProtocols } from "./fixtures/interface-evidence.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import { Desktop, brokerKind } from "../src/desktop.mjs";
import { OFFICIAL, TOOLS, desktopPolicy } from "../src/official-protocol.mjs";

const officialImage = String.raw`C:\Program Files\WindowsApps\OpenAI.Codex_26.903.8094.0_x64__fixture\app\ChatGPT.exe`;
const toolsPath = String.raw`\\.\pipe\codex-browser-use-fixture`;
const brokerPath = String.raw`\\.\pipe\codex-ipc`;
const app = { path: toolsPath, pid: 101, image: officialImage };
const vscode = { path: brokerPath, pid: 202, image: String.raw`D:\Programs\Microsoft VS Code\Code.exe`,
  signature: { status: "Valid", publisherSimpleName: "Microsoft Corporation", productName: "Visual Studio Code", companyName: "Microsoft Corporation", version: "1.136.2" } };
const catalog = [{ namespace: "codex_app", name: "list_threads" }];
function fixture(pipes, options = {}) {
  const clients = [], discoveries = [];
  const desktop = new Desktop("fixture-context", {
    readProtocols: fixtureProtocols,
    discoverPipes: async paths => {
      discoveries.push(paths);
      if (discoveries.length > 1 && options.closedDuringRecheck) clients.at(-1).socket = { destroyed: true };
      return { source: "fixture", pipes: structuredClone(discoveries.length > 1 && options.recheck ? options.recheck : pipes) };
    },
    pipeFactory: (pipe, kind) => {
      const client = { path: pipe, kind, closed: false, calls: [],
        connect: async () => { if (kind === "desktop" && options.brokerFails) throw Error("broker handshake failed"); },
        close: () => { client.closed = true; },
        request: async (method, params, routing) => {
          client.calls.push({ method, params, routing });
          if (method === OFFICIAL.transport.toolsList) return { result: { tools: options.catalog ?? catalog } };
          if (method === OFFICIAL.transport.toolsCall) {
            if (options.invalidToolCall) throw Error('{"code":-32602,"message":"Invalid app tool request"}');
            return { result: { success: true, contentItems: [{ type: 'inputText', text: '{}' }] } };
          }
          return { handledByClientId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee", result: {} };
        },
        broadcast: (...args) => { client.broadcasts = args; },
      };
      clients.push(client); return client;
    },
  });
  return { desktop, clients, discoveries };
}

test("official-hosted and verified VS Code-hosted IPC keep official app-tools identity", async t => {
  for (const broker of [{ path: brokerPath, pid: app.pid, image: officialImage }, vscode]) {
    const { desktop, clients, discoveries } = fixture([broker, app]);
    t.after(() => desktop.close());
    const id = await desktop.connect();
    assert.equal(id.officialPid, app.pid);
    assert.equal(id.appToolsPipe.path, toolsPath);
    assert.equal(id.brokerPipe.pid, broker.pid);
    assert.equal(id.connection.sharedBroker, broker.pid !== app.pid);
    assert.equal(id.connection.brokerKind, broker.pid === app.pid ? "official-desktop" : "vscode");
    assert.equal(id.connection.brokerPid, broker.pid);
    assert.deepEqual(discoveries[1], [toolsPath, brokerPath]);
    assert.equal(clients[0].kind, "tools");
    const call = clients[0].calls.find(c => c.method === OFFICIAL.transport.toolsCall);
    assert.equal(call.params.callerSource, 'codex');
    assert.equal(call.params.tool, TOOLS.listProjects);
    const owner = await desktop.follow("same-official-task");
    assert.equal(owner.handledByClientId, "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee");
    assert.equal(desktop.ipc.calls[0].params.conversationId, "same-official-task");
    assert.deepEqual(desktop.ipc.broadcasts[3], [owner.handledByClientId]);
    assert.ok(desktop.catalog.some(t => t.name === TOOLS.listThreads));
  }
});

test('an invalid app-tool call envelope blocks tool-dependent features while owner IPC remains available', async () => {
  const f = fixture([vscode, app], { invalidToolCall: true, catalog: [
    { namespace: 'codex_app', name: TOOLS.listProjects, inputSchema: { properties: {} } },
    { namespace: 'codex_app', name: TOOLS.listThreads, inputSchema: { properties: { limit: {} } } },
  ] });
  try {
    await f.desktop.connect();
    const policy = desktopPolicy(f.desktop);
    assert.equal(policy.interfaces.listProjects.status, 'mismatch');
    assert.equal(policy.interfaces.listThreads.status, 'mismatch');
    assert.equal(policy.interfaces.owner.status, 'matched');
    assert.equal(policy.features.list.supported, false);
    assert.equal(policy.features.taskState.supported, true);
    await assert.rejects(f.desktop.call(TOOLS.listThreads, { limit: 1 }), /Invalid app tool request/);
  } finally { f.desktop.close(); }
});

test('the verified callerSource is also sent with later app-tool reads', async () => {
  const f = fixture([vscode, app], { catalog: [
    { namespace: 'codex_app', name: TOOLS.listProjects, inputSchema: { properties: {} } },
    { namespace: 'codex_app', name: TOOLS.listThreads, inputSchema: { properties: { limit: {} } } },
  ] });
  try {
    await f.desktop.connect();
    await f.desktop.call(TOOLS.listThreads, { limit: 1 });
    const calls = f.desktop.tools.calls.filter(c => c.method === OFFICIAL.transport.toolsCall);
    assert.equal(calls.length, 2);
    assert.deepEqual(calls.map(c => c.params.callerSource), ['codex', 'codex']);
    assert.equal(calls[1].params.tool, TOOLS.listThreads);
    assert.deepEqual(calls[1].params.arguments, { limit: 1 });
  } finally { f.desktop.close(); }
});

test("untrusted brokers are never connected; verified official app-tools remain available", async () => {
  for (const bad of [
    { ...vscode, signature: undefined },
    ...[{ status: "NotSigned" }, { status: "Unknown" }, { publisherSimpleName: "Example" },
      { productName: "Another product" }, { companyName: "Example" }].map(s => ({ ...vscode, signature: { ...vscode.signature, ...s } })),
    { ...vscode, image: String.raw`C:\Temp\Another.exe` },
    { ...vscode, path: String.raw`\\.\pipe\another-pipe` },
  ]) {
    assert.equal(brokerKind(bad), null);
    const { desktop, clients } = fixture([bad, app]);
    await desktop.connect();
    assert.equal(desktop.ipc, null);
    assert.equal(clients.length, 1); assert.equal(clients[0].kind, 'tools');
    assert.equal(desktop.identity.officialPid, app.pid); desktop.close();
  }
});

test("VS Code broker cannot substitute for missing official app-tools or its catalog", async () => {
  const missing = fixture([vscode, { ...app, image: vscode.image }]);
  await assert.rejects(missing.desktop.connect(), /Official ChatGPT app-tools process unavailable/);
  assert.equal(missing.clients.length, 0);
  for (const tools of [[], [{ namespace: "other", name: "list_threads" }]]) {
    const f = fixture([vscode, app], { catalog: tools });
    await assert.rejects(f.desktop.connect(), /Official app-tools pipe unavailable/);
    assert.ok(f.clients.every(c => c.closed));
    assert.equal(f.desktop.identity, null);
  }
});

test("diagnostic connection can inspect a missing list_threads without a task context or tool call", async () => {
  const tools = [{ namespace: 'codex_app', name: 'get_usage_limits' }];
  const normal = fixture([vscode, app], { catalog: tools });
  await normal.desktop.connect(); normal.desktop.close();
  const f = fixture([vscode, app], { catalog: tools });
  f.desktop.context = null;
  try {
    await f.desktop.connect({ inspectCatalog: true });
    assert.equal(f.desktop.context, null);
    assert.deepEqual(f.desktop.catalog, tools);
    assert.ok(f.clients.flatMap(c => c.calls).every(c => c.method === OFFICIAL.transport.toolsList));
  } finally { f.desktop.close(); }
  assert.ok(f.clients.every(c => c.closed));
});

test("replaced endpoints close all clients and clear trusted state", async () => {
  for (const options of [
    { closedDuringRecheck: true },
    { recheck: [vscode, { ...app, pid: 999 }] },
    { recheck: [{ ...vscode, pid: 999 }, app] },
    { recheck: [{ ...vscode, signature: { status: "Unknown" } }, app] },
  ]) {
    const f = fixture([vscode, app], options);
    await assert.rejects(f.desktop.connect(), /handshake failed|identity changed|disconnected during identity verification/);
    assert.ok(f.clients.every(c => c.closed));
    assert.equal(f.desktop.identity, null);
    assert.deepEqual(f.desktop.catalog, []);
  }
});

test("reconnect re-discovers changed broker and missing owner ACK cannot subscribe", async t => {
  const f = fixture([vscode, app]); t.after(() => f.desktop.close());
  await f.desktop.connect();
  const first = [...f.clients];
  f.desktop.discoverPipes = async () => ({ pipes: [{ path: brokerPath, image: officialImage, pid: app.pid }, app] });
  await f.desktop.connect();
  assert.ok(first.every(c => c.closed));
  assert.equal(f.desktop.identity.connection.sharedBroker, false);
  f.desktop.ipc.request = async () => ({ result: { supportsUntrustedAppInput: true } });
  await assert.rejects(f.desktop.follow("same-official-task"), /owner identity unavailable/);
  assert.equal(f.desktop.ipc.broadcasts, undefined);
});
