import { OFFICIAL, TOOLS, EVENTS, assertSupportedBuild, supportedBuild, desktopCompatibility, protocolRequest, protocolBroadcast } from "./official-protocol.mjs";
import { validateImageUrls, IMAGE_LIMITS } from "../public/image-input.mjs";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID, createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import { Desktop, localContext } from "./desktop.mjs";
import { applyPatches, runtimeStatus, mergeLiveTurnItems, activeTurnId } from "./state.mjs";
import { accountUsage } from "./usage.mjs";
import { OfficialQueue, composeQueuedMessage } from "./queue.mjs";
import { assertProbeTarget, testExcludedThreadIds } from "./probe-safety.mjs";
import { DATA_DIR } from "./runtime.mjs";
import { MessageMedia } from "./message-media.mjs";
import { SubscriptionLeases } from "./subscriptions.mjs";
import { Reconnector } from "../public/reconnect.mjs";
import {
  ConversationPages,
  compactConversation,
} from "./conversation-pages.mjs";
import { withServiceTiers, tierOverride } from "./service-tiers.mjs";
import { projectSelection, savedProjectTarget } from "./project-target.mjs";
import {
  asyncQuestions,
  questionReply,
  itemText,
} from "../public/message-content.mjs";
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
  constructor(
    dataDir = DATA_DIR,
    { desktopFactory = (context) => new Desktop(context), retryDelays } = {},
  ) {
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
    this.media = new MessageMedia();
    this.pages = new ConversationPages();
    this.desktopFactory = desktopFactory;
    this.retryDelays = retryDelays;
    this.connectionGeneration = 0;
    this.subscriptions = new SubscriptionLeases(id => this.releaseSubscription(id));
    this.subscriptionTimer = setInterval(() => this.subscriptions.prune(), 15000);
    this.subscriptionTimer.unref();
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
    if (!this.reconnector?.enabled)
      this.reconnector = new Reconnector(() => this.connect(), {
        delays: this.retryDelays,
      });
    if (this.connected) return this.desktop.identity;
    if (this.connecting) return this.connecting;
    const generation = this.connectionGeneration;
    const pending = this._connect(generation);
    this.connecting = pending;
    try {
      return await pending;
    } catch (e) {
      if (generation === this.connectionGeneration) this.reconnector.request();
      throw e;
    } finally {
      if (this.connecting === pending) this.connecting = null;
    }
  }
  async _connect(generation) {
    this.desktop?.close();
    this.live.clear();
    this.queue.clear();
    this.owners = new Map();
    const context = Object.keys(this.db.tests)[0] ?? null;
    const desktop = this.desktopFactory(context);
    this.desktop = desktop;
    try {
      await desktop.connect();
      if (generation !== this.connectionGeneration || this.desktop !== desktop)
        throw Error("Viewer connection cancelled");
    } catch (e) {
      desktop.close();
      throw e;
    }
    this.connected = true;
    this.reconnector.healthy();
    desktop.ipc.on("frame", (f) => {
      if (this.desktop === desktop) this.frame(f);
    });
    const lost = (reason) => {
      if (this.desktop === desktop && this.connected) {
        this.connected = false;
        this.emitEvent("connection-interrupted", { reason });
        this.reconnector.request();
      }
    };
    desktop.ipc.on("disconnected", lost);
    desktop.tools.on("disconnected", lost);
    this.emitEvent("connected", { officialPid: desktop.identity.officialPid });
    for (const id of this.watching) {
      if (generation !== this.connectionGeneration || !this.connected) break;
      try {
        await this.follow(id, undefined, false);
      } catch (e) {
        this.emitEvent("unknown", { threadId: id, reason: e.message });
      }
    }
    return desktop.identity;
  }
  disconnect() {
    this.subscriptions.clear();
    this.connectionGeneration++;
    this.reconnector?.stop();
    this.connecting = null;
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
    assertSupportedBuild(this.desktop?.identity?.appToolsPipe?.image);
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
    const r = await this.desktop.call(TOOLS.readThread, {
      threadId: id,
      turnLimit: 1,
    });
    if (r.thread?.id !== id || r.thread.kind !== "codex")
      throw Error("目前仅支持 Codex 会话写入");
    return r;
  }
  async models(mode = "codex") {
    this.requireConnection();
    if (mode === "chat") return { source: "official-desktop-chat-model-catalog-unavailable", models: [], supported: false };
    if (mode !== "codex") throw Error("Unknown conversation mode");
    return {
      source: "official-desktop-tools-schema-live",
      observedAt: new Date().toISOString(),
      models: withServiceTiers(
        parseModels(await this.desktop.refreshCatalog()),
      ),
    };
  }
  async usage() {
    this.requireConnection();
    const desktop = this.desktop;
    const raw = await desktop.call(TOOLS.usage, {});
    this.requireConnection();
    if (desktop !== this.desktop)
      throw Error("额度读取期间连接已更换，请重新读取");
    return accountUsage(raw);
  }
  async updateSettings(id, key, input) {
    const read = await this.codexThread(id);
    if (
      !input ||
      typeof input !== "object" ||
      Array.isArray(input) ||
      Object.keys(input).some(
        (k) =>
          !["model", "effort", "permissionMode", "serviceTier"].includes(k),
      )
    )
      throw Error("Invalid settings");
    // The desktop owner applies these settings to the next turn while the
    // current turn continues. Unknown/unloaded states are not write evidence.
    if (!["idle", "active"].includes(read.thread.status?.type))
      throw Error("官方会话状态尚不可确认；尚未加载的会话可先在官方桌面打开");
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
      ...tierOverride(
        input.serviceTier,
        input.model ?? current.model,
        withServiceTiers(parseModels(this.desktop.catalog)),
      ),
    };
    if (!Object.keys(settings).length) throw Error("没有选择需要修改的设置");
    return this.once(key, "settings", { id, settings }, async () => {
      const r = await protocolRequest(this.desktop.ipc, "settings",
        { conversationId: id, threadSettings: settings },
        {
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
    if (f.type !== "broadcast" || f.method !== EVENTS.stream)
      return;
    const id = f.params?.conversationId;
    if (
      !this.watching.has(id) ||
      !this.connected ||
      f.sourceClientId !== this.owners?.get(id) ||
      f.params.hostId !== OFFICIAL.discovery.hostId
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
  releaseSubscription(id) {
    const owner = this.owners?.get(id);
    if (owner && this.connected) {
      try { protocolBroadcast(this.desktop.ipc, "following", { hostId: OFFICIAL.discovery.hostId, conversationId: id, following: false }, [owner]); } catch {}
    }
    this.watching.delete(id);
    this.live.delete(id);
    this.owners?.delete(id);
    this.queue.live.delete(id);
    for (const [key, snapshot] of this.pages.snapshots) if (snapshot.threadId === id) this.pages.snapshots.delete(key);
  }
  unfollow(id, viewerId) {
    if (typeof viewerId !== 'string' || !/^[\w-]{8,160}$/.test(viewerId)) throw Error('Invalid viewer ID');
    this.subscriptions.remove(id, viewerId);
    return { released: true };
  }
  async follow(id, viewerId, renew = true) {
    this.requireConnection();
    if (renew) this.subscriptions.touch(id, viewerId);
    this.watching.add(id);
    const desktop = this.desktop;
    const o = await desktop.owner(id);
    this.requireConnection();
    if (desktop !== this.desktop || !this.watching.has(id))
      throw Error("Viewer connection changed during follow");
    this.owners ??= new Map();
    this.owners.set(id, o.handledByClientId);
    protocolBroadcast(desktop.ipc, "following",
      { hostId: OFFICIAL.discovery.hostId, conversationId: id, following: true },
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
      data: await this.desktop.call(TOOLS.listProjects),
    };
  }
  async threads(limit = 50) {
    this.requireConnection();
    return {
      source: "official-desktop-tool-live",
      observedAt: new Date().toISOString(),
      data: await this.desktop.call(TOOLS.listThreads, {
        limit: Math.min(limit, 50),
      }),
    };
  }
  async read(id, cursor, { compact = false } = {}) {
    this.requireConnection();
    const desktop = this.desktop;
    const data = await this.desktop.call(TOOLS.readThread, {
      threadId: id,
      turnLimit: compact ? 2 : 10,
      includeOutputs: true,
      maxOutputCharsPerItem: 12000,
      ...(cursor ? { cursor } : {}),
    });
    this.requireConnection();
    if (desktop !== this.desktop) throw Error("Viewer connection changed during read");
    if (data.thread?.kind === "chatgpt") {
      // The official Chat adapter stamps historical turns 'completed' even
      // while streaming. Only its separate renderer status query is usable.
      return {
        source: "official-desktop-chat-history + renderer-status-poll (may be cached)",
        observedAt: new Date().toISOString(),
        data: {
          ...data,
          thread: { ...data.thread, status: {
            ...data.thread.status,
            type: data.thread.status?.type === "systemError" ? "error" : (data.thread.status?.type ?? "unknown"),
          } },
          turns: (data.turns ?? []).map(turn => ({ ...turn, status: "history" })),
        },
        live: null,
      };
    }
    if (data.thread?.status?.type === "notLoaded") {
      this.live.delete(id);
      this.owners?.delete(id);
    }
    const decorated = this.media.decorate(
      id,
      mergeLiveTurnItems(data, this.live.get(id)?.state, {
        includeNewTurns: !cursor,
      }),
      { externalImages: compact },
    );
    return {
      source: this.live.has(id) ? "official-desktop-tool-read + verified-owner-live-items" : "official-desktop-tool-read",
      observedAt: new Date().toISOString(),
      data: compact ? compactConversation(decorated) : decorated,
      live: this.live.has(id)
        ? {
            ...this.live.get(id),
            status: runtimeStatus(this.live.get(id).state, this.connected),
          }
        : null,
    };
  }
  async readPage(id, before, retain, known) {
    this.requireConnection();
    this.pages.touch(id, retain);
    const result = await this.pages.read(id, before, (cursor) =>
      this.read(id, cursor, { compact: true }),
    );
    if (before) return result;
    const headHash = createHash("sha256")
      .update(
        JSON.stringify({
          thread: result.data.thread,
          turns: result.data.turns,
          settings: result.live?.state,
          status: result.live?.status,
        }),
      )
      .digest("hex");
    return known === headHash
      ? { notModified: true, headHash, observedAt: result.observedAt }
      : { ...result, headHash };
  }
  async once(key, operation, payload, fn, { deferredDispatch = false } = {}) {
    if (typeof key !== "string" || !/^[\w-]{8,100}$/.test(key))
      throw Error("requestId required (8-100 letters/digits/hyphens)");
    const hash = createHash("sha256")
      .update(JSON.stringify({ operation, payload }))
      .digest("hex");
    const old = this.db.requests[key];
    if (old) {
      if (old.hash !== hash)
        throw Error("requestId reused with different content");
      const pending = this.requestFlights?.get(key);
      if (pending) return { deduplicated: true, ...await pending };
      if (!deferredDispatch || !["preparing", "rejected"].includes(old.status))
        return { deduplicated: true, ...old };
    }
    this.db.requests[key] = {
      hash,
      operation,
      status: deferredDispatch ? "preparing" : "outcome-unknown",
      startedAt: new Date().toISOString(),
    };
    this.save();
    // A persisted preparing/rejected record proves no message was dispatched.
    // Persist uncertainty synchronously immediately before crossing the owner pipe.
    const dispatch = () => {
      this.db.requests[key].status = "outcome-unknown";
      this.save();
    };
    const pending = Promise.resolve().then(async () => { try {
      const result = await fn(dispatch);
      this.db.requests[key] = {
        ...this.db.requests[key],
        status: "accepted",
        result,
      };
      this.save();
      return this.db.requests[key];
    } catch (e) {
      if (this.db.requests[key].status === "preparing")
        this.db.requests[key].status = "rejected";
      this.db.requests[key].error = e.message;
      this.save();
      throw e;
    }});
    this.requestFlights ??= new Map();
    this.requestFlights.set(key, pending);
    try { return await pending; }
    finally { if (this.requestFlights.get(key) === pending) this.requestFlights.delete(key); }
  }
  async answerQuestions(id, key, input) {
    await this.codexThread(id);
    const owner = await this.follow(id);
    for (let i = 0; i < 40 && !this.live.get(id)?.state; i++)
      await new Promise((r) => setTimeout(r, 100));
    const state = this.live.get(id)?.state;
    if (!state) throw Error("官方实时问答状态不可用，请刷新后再回答");
    if (input?.kind === "request") {
      const request = state.requests?.find(
        (r) =>
          String(r.id) === String(input.questionRequestId) &&
          r.method === EVENTS.userInput,
      );
      if (!request) throw Error("此问题已结束或已在其他窗口回答");
      const answers = {};
      for (const q of request.params.questions) {
        const answer = input.answers?.[q.id];
        if (
          typeof answer !== "string" ||
          !answer.trim() ||
          answer.length > 20000
        )
          throw Error("请回答所有问题");
        answers[q.id] = { answers: [answer] };
      }
      return this.once(
        key,
        "question-answer",
        { id, requestId: request.id, answers },
        async () => {
          const r = await protocolRequest(this.desktop.ipc, "userInput",
            {
              conversationId: id,
              requestId: request.id,
              response: { answers },
            },
            {
              targetClientId: owner.handledByClientId,
              timeoutMs: 30000,
            },
          );
          if (r.handledByClientId !== owner.handledByClientId)
            throw Error("Question reply owner acknowledgement unknown");
          return {
            threadId: id,
            kind: "request",
            ownerClientId: r.handledByClientId,
          };
        },
      );
    }
    if (
      input?.kind !== "async" ||
      !Array.isArray(input.answers) ||
      !input.answers.length
    )
      throw Error("Invalid question answer");
    const read = await this.read(id);
    const items = read.data.turns.flatMap((t) => t.items ?? []);
    const questions = new Map(
      items.flatMap(asyncQuestions).map((q) => [q.id, q]),
    );
    const answered = new Set(
      items
        .filter(
          (i) =>
            i.type === "userMessage" ||
            (i.type === "steeringUserMessage" && i.status === "accepted"),
        )
        .flatMap((i) => questionReply(itemText(i)) ?? [])
        .map((a) => a.questionItemId),
    );
    const rows = input.answers.map((a) => {
      const q = questions.get(a.questionItemId);
      if (!q || answered.has(q.id))
        throw Error("问题已回答或不在当前读取的会话中");
      if (
        typeof a.answer !== "string" ||
        !a.answer.trim() ||
        a.answer.length > 20000
      )
        throw Error("请输入回答");
      return { questionItemId: q.id, question: q.title, answer: a.answer };
    });
    const prompt =
      "<send_user_message_question_reply>\n" +
      JSON.stringify(rows) +
      "\n</send_user_message_question_reply>";
    const status = await this.codexThread(id);
    if (status.thread.status.type === "idle")
      return this.nativeSend(id, key, prompt);
    if (status.thread.status.type !== "active")
      throw Error("当前会话状态未知，请刷新");
    return this.once(key, "async-question-answer", { id, rows }, async () => {
      const r = await protocolRequest(this.desktop.ipc, "steer",
        {
          conversationId: id,
          input: [{ type: "text", text: prompt, text_elements: [] }],
          restoreMessage: composeQueuedMessage(key, prompt, status.thread.cwd),
          clientUserMessageId: key,
          attachments: [],
        },
        {
          targetClientId: owner.handledByClientId,
          timeoutMs: 60000,
        },
      );
      if (r.handledByClientId !== owner.handledByClientId)
        throw Error("Question reply owner acknowledgement unknown");
      return {
        threadId: id,
        kind: "async",
        ownerClientId: r.handledByClientId,
        turnId: r.result?.result?.turnId,
      };
    });
  }
  async create(
    key,
    prompt = "只回复：REMOTE_BRIDGE_FIRST_OK。不要使用工具，不要创建或修改任何文件。",
    options = {},
    projectInput,
    imageDataUrls,
  ) {
    this.requireConnection();
    this.requireSupportedBuild();
    const images = validateImageUrls(imageDataUrls);
    if (images.length) return this.createWithImages(key, prompt, options, projectInput, images);
    if (typeof prompt !== "string" || !prompt.trim() || prompt.length > 20000)
      throw Error("Invalid message");
    if (options.serviceTier !== undefined)
      throw Error("官方新建接口未提供首轮加速参数；请创建后切换加速");
    const { permissionMode, ...modelInput } = options;
    const settings = {
      ...modelOverrides(modelInput, parseModels(this.desktop.catalog)),
      ...permissionOverrides(permissionMode),
    };
    const project = projectSelection(projectInput);
    return this.once(key, "create", { prompt, settings, ...(project ? { project } : {}) }, async dispatch => {
      // Resolve on the destination desktop again at send time, never trust a
      // path or stale project metadata supplied by a remote controller.
      const desktop = this.desktop;
      const context =
        permissionMode && permissionMode !== "keep"
          ? await this.permissionContext(permissionMode)
          : this.desktop.context;
      const name =
        "RemoteBridge-Probe-" +
        new Date().toISOString().replace(/[-:]/g, "").slice(0, 15) +
        "-" +
        randomUUID().slice(0, 6);
      const projectTarget = project
        ? savedProjectTarget(project, await desktop.call(TOOLS.listProjects))
        : null;
      this.requireConnection();
      if (desktop !== this.desktop) throw Error("创建期间目标桌面连接已更换，未发送");
      dispatch();
      const r = await this.desktop.call(
        TOOLS.createThread,
        {
          title: name,
          prompt,
          ...(settings.model ? { model: settings.model } : {}),
          ...(settings.effort ? { thinking: settings.effort } : {}),
          target: projectTarget ?? { type: "projectless", directoryName: name },
        },
        context,
      );
      if (!r.threadId)
        throw Error("create-outcome-unknown: " + JSON.stringify(r));
      this.db.tests[r.threadId] = {
        title: name,
        createdAt: new Date().toISOString(),
        cwd: r.cwd ?? null,
        outputDirectory: r.projectlessOutputDirectory ?? null,
        ...(project ? { projectId: project.projectId, environment: "local" } : {}),
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
    }, { deferredDispatch: true });
  }
  async createWithImages(key, prompt, options, projectInput, images) {
    if (typeof key !== "string" || !/^[\w-]{8,100}$/.test(key)) throw Error("requestId required");
    if (typeof prompt !== "string" || prompt.length > 20000) throw Error("Invalid message");
    if (options.serviceTier !== undefined) throw Error("官方新建接口未提供首轮加速参数；请创建后切换加速");
    const { permissionMode, ...modelInput } = options;
    modelOverrides(modelInput, parseModels(this.desktop.catalog)); permissionOverrides(permissionMode);
    const project = projectSelection(projectInput);
    const hash = createHash("sha256").update(JSON.stringify({ prompt, options, project, images })).digest("hex");
    this.db.imageCreates ??= {};
    let record = this.db.imageCreates[key];
    if (record && record.hash !== hash) throw Error("requestId reused with different content");
    if (record?.result) return { ...record.result, deduplicated: true };
    this.imageCreateFlights ??= new Map();
    if (this.imageCreateFlights.has(key)) return this.imageCreateFlights.get(key);
    if (!record) {
      record = this.db.imageCreates[key] = { hash, createdAt: new Date().toISOString() };
      this.save();
    }
    const suffix = createHash("sha256").update(key).digest("hex");
    const pending = (async () => {
      // Official create_thread is text-only. Do not send the user's real request
      // without its images: prepare one official task, then send the full input.
      const created = await this.create("image-create-" + suffix,
        "Remote Codex 正在为用户准备带图会话，实际文字和图片将在下一条消息一起发送。只回复 READY，不要使用工具，不要读取或修改文件。",
        options, projectInput);
      if (created.status !== "accepted" || !created.result?.threadId)
        return { status: "outcome-unknown", phase: "creating", error: "创建回执未知；不会重新创建，请核对官方桌面" };
      const id = created.result.threadId;
      record.threadId = id; this.save();
      let idle = false;
      for (let i = 0; i < 90; i++) {
        if ((await this.codexThread(id)).thread.status?.type === "idle") { idle = true; break; }
        await new Promise(r => setTimeout(r, 500));
      }
      if (!idle) throw Error("带图会话已创建，正在等待官方就绪；文字和图片已保留，重试会继续同一会话");
      const sent = await this.nativeSend(id, "image-message-" + suffix,
        prompt.trim() ? prompt : "请查看这些图片。", images);
      if (sent.status !== "accepted") return { status: "outcome-unknown", phase: "sending", threadId: id };
      record.result = { status: "accepted", result: { ...created.result, imageTurnId: sent.result?.result?.result?.turn?.id }, preparation: "official-text-setup-then-image-turn" };
      this.save();
      return record.result;
    })();
    this.imageCreateFlights.set(key, pending);
    try { return await pending; } finally { this.imageCreateFlights.delete(key); }
  }
  async permissionContext(mode) {
    this.permissionPreparations ??= new Map();
    if (this.permissionPreparations.has(mode))
      return this.permissionPreparations.get(mode);
    const preparation = (async () => {
      this.db.permissionContexts ??= {};
      let id = this.db.permissionContexts[mode];
      if (!id) {
        const models = parseModels(this.desktop.catalog),
          model = models.find((m) => m.id === "gpt-5.4-mini") ?? models.at(-1);
        const created = await this.create(
          "permission-context-" + randomUUID(),
          "这是 Remote Bridge 的专用权限配置测试会话。只回复 READY，不要使用工具，不要访问或修改文件。",
          { model: model.id, effort: model.efforts[0] },
        );
        id = created.result.threadId;
        await this.desktop.call(TOOLS.setTitle, {
          threadId: id,
          title: "RemoteBridge-Settings-" + mode,
        });
        this.db.permissionContexts[mode] = id;
        this.save();
      }
      this.guardProbe(id);
      for (let i = 0; i < 60; i++) {
        const read = await this.codexThread(id);
        if (read.thread.status.type === "notLoaded") {
          await this.open(id);
          await new Promise((r) => setTimeout(r, 300));
          continue;
        }
        if (read.thread.status.type === "idle") {
          const previous = this.live.get(id);
          await this.follow(id);
          for (let j = 0; j < 30 && this.live.get(id) === previous; j++)
            await new Promise((r) => setTimeout(r, 100));
          if (this.live.get(id) === previous)
            throw Error("官方权限准备状态未知，当前消息没有发送");
          const expected = permissionOverrides(mode).permissions;
          if (
            this.live.get(id)?.state.currentPermissions?.activePermissionProfile
              ?.id !== expected
          ) {
            // Official creation inherits effective permissions, not a draft
            // setting. Prime only this registered, reusable setup task.
            await this.nativeSend(
              id,
              "permission-prepare-" + randomUUID(),
              "只回复 READY。不要使用工具，不要访问任何文件。",
              undefined,
              { permissionMode: mode },
            );
            let ready = false;
            for (let j = 0; j < 90; j++) {
              const state = await this.codexThread(id);
              if (
                state.thread.status.type === "idle" &&
                this.live.get(id)?.state.currentPermissions
                  ?.activePermissionProfile?.id === expected
              ) {
                ready = true;
                break;
              }
              await new Promise((r) => setTimeout(r, 500));
            }
            if (!ready) throw Error("官方权限准备尚未确认，当前消息没有发送");
          }
          return id;
        }
        await new Promise((r) => setTimeout(r, 500));
      }
      throw Error("官方权限准备会话尚未就绪，当前消息没有发送");
    })();
    this.permissionPreparations.set(mode, preparation);
    try {
      return await preparation;
    } finally {
      this.permissionPreparations.delete(mode);
    }
  }
  async send(id, key, prompt) {
    await this.codexThread(id);
    this.requireConnection();
    if (typeof prompt !== "string" || !prompt.trim() || prompt.length > 20000)
      throw Error("Invalid message");
    return this.once(key, "send", { id, prompt }, async dispatch => {
      const owner = await this.desktop.owner(id);
      dispatch();
      const r = await this.desktop.call(TOOLS.sendMessage, {
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
    }, { deferredDispatch: true });
  }
  chatCapabilities() {
    const catalog = this.desktop?.catalog ?? [];
    let supported = false;
    try { this.requireSupportedBuild(); supported = true; } catch {}
    const has = name => catalog.some(t => t.namespace === OFFICIAL.discovery.toolsNamespace && t.name === name);
    return {
      read: has(TOOLS.readThread) && has(TOOLS.listThreads),
      sendText: supported && has(TOOLS.sendMessage),
      sendValidation: "source-reviewed; dedicated-live-test-pending",
      create: false, models: false, images: false, queue: false, interrupt: false,
      status: "renderer-poll", classification: "chatgpt-including-work-unclassified",
    };
  }
  async chatSend(id, key, prompt, imageDataUrl, settings) {
    this.guard(id);
    this.requireConnection();
    if (!this.chatCapabilities().sendText) throw Error("此官方桌面版本尚未验证 Chat 文字入口");
    if (typeof prompt !== "string" || !prompt.trim() || prompt.length > 20000) throw Error("Invalid message");
    if (validateImageUrls(imageDataUrl).length || (settings && Object.keys(settings).length))
      throw Error("Chat 暂不支持图片或模型/权限参数；请在官方桌面操作");
    return this.once(key, "chat-send", { id, prompt }, async dispatch => {
      const desktop = this.desktop;
      const r = await desktop.call(TOOLS.readThread, { threadId: id, turnLimit: 1 });
      this.requireConnection();
      if (desktop !== this.desktop) throw Error("Viewer connection changed before Chat send");
      if (r.thread?.id !== id || r.thread.kind !== "chatgpt") throw Error("目标不是官方 ChatGPT 会话");
      if (r.thread.status?.type !== "idle") throw Error("Chat 正在回复或状态未知，请在官方桌面核对后再发送");
      // No hostId, Codex settings or owner-discovery: the official tool's
      // existing Chat branch loads this exact ID and uses its Chat composer.
      dispatch();
      const result = await desktop.call(TOOLS.sendMessage, { threadId: id, prompt });
      if (result.threadId !== id) throw Error("Chat send outcome unknown: official task ID mismatch");
      this.emitEvent("chat-send-accepted", { threadId: id, route: "official-app-tools -> desktop Chat composer", officialPid: desktop.identity.officialPid });
      return { threadId: id, source: "official-desktop-chat-send", officialPid: desktop.identity.officialPid };
    }, { deferredDispatch: true });
  }
  async open(id) {
    this.guard(id);
    this.requireConnection();
    return this.desktop.call(TOOLS.navigate, { threadId: id });
  }
  async interrupt(id, key, expectedTurnId) {
    this.guard(id);
    this.requireConnection();
    if (typeof expectedTurnId !== "string" || !expectedTurnId)
      throw Error("expectedTurnId required");
    return this.once(key, "interrupt", { id, expectedTurnId }, async dispatch => {
      await this.codexThread(id);
      const desktop = this.desktop, previous = this.live.get(id);
      const owner = await this.follow(id);
      for (let i = 0; i < 40 && this.live.get(id) === previous; i++)
        await new Promise(r => setTimeout(r, 100));
      this.requireConnection();
      const live = this.live.get(id);
      if (desktop !== this.desktop || !live || live === previous ||
          live.owner !== owner.handledByClientId)
        throw Error("官方实时运行状态尚未确认，停止请求没有发送，请刷新后重试");
      if (activeTurnId(live.state) !== expectedTurnId)
        throw Error("该轮任务已结束或运行轮次已变化，停止请求没有发送");
      dispatch();
      const r = await protocolRequest(desktop.ipc, "interrupt",
        { conversationId: id, mode: "user-stop", expectedTurnId },
        {
          targetClientId: owner.handledByClientId,
          timeoutMs: 30000,
        },
      );
      if (r.handledByClientId !== owner.handledByClientId)
        throw Error("停止请求的官方所有者回执不匹配，结果未知，请在官方桌面核对");
      if (r.result?.ok !== true || r.result.interruptedTurnId !== expectedTurnId)
        throw Error("官方尚未确认停止所选轮次，请刷新或在官方桌面核对");
      // An acknowledgement is not a completed interrupt; observe the owner stream.
      this.emitEvent("interrupt-requested", {
        threadId: id,
        expectedTurnId,
        requestId: r.requestId,
        ownerClientId: r.handledByClientId,
        result: r.result,
      });
      return r;
    }, { deferredDispatch: true });
  }
  async nativeSend(id, key, prompt, imageDataUrl, options = {}) {
    this.guard(id);
    this.requireConnection();
    if (typeof prompt !== "string" || !prompt.trim() || prompt.length > 20000)
      throw Error("Invalid message");
    const images = validateImageUrls(imageDataUrl);
    if (
      !options ||
      typeof options !== "object" ||
      Array.isArray(options) ||
      Object.keys(options).some(
        (k) =>
          !["model", "effort", "permissionMode", "serviceTier"].includes(k),
      )
    )
      throw Error("Invalid settings");
    const { permissionMode, serviceTier, ...modelInput } = options;
    const settings = {
      ...modelOverrides(modelInput, parseModels(this.desktop.catalog)),
      ...permissionOverrides(permissionMode),
      ...(serviceTier === undefined ? {} : { serviceTier }),
    };
    return this.once(
      key,
      "native-send",
      {
        id,
        prompt,
        settings,
        imageHash: images.length
          ? createHash("sha256").update(images.length === 1 ? images[0] : JSON.stringify(images)).digest("hex")
          : null,
      },
      async dispatch => {
        let status = await this.codexThread(id);
        if (
          status.thread.status.type === "notLoaded" &&
          (settings.permissions || serviceTier !== undefined)
        ) {
          await this.open(id);
          for (
            let i = 0;
            i < 60 && status.thread.status.type === "notLoaded";
            i++
          ) {
            await new Promise((r) => setTimeout(r, 200));
            status = await this.codexThread(id);
          }
          if (status.thread.status.type === "notLoaded")
            throw Error("官方会话尚未加载，消息没有发送");
        }
        if (status.thread.status.type === "notLoaded") {
          if (images.length)
            throw Error("此会话尚未加载，请先发送文字或在官方桌面打开后再发图");
          // The desktop tool resumes its own existing task. Choose this route
          // before dispatch; never retry a failed native write through it.
          dispatch();
          const r = await this.desktop.call(TOOLS.sendMessage, {
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
        if (settings.permissions || serviceTier !== undefined) {
          const update = {
            ...(permissionMode ? { permissionMode } : {}),
            ...(serviceTier === undefined ? {} : { serviceTier }),
            ...(settings.model ? { model: settings.model } : {}),
            ...(settings.effort ? { effort: settings.effort } : {}),
          };
          const updated = await this.updateSettings(
            id,
            "send-settings-" + createHash("sha256").update(key).digest("hex"),
            update,
          );
          if (updated.status !== "accepted") throw Error("设置结果未知，消息尚未发送，请在官方桌面核对设置");
        }
        const input = [{ type: "text", text: prompt, text_elements: [] }];
        for (const url of images) input.push({ type: "image", url });
        dispatch();
        const r = await protocolRequest(this.desktop.ipc, "start",
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
      { deferredDispatch: true },
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
      TOOLS.waitThreads,
      {
        targets: [{ threadId: id, hostId: OFFICIAL.discovery.hostId }],
        timeoutMs: Math.min(timeoutMs, 50000),
      },
      context,
    );
  }
  status() {
    const compatibility = desktopCompatibility(this.desktop?.identity?.appToolsPipe?.image);
    return {
      connected: this.connected,
      source: "official-desktop-IPC-live",
      officialPid: this.desktop?.identity?.officialPid ?? null,
      readOnlyThreadIds: [],
      testExcludedThreadIds: testExcludedThreadIds(),
      // Legacy clients treat these fields as read-only, so keep them empty.
      protectedThreadId: null,
      protectedThreadIds: [],
      desktopCompatibility: compatibility,
      existingCodexWritable: compatibility.writeSupported,
      interrupt: { supported: compatibility.writeSupported, source: "official-desktop-owner-IPC" },
      projectCreation: {
        local: supportedBuild(this.desktop?.identity?.appToolsPipe?.image) &&
          [TOOLS.listProjects, TOOLS.createThread].every(name => this.desktop?.catalog?.some(t => t.namespace === OFFICIAL.discovery.toolsNamespace && t.name === name)),
        worktree: false,
        source: "official-desktop-list-projects-and-create-thread",
      },
      multiImageInput: true,
      imageCreation: { supported: compatibility.writeSupported, mode: "official-text-setup-then-image-turn" },
      viewerLeases: true,
      imageLimits: IMAGE_LIMITS,
      chat: this.chatCapabilities(),
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
