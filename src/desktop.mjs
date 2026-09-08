import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import { Pipe } from "./transport.mjs";
const exec = promisify(execFile),
  here = path.dirname(fileURLToPath(import.meta.url));
export function localContext(excludeId = null) {
  if (process.env.CODEX_THREAD_ID && process.env.CODEX_THREAD_ID !== excludeId)
    return process.env.CODEX_THREAD_ID;
  // Metadata establishes a local tool context only, never live task status.
  const index = path.join(
    process.env.CODEX_HOME ?? path.join(os.homedir(), ".codex"),
    "session_index.jsonl",
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
export async function discover() {
  const { stdout } = await exec("python", [path.join(here, "win_probe.py")], {
    windowsHide: true,
    maxBuffer: 1024 * 1024,
  });
  return JSON.parse(stdout);
}
export class Desktop {
  constructor(context = null) {
    this.context = context;
    this.tools = null;
    this.ipc = null;
    this.identity = null;
    this.catalog = [];
  }
  async connect() {
    this.context ??= localContext();
    this.identity = await discover();
    const owned = this.identity.pipes.filter(
      (p) =>
        p.image &&
        /\\WindowsApps\\OpenAI\.Codex_[^\\]+\\app\\ChatGPT\.exe$/i.test(
          p.image,
        ),
    );
    const desk = owned.find((p) => p.path.endsWith("codex-ipc"));
    if (!desk) throw Error("Official desktop IPC owner unavailable");
    this.identity.officialPid = desk.pid;
    for (const p of owned.filter(
      (p) => p.pid === desk.pid && !p.path.endsWith("codex-ipc"),
    )) {
      const client = new Pipe(p.path);
      try {
        await client.connect();
        const f = await client.request(
          "tools/list",
          { threadStartKind: "all" },
          { timeoutMs: 1200 },
        );
        if (
          f.result?.tools?.some(
            (t) => t.namespace === "codex_app" && t.name === "list_threads",
          )
        ) {
          this.tools = client;
          this.catalog = f.result.tools;
          this.identity.appToolsPipe = p;
          break;
        }
      } catch {}
      client.close();
    }
    if (!this.tools) throw Error("Official app-tools pipe unavailable");
    this.ipc = new Pipe(desk.path, "desktop");
    await this.ipc.connect();
    return this.identity;
  }
  async call(tool, args = {}, context = this.context) {
    if (
      !this.catalog.some((t) => t.namespace === "codex_app" && t.name === tool)
    )
      throw Error("Unavailable desktop tool " + tool);
    const f = await this.tools.request(
      "tools/call",
      {
        arguments: args,
        callId: "remote-bridge-" + randomUUID(),
        namespace: "codex_app",
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
      "tools/list",
      { threadStartKind: "all" },
      { timeoutMs: 10000 },
    );
    if (!Array.isArray(f.result?.tools))
      throw Error("Official tool catalog unavailable");
    this.catalog = f.result.tools;
    return this.catalog;
  }
  async owner(id) {
    return this.ipc.request(
      "thread-owner-discovery",
      { hostId: "local", conversationId: id },
      { version: 1 },
    );
  }
  async follow(id) {
    const o = await this.owner(id);
    this.ipc.broadcast(
      "thread-stream-following-changed",
      { hostId: "local", conversationId: id, following: true },
      1,
      [o.handledByClientId],
    );
    return o;
  }
  close() {
    this.tools?.close();
    this.ipc?.close();
  }
}
