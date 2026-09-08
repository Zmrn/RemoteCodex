import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID, createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import { Desktop, localContext } from "./desktop.mjs";
import { applyPatches, runtimeStatus, mergeLiveTurnItems } from "./state.mjs";
import { weeklyUsage } from "./usage.mjs";
import { OfficialQueue } from "./queue.mjs";
import { assertProbeTarget, testExcludedThreadIds } from "./probe-safety.mjs";
import { DATA_DIR } from "./runtime.mjs";
import {
  parseModels,
  modelOverrides,
  permissionOverrides,
} from "./settings.mjs";
export const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
export class Bridge extends EventEmitter {
  constructor(dataDir = DATA_DIR) {
    super();
    this.dataDir = dataDir;
    fs.mkdirSync(dataDir, { recursive: true });
    this.stateFile = path.join(dataDir, "bridge-state.json");
    this.db = fs.existsSync(this.stateFile)
      ? JSON.parse(fs.readFileSync(this.stateFile))
      : { tests: {}, requests: {} };
    this.watching = new Set();
    this.live = new Map();
    this.connected = false;
    this.events = [];
    this.seq = 0;
    this.epoch = randomUUID();
    this.recovery = new Set();
    this.queue = new OfficialQueue(this);
  }
  save() {
    const tmp = this.stateFile + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(this.db, null, 2));
    fs.renameSync(tmp, this.stateFile);
  }
  emitEvent(kind, details = {}) {
    const e = {
      id: ++this.seq,
      epoch: this.epoch,
      time: new Date().toISOString(),
      source: "official-desktop-IPC-live",
      kind,
      ...details,
    };
    this.events.push(e);
    if (this.events.length > 500) this.events.shift();
    this.emit("event", e);
    return e;
  }
  async connect() {
    if (this.connected) return this.desktop.identity;
    if (this.connecting) return this.connecting;
    this.connecting = this._connect();
    try {
      return await this.connecting;
    } finally {
      this.connecting = null;
    }
  }
  async _connect() {
    this.desktop?.close();
    this.live.clear();
    this.queue.clear();
    this.owners = new Map();
    const context = Object.keys(this.db.tests)[0] ?? null;
    const desktop = new Desktop(context);
    this.desktop = desktop;
    try {
      await desktop.connect();
    } catch (e) {
      desktop.close();
      throw e;
    }
    this.connected = true;
    desktop.ipc.on("frame", (f) => {
      if (this.desktop === desktop) this.frame(f);
    });
    const lost = (reason) => {
      if (this.desktop === desktop && this.connected) {
        this.connected = false;
        this.emitEvent("connection-interrupted", { reason });
      }
    };
    desktop.ipc.on("disconnected", lost);
    desktop.tools.on("disconnected", lost);
    this.emitEvent("connected", { officialPid: desktop.identity.officialPid });
    for (const id of this.watching) {
      try {
        await this.follow(id);
      } catch (e) {
        this.emitEvent("unknown", { threadId: id, reason: e.message });
      }
    }
    return desktop.identity;
  }
  disconnect() {
    this.connected = false;
    this.queue.clear();
    this.desktop?.close();
    this.emitEvent("connection-interrupted", { reason: "viewer-disconnected" });
  }
  requireConnection() {
    if (!this.connected)
      throw Error(
        "connection-interrupted: reconnect before reading or sending",
      );
  }
  requireSupportedBuild() {
    const image = this.desktop?.identity?.appToolsPipe?.image;
    if (!image || !image.includes("OpenAI.Codex_26.901.6511.0_x64__"))
      throw Error(
        "Unsupported desktop build: read-only until protocol is revalidated",
      );
  }
  guard(id) {
    if (typeof id !== "string" || !/^[a-f0-9-]{36}$/.test(id))
      throw Error("Invalid official task ID");
    this.requireSupportedBuild();
  }
  guardProbe(id) {
    this.guard(id);
    assertProbeTarget({ testThreads: this.db.tests }, id);
  }
  async codexThread(id) {
    this.guard(id);
    this.requireConnection();
    const r = await this.desktop.call("read_thread", {
      threadId: id,
      turnLimit: 1,
    });
    if (r.thread?.id !== id || r.thread.kind !== "codex")
      throw Error("目前仅支持 Codex 会话写入");
    return r;
  }
  async models() {
    this.requireConnection();
    return {
      source: "official-desktop-tools-schema-live",
      observedAt: new Date().toISOString(),
      models: parseModels(await this.desktop.refreshCatalog()),
    };
  }
  async usage() {
    this.requireConnection();
    const desktop = this.desktop;
    const raw = await desktop.call("get_usage_limits", {});
    this.requireConnection();
    if (desktop !== this.desktop)
      throw Error("额度读取期间连接已更换，请重新读取");
    return weeklyUsage(raw);
  }
  async updateSettings(id, key, input) {
    const read = await this.codexThread(id);
    if (
      !input ||
      typeof input !== "object" ||
      Array.isArray(input) ||
      Object.keys(input).some(
        (k) => !["model", "effort", "permissionMode"].includes(k),
      )
    )
      throw Error("Invalid settings");
    if (read.thread.status?.type !== "idle")
      throw Error("请等待会话空闲；尚未加载的会话可先在官方桌面打开");
    const owner = await this.follow(id);
    // Wait only for the owner's live snapshot, never infer settings from history.
    for (
      let i = 0;
      i < 40 && !this.live.get(id)?.state?.latestThreadSettings;
      i++
    )
      await new Promise((r) => setTimeout(r, 100));
    const current = this.live.get(id)?.state?.latestThreadSettings;
    if (!current) throw Error("官方实时设置尚不可用");
    const modelInput = Object.fromEntries(
      ["model", "effort"]
        .filter((k) => input[k] !== undefined)
        .map((k) => [k, input[k]]),
    );
    const settings = {
      ...modelOverrides(modelInput, parseModels(this.desktop.catalog)),
      ...permissionOverrides(input.permissionMode, current, read.thread.cwd),
    };
    if (!Object.keys(settings).length) throw Error("没有选择需要修改的设置");
    return this.once(key, "settings", { id, settings }, async () => {
      const r = await this.desktop.ipc.request(
        "thread-follower-update-thread-settings",
        { conversationId: id, threadSettings: settings },
        {
          version: 1,
          targetClientId: owner.handledByClientId,
          timeoutMs: 30000,
        },
      );
      if (r.handledByClientId !== owner.handledByClientId)
        throw Error("Unexpected settings owner; outcome unknown");
      this.emitEvent("settings-updated", {
        threadId: id,
        ownerClientId: r.handledByClientId,
        requestId: r.requestId,
        fields: Object.keys(settings),
      });
      return {
        threadId: id,
        ownerClientId: r.handledByClientId,
        appliesTo: "next-turn",
        response: r.result,
      };
    });
  }
  frame(f) {
    this.queue.frame(f);
    if (f.type !== "broadcast" || f.method !== "thread-stream-state-changed")
      return;
    const id = f.params?.conversationId;
    if (
      !this.watching.has(id) ||
      !this.connected ||
      f.sourceClientId !== this.owners?.get(id) ||
      f.params.hostId !== "local"
    )
      return;
    const c = f.params.change,
      prev = this.live.get(id);
    try {
      let state;
      if (c.type === "snapshot") state = c.conversationState;
      else if (c.type === "patches" && prev?.revision === c.baseRevision)
        state = applyPatches(prev.state, c.patches);
      else throw Error("stream-revision-gap");
      this.live.set(id, {
        state,
        revision: c.revision,
        owner: f.sourceClientId,
        at: new Date().toISOString(),
      });
      this.emitEvent("thread-state", {
        threadId: id,
        ownerClientId: f.sourceClientId,
        revision: c.revision,
        changeType: c.type,
        status: runtimeStatus(state),
        patchPaths: c.patches?.map((p) => p.path),
      });
    } catch (e) {
      this.live.delete(id);
      this.emitEvent("unknown", { threadId: id, reason: e.message });
      if (!this.recovery.has(id)) {
        this.recovery.add(id);
        this.follow(id)
          .catch(() => {})
          .finally(() => this.recovery.delete(id));
      }
    }
  }
  async follow(id) {
    this.requireConnection();
    this.watching.add(id);
    const o = await this.desktop.owner(id);
    this.owners.set(id, o.handledByClientId);
    this.desktop.ipc.broadcast(
      "thread-stream-following-changed",
      { hostId: "local", conversationId: id, following: true },
      1,
      [o.handledByClientId],
    );
    this.emitEvent("owner-discovered", {
      threadId: id,
      ownerClientId: o.handledByClientId,
      requestId: o.requestId,
    });
    return o;
  }
  async projects() {
    this.requireConnection();
    return {
      source: "official-desktop-tool-live",
      observedAt: new Date().toISOString(),
      data: await this.desktop.call("list_projects"),
    };
  }
  async threads(limit = 50) {
    this.requireConnection();
    return {
      source: "official-desktop-tool-live",
      observedAt: new Date().toISOString(),
      data: await this.desktop.call("list_threads", {
        limit: Math.min(limit, 50),
      }),
    };
  }
  async read(id, cursor) {
    this.requireConnection();
    const data = await this.desktop.call("read_thread", {
      threadId: id,
      turnLimit: 10,
      includeOutputs: true,
      maxOutputCharsPerItem: 12000,
      ...(cursor ? { cursor } : {}),
    });
    if (data.thread?.status?.type === "notLoaded") {
      this.live.delete(id);
      this.owners?.delete(id);
    }
    return {
      source: "official-desktop-tool-read + verified-owner-live-items",
      observedAt: new Date().toISOString(),
      data: mergeLiveTurnItems(data, this.live.get(id)?.state),
      live: this.live.has(id)
        ? {
            ...this.live.get(id),
            status: runtimeStatus(this.live.get(id).state, this.connected),
          }
        : null,
    };
  }
  async once(key, operation, payload, fn) {
    if (typeof key !== "string" || !/^[\w-]{8,100}$/.test(key))
      throw Error("requestId required (8-100 letters/digits/hyphens)");
    const hash = createHash("sha256")
      .update(JSON.stringify({ operation, payload }))
      .digest("hex");
    const old = this.db.requests[key];
    if (old) {
      if (old.hash !== hash)
        throw Error("requestId reused with different content");
      return { deduplicated: true, ...old };
    }
    this.db.requests[key] = {
      hash,
      operation,
      status: "outcome-unknown",
      startedAt: new Date().toISOString(),
    };
    this.save();
    try {
      const result = await fn();
      this.db.requests[key] = {
        ...this.db.requests[key],
        status: "accepted",
        result,
      };
      this.save();
      return this.db.requests[key];
    } catch (e) {
      this.db.requests[key].error = e.message;
      this.save();
      throw e;
    }
  }
  async create(
    key,
    prompt = "只回复：REMOTE_BRIDGE_FIRST_OK。不要使用工具，不要创建或修改任何文件。",
    options = {},
  ) {
    this.requireConnection();
    this.requireSupportedBuild();
    if (typeof prompt !== "string" || !prompt.trim() || prompt.length > 20000)
      throw Error("Invalid message");
    const settings = modelOverrides(options, parseModels(this.desktop.catalog));
    return this.once(key, "create", { prompt, settings }, async () => {
      const name =
        "RemoteBridge-Probe-" +
        new Date().toISOString().replace(/[-:]/g, "").slice(0, 15) +
        "-" +
        randomUUID().slice(0, 6);
      const r = await this.desktop.call("create_thread", {
        title: name,
        prompt,
        ...(settings.model ? { model: settings.model } : {}),
        ...(settings.effort ? { thinking: settings.effort } : {}),
        target: { type: "projectless", directoryName: name },
      });
      if (!r.threadId)
        throw Error("create-outcome-unknown: " + JSON.stringify(r));
      this.db.tests[r.threadId] = {
        title: name,
        createdAt: new Date().toISOString(),
        cwd: r.cwd ?? null,
        outputDirectory: r.projectlessOutputDirectory ?? null,
      };
      this.save();
      this.desktop.context = r.threadId;
      await this.follow(r.threadId).catch(() => {});
      this.emitEvent("created", {
        threadId: r.threadId,
        route: "official-app-tools-pipe",
        result: r,
      });
      return r;
    });
  }
  async send(id, key, prompt) {
    await this.codexThread(id);
    this.requireConnection();
    if (typeof prompt !== "string" || !prompt.trim() || prompt.length > 20000)
      throw Error("Invalid message");
    return this.once(key, "send", { id, prompt }, async () => {
      const owner = await this.desktop.owner(id);
      const r = await this.desktop.call("send_message_to_thread", {
        threadId: id,
        prompt,
      });
      this.emitEvent("sent", {
        threadId: id,
        route: "official-app-tools-pipe -> desktop owner",
        ownerClientId: owner.handledByClientId,
        result: r,
      });
      return r;
    });
  }
  async open(id) {
    this.guard(id);
    this.requireConnection();
    return this.desktop.call("navigate_to_codex_page", { threadId: id });
  }
  async interrupt(id, key, expectedTurnId) {
    this.guardProbe(id);
    this.requireConnection();
    if (typeof expectedTurnId !== "string" || !expectedTurnId)
      throw Error("expectedTurnId required");
    return this.once(key, "interrupt", { id, expectedTurnId }, async () => {
      const owner = await this.follow(id);
      const r = await this.desktop.ipc.request(
        "thread-follower-interrupt-turn",
        { conversationId: id, mode: "user-stop", expectedTurnId },
        {
          version: 4,
          targetClientId: owner.handledByClientId,
          timeoutMs: 30000,
        },
      );
      this.emitEvent("interrupted", {
        threadId: id,
        expectedTurnId,
        requestId: r.requestId,
        ownerClientId: r.handledByClientId,
        result: r.result,
      });
      return r;
    });
  }
  async nativeSend(id, key, prompt, imageDataUrl, options = {}) {
    this.guard(id);
    this.requireConnection();
    if (typeof prompt !== "string" || !prompt.trim() || prompt.length > 20000)
      throw Error("Invalid message");
    if (
      imageDataUrl &&
      !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(imageDataUrl)
    )
      throw Error("Unsupported image");
    if (imageDataUrl?.length > 7 * 1024 * 1024) throw Error("Image too large");
    const settings = modelOverrides(options, parseModels(this.desktop.catalog));
    return this.once(
      key,
      "native-send",
      {
        id,
        prompt,
        settings,
        imageHash: imageDataUrl
          ? createHash("sha256").update(imageDataUrl).digest("hex")
          : null,
      },
      async () => {
        const status = await this.codexThread(id);
        if (status.thread.status.type === "notLoaded") {
          if (imageDataUrl)
            throw Error("此会话尚未加载，请先发送文字或在官方桌面打开后再发图");
          // The desktop tool resumes its own existing task. Choose this route
          // before dispatch; never retry a failed native write through it.
          const r = await this.desktop.call("send_message_to_thread", {
            threadId: id,
            prompt,
            ...(settings.model ? { model: settings.model } : {}),
            ...(settings.effort ? { thinking: settings.effort } : {}),
          });
          this.emitEvent("sent", {
            threadId: id,
            route: "official-app-tools-pipe -> desktop resumes existing task",
            result: r,
          });
          await this.follow(id).catch(() => {});
          return r;
        }
        if (status.thread?.status?.type !== "idle")
          throw Error("Task must be idle for native start; no automatic steer");
        const owner = await this.follow(id);
        const input = [{ type: "text", text: prompt, text_elements: [] }];
        if (imageDataUrl) input.push({ type: "image", url: imageDataUrl });
        const r = await this.desktop.ipc.request(
          "thread-follower-start-turn",
          {
            conversationId: id,
            turnStart: {
              request: {
                threadId: id,
                input,
                clientUserMessageId: key,
                ...settings,
              },
            },
          },
          {
            version: 2,
            targetClientId: owner.handledByClientId,
            timeoutMs: 60000,
          },
        );
        if (r.handledByClientId !== owner.handledByClientId)
          throw Error("Unexpected handler; outcome unknown");
        this.emitEvent("native-sent", {
          threadId: id,
          ownerClientId: r.handledByClientId,
          requestId: r.requestId,
          turnId: r.result?.result?.turn?.id,
        });
        return r;
      },
    );
  }
  async wait(id, timeoutMs = 0) {
    this.requireConnection();
    // The official tool cannot wait on its own calling task. Resolve another
    // local context if needed, without changing concurrent calls' context.
    const context =
      this.desktop.context && this.desktop.context !== id
        ? this.desktop.context
        : localContext(id);
    return this.desktop.call(
      "wait_threads",
      {
        targets: [{ threadId: id, hostId: "local" }],
        timeoutMs: Math.min(timeoutMs, 50000),
      },
      context,
    );
  }
  status() {
    return {
      connected: this.connected,
      source: "official-desktop-IPC-live",
      officialPid: this.desktop?.identity?.officialPid ?? null,
      readOnlyThreadIds: [],
      testExcludedThreadIds: testExcludedThreadIds(),
      // Legacy clients treat these fields as read-only, so keep them empty.
      protectedThreadId: null,
      protectedThreadIds: [],
      existingCodexWritable: true,
      testThreads: this.db.tests,
      epoch: this.epoch,
      sequence: this.seq,
      threads: Object.fromEntries(
        [...this.live].map(([id, s]) => [
          id,
          {
            revision: s.revision,
            status: runtimeStatus(s.state, this.connected),
            owner: s.owner,
          },
        ]),
      ),
    };
  }
}
