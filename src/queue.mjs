import { OFFICIAL, EVENTS, protocolRequest } from "./official-protocol.mjs";
import { validateImageUrls, imagesFromBody } from "../public/image-input.mjs";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
export const queueRevision = (messages) =>
  createHash("sha256").update(JSON.stringify(messages)).digest("hex");
export function composeQueuedMessage(id, prompt, cwd, imageDataUrl) {
  if (typeof cwd !== "string" || !cwd.trim())
    throw Error("官方会话工作目录未知");
  if (typeof prompt !== "string" || !prompt.trim() || prompt.length > 20000)
    throw Error("Invalid message");
  const images = validateImageUrls(imageDataUrl);
  return {
    id,
    text: prompt,
    context: {
      prompt,
      addedFiles: [],
      fileAttachments: [],
      ideContext: null,
      imageAttachments: images.map((src, index) => ({ id: id + "-image-" + index, src, filename: "image-" + (index + 1) + "." + src.slice(11, src.indexOf(";")) })),
      commentAttachments: [],
      workspaceRoots: [cwd],
    },
    cwd,
    createdAt: Date.now(),
  };
}
export function editableQueueMessage(message) {
  const c = message.context ?? {};
  const complex =
    [
      "addedFiles",
      "fileAttachments",
      "pastedTextAttachments",
      "commentAttachments",
      "mcpAppModelContextAttachments",
      "selectedTextAttachments",
      "responseTextAnnotations",
      "appshotContexts",
      "threadReferences",
      "chatGptConversationContexts",
      "pullRequestChecks",
      "imageCommentDrafts",
    ].some((k) => c[k]?.length) ||
    c.ideContext ||
    c.inAppBrowserContext ||
    c.pullRequestMergeConflict ||
    c.untrustedAppMessage ||
    c.isImageEditFollowUp;
  const images = c.imageAttachments ?? [];
  if (complex) return false;
  try { validateImageUrls(images.map(i => i.src)); return true; }
  catch { return false; }
}
export function publicQueueMessage(m, multiImageInput = true) {
  const editable = editableQueueMessage(m) && (multiImageInput || (m.context?.imageAttachments?.length ?? 0) <= 1);
  return {
    id: m.id,
    text: m.text,
    createdAt: m.createdAt,
    pausedReason: m.pausedReason ?? null,
    editable,
    imageDataUrls: editable ? (m.context?.imageAttachments ?? []).map(i => i.src) : [],
    imageDataUrl: editable && (m.context?.imageAttachments?.length ?? 0) <= 1
      ? (m.context?.imageAttachments?.[0]?.src ?? null)
      : null,
    attachmentCount:
      (m.context?.imageAttachments?.length ?? 0) +
      (m.context?.fileAttachments?.length ?? 0),
    restriction: editable
      ? null
      : "此消息含其他官方上下文，请在官方桌面编辑或调整方向",
  };
}
export class OfficialQueue {
  constructor(
    bridge,
    file = null,
  ) {
    this.bridge = bridge;
    this.file = file;
    this.live = new Map();
    this.locks = new Map();
  }
  clear() {
    this.live.clear();
  }
  frame(f) {
    const b = this.bridge,
      id = f.params?.conversationId;
    if (
      f.type !== "broadcast" ||
      f.method !== EVENTS.queue ||
      !b.connected ||
      !b.watching.has(id) ||
      f.sourceClientId !== b.owners?.get(id) ||
      !Array.isArray(f.params.messages)
    )
      return;
    this.live.set(id, {
      messages: f.params.messages,
      owner: f.sourceClientId,
      at: new Date().toISOString(),
    });
    b.emitEvent("queue-changed", {
      threadId: id,
      ownerClientId: f.sourceClientId,
      count: f.params.messages.length,
      revision: queueRevision(f.params.messages),
    });
  }
  disk(id) {
    // Official storage is read-only. All mutations go to its live owner by IPC.
    const home = this.bridge.officialDataHome?.();
    const file = this.file ?? (home ? path.join(home, OFFICIAL.storage.globalStateFile) : null);
    if (!file) throw Error("官方队列目录尚未确认，请重新连接后重试");
    const state = JSON.parse(fs.readFileSync(file, "utf8"))[
      OFFICIAL.storage.queueKey
    ];
    if (
      state !== undefined &&
      (!state || typeof state !== "object" || Array.isArray(state))
    )
      throw Error("官方队列记录不可读");
    const messages = state?.[id] ?? [];
    if (
      !Array.isArray(messages) ||
      messages.some((m) => !m?.id || typeof m.text !== "string" || !m.context)
    )
      throw Error("官方队列格式未知");
    return messages;
  }
  recovery(id, key) {
    this.bridge.requireConnection();
    const recovery = this.bridge.db.queueRecoveries?.[key];
    if (!recovery || recovery.threadId !== id || recovery.state !== "draft")
      throw Error("草稿已变化，请刷新队列后重试");
    return { recoveryId: key, draft: publicQueueMessage(recovery.message) };
  }
  read(id, multiImageInput = true, previews = false) {
    this.bridge.requireConnection();
    const live = this.live.get(id),
      verified = !!live && live.owner === this.bridge.owners?.get(id);
    const messages = verified ? live.messages : this.disk(id),
      revision = queueRevision(messages);
    const present = (message) => {
      const result = publicQueueMessage(message, multiImageInput);
      if (previews) {
        result.imageRefs = result.imageDataUrls.map((source, i) =>
          this.bridge.media.add(id, source, "排队图片-" + (i + 1) + "." + source.slice(11, source.indexOf(";")), true),
        ).filter(Boolean);
        delete result.imageDataUrls;
        delete result.imageDataUrl;
      }
      return result;
    };
    return {
      ...(previews ? { previewProtocol: "refs-v1" } : {}),
      source: verified ? "official-owner-queue-broadcast" : "official-disk",
      confirmed: !!verified,
      observedAt: new Date().toISOString(),
      revision,
      messages: messages.map(present),
      recoveries: Object.entries(this.bridge.db.queueRecoveries ?? {})
        .filter(([, r]) => r.threadId === id)
        .map(([key, r]) => ({
          recoveryId: key,
          state: r.state,
          draft: present(r.message),
        })),
    };
  }
  async locked(id, fn) {
    const previous = this.locks.get(id) ?? Promise.resolve();
    const next = previous.catch(() => {}).then(fn);
    this.locks.set(id, next);
    try {
      return await next;
    } finally {
      if (this.locks.get(id) === next) this.locks.delete(id);
    }
  }
  async write(id, owner, messages) {
    const b = this.bridge;
    b.requireConnection();
    const r = await protocolRequest(b.desktop.ipc, "queueWrite",
      { conversationId: id, state: { [id]: messages } },
      { targetClientId: owner, timeoutMs: 30000 },
    );
    if (r.handledByClientId !== owner || r.result?.ok !== true)
      throw Error("Queue owner acknowledgement unknown");
    b.emitEvent("queue-write-accepted", {
      threadId: id,
      ownerClientId: owner,
      count: messages.length,
      requestId: r.requestId,
    });
    return r;
  }
  clearRecovery(id, key) {
    if (this.bridge.db.queueRecoveries?.[key]?.threadId === id) {
      delete this.bridge.db.queueRecoveries[key];
      this.bridge.save();
    }
  }
  async beforeDispatchRetry(key, fn) {
    const hadRecord = Object.hasOwn(this.bridge.db.requests, key);
    let dispatched = false;
    try {
      return await fn(() => {
        dispatched = true;
      });
    } catch (error) {
      if (
        !hadRecord &&
        !dispatched &&
        this.bridge.db.requests[key]?.operation === "queue"
      ) {
        delete this.bridge.db.requests[key];
        this.bridge.save();
      }
      throw error;
    }
  }
  async mutate(id, key, body) {
    const b = this.bridge;
    if (body.action === "ack-recovery") {
      if (typeof id !== "string" || !/^[a-f0-9-]{36}$/.test(id) ||
          typeof body.recoveryId !== "string" || !/^[\w-]{1,160}$/.test(body.recoveryId)) throw Error("Invalid draft identity");
      // Local backup only: no official connection/owner/write is needed.
      // Serialize with take/steer; unresolved dispatch evidence is not a draft.
      return this.locked(id, () => {
        const r = b.db.queueRecoveries?.[body.recoveryId];
        if (r && (r.threadId !== id || r.state !== "draft")) throw Error("草稿状态已变化，请刷新核对");
        if (r) {
          delete b.db.queueRecoveries[body.recoveryId];
          try { b.save(); }
          catch (e) { b.db.queueRecoveries[body.recoveryId] = r; throw e; }
        }
        return { status: "accepted", result: { disposition: "recovery-cleared" } };
      });
    }
    b.guard(id);
    b.requireConnection();
    if (!["enqueue", "take", "delete", "steer"].includes(body.action))
      throw Error("Invalid queue operation");
    const images = imagesFromBody(body);
    const payload = {
      id,
      action: body.action,
      messageId: body.messageId,
      prompt: body.prompt,
      imageHash: images.length
        ? createHash("sha256").update(images.length === 1 ? images[0] : JSON.stringify(images)).digest("hex")
        : null,
    };
    return this.locked(id, () =>
      this.beforeDispatchRetry(key, (dispatch) =>
        b.once(key, "queue", payload, async () => {
          const r = await b.codexThread(id);
          if (!["active", "idle"].includes(r.thread.status?.type))
            throw Error("请先加载官方会话，再操作队列");
          const owner = (await b.follow(id)).handledByClientId;
          const live = this.live.get(id);
          const messages =
            live?.owner === owner ? live.messages : this.disk(id);
          if (queueRevision(messages) !== body.revision)
            throw Error("队列已经变化，请刷新后重试");
          if (body.action === "enqueue") {
            if (messages.some((m) => m.id === key))
              throw Error("消息已在官方队列，请刷新核对");
            const message = composeQueuedMessage(
              key,
              body.prompt,
              r.thread.cwd,
              images,
            );
            const next = [...messages, message];
            if (Buffer.byteLength(JSON.stringify(next)) > 24 * 1024 * 1024) throw Error("官方队列图片总量过大，请先发送或取回已有队列消息");
            dispatch();
            await this.write(id, owner, next);
            this.clearRecovery(id, body.recoveryId);
            return { threadId: id, messageId: key, disposition: "queued" };
          }
          const message = messages.find((m) => m.id === body.messageId);
          if (!message) throw Error("消息已离开队列，请刷新核对");
          if (r.thread.status.type !== "active" && !message.pausedReason)
            throw Error("当前轮已结束，队列可能正在发送；请刷新核对");
          if (body.action !== "delete" && !editableQueueMessage(message))
            throw Error(publicQueueMessage(message).restriction);
          // Keep a durable draft before removing: a lost response must not lose input.
          if (body.action !== "delete") {
            b.db.queueRecoveries ??= {};
            b.db.queueRecoveries[key] = {
              threadId: id,
              message,
              state: "withdrawal-unknown",
            };
            b.save();
          }
          // Remove before steering so the official queue cannot auto-send it again.
          dispatch();
          await this.write(
            id,
            owner,
            messages.filter((m) => m.id !== message.id),
          );
          if (body.action !== "delete") {
            b.db.queueRecoveries[key].state = "draft";
            b.save();
          }
          const draft = publicQueueMessage(message);
          if (body.action === "take")
            return {
              threadId: id,
              disposition: "draft",
              draft,
              recoveryId: key,
            };
          if (body.action === "delete")
            return {
              threadId: id,
              disposition: "removed",
              messageId: message.id,
            };
          const latest = await b.codexThread(id);
          if (latest.thread.status?.type !== "active")
            return {
              threadId: id,
              disposition: "draft",
              draft,
              recoveryId: key,
              reason: "当前轮已结束，消息已取回编辑，尚未发送",
            };
          const input = [
            {
              type: "text",
              text: message.context.prompt ?? message.text,
              text_elements: [],
            },
          ];
          for (const url of draft.imageDataUrls) input.push({ type: "image", url });
          try {
            b.db.queueRecoveries[key].state = "steer-unknown";
            b.save();
            const result = await protocolRequest(b.desktop.ipc, "steer",
              {
                conversationId: id,
                input,
                restoreMessage: message,
                clientUserMessageId: message.id,
                attachments: [],
              },
              { targetClientId: owner, timeoutMs: 60000 },
            );
            if (result.handledByClientId !== owner)
              throw Error("Steer owner acknowledgement unknown");
            b.emitEvent("queue-steered", {
              threadId: id,
              messageId: message.id,
              ownerClientId: owner,
              turnId: result.result?.result?.turnId,
              requestId: result.requestId,
            });
            delete b.db.queueRecoveries[key];
            b.save();
            return {
              threadId: id,
              messageId: message.id,
              disposition: "steered",
              turnId: result.result?.result?.turnId,
            };
          } catch (e) {
            // No start-turn fallback or automatic replay after an uncertain send.
            return {
              threadId: id,
              disposition: "steer-unknown",
              draft,
              recoveryId: key,
              reason: e.message,
            };
          }
        }),
      ),
    );
  }
}
