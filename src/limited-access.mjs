import path from "node:path";
import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { DurableJson } from "./durable-json.mjs";

const digest = value => createHash("sha256").update(value).digest("hex");
const uuid = value => /^[a-f0-9-]{36}$/.test(value ?? "");
const valid = value => value && value.schemaVersion === 1 &&
  value.identities && typeof value.identities === "object" && !Array.isArray(value.identities) &&
  value.threads && typeof value.threads === "object" && !Array.isArray(value.threads);

// A pairing code is a bearer credential. Only its digest is retained on the target.
// The same code intentionally gives multiple Limit installations one shared identity.
export class LimitedAccess {
  constructor(dir) {
    this.store = new DurableJson(path.join(dir, "limited-access.json"), {
      label: "受限配对与会话归属", empty: { schemaVersion: 1, identities: {}, threads: {} },
      validate: valid, recoveryReadOnly: true,
    });
  }
  list() {
    return { identities: Object.entries(this.store.value.identities).map(([id, row]) => ({
      id, name: row.name, enabled: row.enabled, createdAt: row.createdAt,
      threadCount: Object.values(this.store.value.threads).filter(owner => owner === id).length,
    })), storageHealth: this.store.health };
  }
  create(name) {
    name = String(name ?? "").trim();
    if (!name || name.length > 60) throw Error("请输入 1–60 字符的配对名称");
    const id = randomUUID(), code = "lrc1_" + randomBytes(32).toString("hex");
    const value = structuredClone(this.store.value);
    value.identities[id] = { name, enabled: true, keyHash: digest(code), createdAt: new Date().toISOString() };
    this.store.write(value);
    return { id, name, code };
  }
  revoke(id) {
    if (!uuid(id) || !this.store.value.identities[id]) throw Error("受限配对不存在");
    const value = structuredClone(this.store.value);
    value.identities[id].enabled = false;
    this.store.write(value);
    return this.list();
  }
  rotate(id) {
    if (!uuid(id) || !this.store.value.identities[id]?.enabled) throw Error("受限配对不存在或已撤销");
    const code = "lrc1_" + randomBytes(32).toString("hex");
    const value = structuredClone(this.store.value);
    value.identities[id].keyHash = digest(code);
    this.store.write(value);
    return { id, name: value.identities[id].name, code };
  }
  authenticate(code) {
    if (!this.store.health.writable) return null;
    if (typeof code !== "string" || !/^lrc1_[a-f0-9]{64}$/.test(code)) return null;
    const candidate = Buffer.from(digest(code), "hex");
    for (const [id, row] of Object.entries(this.store.value.identities)) {
      if (!row.enabled || !/^[a-f0-9]{64}$/.test(row.keyHash ?? "")) continue;
      if (timingSafeEqual(candidate, Buffer.from(row.keyHash, "hex"))) return id;
    }
    return null;
  }
  requireActive(id) {
    this.store.assertWritable();
    if (!uuid(id) || this.store.value.identities[id]?.enabled !== true)
      throw Error("受限配对已撤销或不可用");
  }
  streamGrant(id) {
    this.requireActive(id);
    return this.store.value.identities[id].keyHash;
  }
  streamGrantActive(id, keyHash) {
    return this.store.health.writable &&
      this.store.value.identities[id]?.enabled === true &&
      this.store.value.identities[id].keyHash === keyHash;
  }
  owns(identity, threadId) {
    this.requireActive(identity);
    return uuid(threadId) && this.store.value.threads[threadId] === identity;
  }
  requireThread(identity, threadId) {
    if (!this.owns(identity, threadId)) throw Error("此会话不属于当前受限配对");
  }
  remember(identity, threadId) {
    this.requireActive(identity);
    if (!uuid(threadId)) throw Error("官方新建回执缺少有效会话 ID");
    const old = this.store.value.threads[threadId];
    if (old && old !== identity) throw Error("会话已归属其他受限配对");
    if (old === identity) return;
    const value = structuredClone(this.store.value);
    value.threads[threadId] = identity;
    this.store.write(value);
  }
  requestId(identity, requestId) {
    this.requireActive(identity);
    if (typeof requestId !== "string" || !/^[\w-]{8,100}$/.test(requestId)) throw Error("requestId 无效");
    return "limit-" + digest(identity + "\0" + requestId);
  }
  filterList(identity, result) {
    this.requireActive(identity);
    const data = result.data ?? {};
    // Do not pass through newly added official list fields without reviewing
    // whether they contain information about another pairing's conversations.
    return { ...result, data: {
      schemaVersion: data.schemaVersion,
      listAvailability: data.listAvailability,
      pinnedThreads: (data.pinnedThreads ?? []).filter(row => this.owns(identity, row.id)).map((row, index) => ({ ...row, pinnedIndex: index + 1 })),
      threads: (data.threads ?? []).filter(row => this.owns(identity, row.id)),
    } };
  }
  filterStatus(identity, result) {
    this.requireActive(identity);
    const threads = Object.fromEntries(Object.entries(result.threads ?? {}).filter(([id]) => this.owns(identity, id)));
    return { ...result, threads, testThreads: {}, testExcludedThreadIds: [], readOnlyThreadIds: [],
      protectedThreadId: null, protectedThreadIds: [], desktopConnection: null,
      capabilities: { ...result.capabilities, projects: { supported: false, reason: "Limit 版不提供项目列表" },
        projectCreate: { supported: false, reason: "Limit 版只能创建无项目会话" } },
      projectCreation: { local: false, worktree: false, source: "limited-access" } };
  }
  filterSummary(identity, result) {
    this.requireActive(identity);
    return { ...result, complete: false,
      threads: (result.threads ?? []).filter(row => this.owns(identity, row.id)) };
  }
  filterEvent(identity, event) {
    this.requireActive(identity);
    if (event.kind === "connected" || event.kind === "connection-interrupted")
      return { kind: event.kind,
        ...(event.kind === "connection-interrupted" && String(event.reason ?? "").includes("Oversize IPC frame")
          ? { reason: "Oversize IPC frame" } : {}) };
    if (!this.owns(identity, event.threadId)) return null;
    if (event.kind === "thread-state") {
      const source = event.status ?? {};
      const type = ["idle", "running", "waiting-approval", "waiting-user-input", "unknown", "connection-interrupted"].includes(source.type)
        ? source.type : "unknown";
      return { kind: "thread-state", threadId: event.threadId, status: {
        type, confirmed: source.confirmed === true,
        ...(Array.isArray(source.activeFlags) ? { activeFlags: source.activeFlags.filter(flag =>
          ["waitingOnApproval", "waitingOnUserInput"].includes(flag)) } : {}),
      } };
    }
    if (["created", "unknown", "queue-changed", "report-read"].includes(event.kind))
      return { kind: event.kind, threadId: event.threadId };
    return null;
  }
}
