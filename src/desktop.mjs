import { OFFICIAL, TOOLS, protocolRequest, protocolBroadcast } from "./official-protocol.mjs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import { Pipe } from "./transport.mjs";
import { PYTHON } from "./runtime.mjs";
const exec = promisify(execFile),
  here = path.dirname(fileURLToPath(import.meta.url));
export function localContext(excludeId = null) {
  if (process.env.CODEX_THREAD_ID && process.env.CODEX_THREAD_ID !== excludeId)
    return process.env.CODEX_THREAD_ID;
  // Metadata establishes a local tool context only, never live task status.
  const index = path.join(
    process.env.CODEX_HOME ?? path.join(os.homedir(), ".codex"),
    OFFICIAL.storage.sessionIndexFile,
  );
  try {
    const fd = fs.openSync(index, "r");
    let text;
    try {
      const size = fs.fstatSync(fd).size,
        b = Buffer.alloc(Math.min(size, 65536));
      fs.readSync(fd, b, 0, b.length, size - b.length);
      text = b.toString();
    } finally {
      fs.closeSync(fd);
    }
    for (const line of text.trim().split("\n").reverse()) {
      try {
        const id = JSON.parse(line).id;
        if (/^[a-f0-9-]{36}$/.test(id) && id !== excludeId) return id;
      } catch {}
    }
  } catch {}
  throw Error(
    "本机没有可用的其他 Codex 任务上下文；请先在官方桌面创建一个任务",
  );
}
export async function discover(paths = []) {
  const { stdout } = await exec(PYTHON, [path.join(here, "win_probe.py"), ...paths], {
    windowsHide: true,
    maxBuffer: 1024 * 1024,
    timeout: 25000,
  });
  return JSON.parse(stdout);
}
const pipeName = p => path.win32.basename(p.path ?? "");
const officialImage = p => !!p.pid && new RegExp(OFFICIAL.discovery.ownerImagePattern, "i").test(p.image ?? "");
export function brokerKind(pipe) {
  if (!pipe?.pid || pipeName(pipe) !== OFFICIAL.discovery.ownerPipe) return null;
  if (officialImage(pipe)) return "official-desktop";
  const spec = OFFICIAL.discovery.sharedBroker, signature = pipe.signature;
  if (path.win32.basename(pipe.image ?? "").toLowerCase() === spec.executable.toLowerCase() &&
      signature?.status === spec.signatureStatus &&
      signature.publisherSimpleName === spec.publisherSimpleName &&
      signature.productName === spec.productName && signature.companyName === spec.companyName)
    return spec.kind;
  return null;
}
export class Desktop {
  constructor(context = null, { discoverPipes = discover, pipeFactory = (p, kind) => new Pipe(p, kind) } = {}) {
    this.context = context;
    this.discoverPipes = discoverPipes;
    this.pipeFactory = pipeFactory;
    this.tools = null;
    this.ipc = null;
    this.identity = null;
    this.catalog = [];
  }
  async connect() {
    this.close();
    this.tools = this.ipc = this.identity = null;
    this.catalog = [];
    this.context ??= localContext();
    const identity = await this.discoverPipes();
    const owned = identity.pipes.filter(p => officialImage(p) && pipeName(p).startsWith(OFFICIAL.discovery.toolsPipePrefix));
    if (!owned.length) throw Error("Official ChatGPT app-tools process unavailable");
    const broker = identity.pipes.find(p => pipeName(p) === OFFICIAL.discovery.ownerPipe);
    const kind = brokerKind(broker);
    if (!kind) throw Error("Trusted desktop IPC broker unavailable (requires official ChatGPT or verified Microsoft VS Code)");
    try {
      for (const p of owned) {
        const client = this.pipeFactory(p.path, "tools");
        try {
          await client.connect();
          const f = await client.request(
            OFFICIAL.transport.toolsList,
            OFFICIAL.transport.toolsListParams,
            { timeoutMs: 5000 },
          );
          if (
            f.result?.tools?.some(
              (t) => t.namespace === OFFICIAL.discovery.toolsNamespace && t.name === TOOLS.listThreads,
            )
          ) {
            this.tools = client;
            this.catalog = f.result.tools;
            identity.appToolsPipe = p;
            identity.officialPid = p.pid;
            break;
          }
        } catch {}
        client.close();
      }
      if (!this.tools) throw Error("Official app-tools pipe unavailable");
      this.ipc = this.pipeFactory(broker.path, "desktop");
      await this.ipc.connect();
      // Re-discover both endpoints after the handshake. If a process/pipe was
      // replaced, discard the connection; the normal reconnect loop starts fresh.
      const confirmed = await this.discoverPipes([identity.appToolsPipe.path, broker.path]);
      for (const expected of [identity.appToolsPipe, broker]) {
        const actual = confirmed.pipes.find(p => p.path === expected.path);
        if (actual?.pid !== expected.pid || actual.image !== expected.image ||
            (expected === broker && brokerKind(actual) !== kind))
          throw Error("Desktop pipe identity changed during connection; reconnect required");
      }
      if (this.tools.socket?.destroyed || this.ipc.socket?.destroyed)
        throw Error("Desktop pipe disconnected during identity verification; reconnect required");
      identity.brokerPipe = broker;
      identity.connection = { source: "Win32 pipe identity and live tools/list", officialPid: identity.officialPid,
        brokerPid: broker.pid, brokerKind: kind, sharedBroker: broker.pid !== identity.officialPid,
        brokerVersion: broker.signature?.version ?? null };
      this.identity = identity;
      return this.identity;
    } catch (error) {
      this.close();
      this.tools = this.ipc = this.identity = null;
      this.catalog = [];
      throw error;
    }
  }
  async call(tool, args = {}, context = this.context) {
    if (
      !this.catalog.some((t) => t.namespace === OFFICIAL.discovery.toolsNamespace && t.name === tool)
    )
      throw Error("Unavailable desktop tool " + tool);
    const f = await this.tools.request(
      OFFICIAL.transport.toolsCall,
      {
        arguments: args,
        callId: "remote-bridge-" + randomUUID(),
        namespace: OFFICIAL.discovery.toolsNamespace,
        threadId: context,
        tool,
        turnId: "remote-bridge-request-" + randomUUID(),
      },
      { timeoutMs: 60000 },
    );
    const r = f.result;
    if (!r?.success)
      throw Error(
        r?.contentItems
          ?.filter((x) => x.type === "inputText")
          .map((x) => x.text)
          .join("\n") || "Desktop tool failed",
      );
    const text = r.contentItems
      .filter((x) => x.type === "inputText")
      .map((x) => x.text)
      .join("\n");
    try {
      return JSON.parse(text);
    } catch {
      return { text };
    }
  }
  async refreshCatalog() {
    const f = await this.tools.request(
      OFFICIAL.transport.toolsList,
      OFFICIAL.transport.toolsListParams,
      { timeoutMs: 10000 },
    );
    if (!Array.isArray(f.result?.tools))
      throw Error("Official tool catalog unavailable");
    this.catalog = f.result.tools;
    return this.catalog;
  }
  async owner(id) {
    const result = await protocolRequest(this.ipc, "owner",
      { hostId: OFFICIAL.discovery.hostId, conversationId: id },
      {},
    );
    // The broker PID is not the task owner. Only this routed client ID is used
    // for follow and mutations; capability flags are not process identity proof.
    if (typeof result.handledByClientId !== "string" || !/^[a-f0-9-]{36}$/i.test(result.handledByClientId))
      throw Error("Desktop task owner identity unavailable");
    return result;
  }
  async follow(id) {
    const o = await this.owner(id);
    protocolBroadcast(this.ipc, "following",
      { hostId: OFFICIAL.discovery.hostId, conversationId: id, following: true },
      [o.handledByClientId],
    );
    return o;
  }
  close() {
    this.tools?.close();
    this.ipc?.close();
  }
}
