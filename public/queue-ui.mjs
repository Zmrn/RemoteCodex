import { imageUrls } from "./image-input.mjs";
import { icon } from "./ui.mjs";
import { zoomableImage } from "./image-viewer.mjs";
const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
};
export class QueueUI {
  constructor({
    getContext,
    api,
    loadImage,
    journal,
    onChange,
    onError,
    onToast,
    restoreDraft,
    isDiscarded = () => false,
    discardRecovery,
    onRefresh = () => {},
  }) {
    Object.assign(this, {
      getContext,
      api,
      loadImage,
      journal,
      onChange,
      onError,
      onToast,
      restoreDraft,
      isDiscarded,
      discardRecovery,
      onRefresh,
    });
    this.root = document.getElementById("message-queue");
    this.busy = false;
    this.sequence = 0;
    this.current = null;
    this.lastRender = "";
    this.previewKey = null;
    this.previews = new Map();
    this.imageLoads = 0;
    this.refreshJob = null;
    document.addEventListener("pointerdown", (e) => {
      if (!e.target.closest(".queue-more"))
        this.root
          .querySelectorAll("details[open]")
          .forEach((n) => (n.open = false));
    });
    this.root.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        const d = e.target.closest("details[open]");
        if (d) {
          d.open = false;
          d.querySelector("summary").focus();
          e.stopPropagation();
        }
      }
    });
  }
  reset(unknown = false) {
    this.sequence++;
    this.refreshJob?.controller.abort();
    this.refreshJob = null;
    this.clearPreviews();
    this.current = unknown
      ? { unknown: true, messages: [], recoveries: [] }
      : null;
    this.lastRender = "";
    this.render();
  }
  refresh() {
    const c = this.getContext();
    if (!c.id || !c.connected) {
      this.reset();
      return Promise.resolve();
    }
    if (this.refreshJob?.key === c.key) {
      this.refreshJob.pending = true;
      return this.refreshJob.promise;
    }
    this.refreshJob?.controller.abort();
    const job = { key: c.key, seq: ++this.sequence, controller: new AbortController() };
    this.refreshJob = job;
    job.promise = (async () => {
      try {
        const result = await this.api(c.agent, `/threads/${c.id}/queue?images=multi-v1&previews=refs-v1`, undefined, { signal: job.controller.signal });
        if (job.seq !== this.sequence || c.key !== this.getContext().key) return;
        this.current = result;
      } catch {
        if (job.seq !== this.sequence || c.key !== this.getContext().key) return;
        this.current = { messages: [], recoveries: [], unknown: true };
      }
      this.render();
      this.onRefresh(c);
    })().finally(() => {
      if (this.refreshJob !== job) return;
      this.refreshJob = null;
      if (job.pending) this.refresh();
    });
    return job.promise;
  }
  clearPreviews() {
    for (const entry of this.previews.values()) this.releasePreview(entry);
    this.previews.clear();
    this.previewKey = null;
  }
  releasePreview(entry) {
    entry.controller?.abort();
    if (entry.url) URL.revokeObjectURL(entry.url);
    entry.targets.clear();
  }
  preview(ref, context) {
    let entry = this.previews.get(ref.id);
    if (!entry) {
      entry = { ref, context, targets: new Set(), state: "queued" };
      this.previews.set(ref.id, entry);
    }
    const slot = el("span", "queue-image-slot");
    entry.targets.add(slot);
    this.paintPreview(entry, slot);
    return slot;
  }
  paintPreview(entry, slot) {
    slot.replaceChildren();
    slot.removeAttribute("title");
    slot.removeAttribute("aria-label");
    slot.dataset.state = entry.state;
    slot.setAttribute("aria-busy", String(["queued", "loading"].includes(entry.state)));
    if (entry.state === "ready") {
      const img = el("img", "queue-image");
      img.src = entry.url;
      img.alt = "排队图片";
      img.onerror = () => {
        if (this.previews.get(entry.ref.id) !== entry || entry.state !== "ready") return;
        URL.revokeObjectURL(entry.url);
        entry.url = null;
        entry.state = "failed";
        for (const target of entry.targets) this.paintPreview(entry, target);
      };
      zoomableImage(img, entry.ref.name);
      slot.append(img);
    } else if (entry.state === "failed") {
      const retry = el("button", "queue-image-retry", "↻");
      retry.type = "button";
      retry.title = "图片加载失败，点击重试";
      retry.setAttribute("aria-label", retry.title);
      retry.onclick = () => {
        entry.state = "queued";
        for (const target of entry.targets) this.paintPreview(entry, target);
        this.pumpImages();
      };
      slot.append(retry);
    } else {
      slot.title = "图片加载中";
      slot.setAttribute("aria-label", "图片加载中");
      slot.append(icon("image"));
    }
  }
  pumpImages() {
    // Limit preview traffic; queue metadata and explicit actions remain independent.
    for (const entry of this.previews.values()) {
      if (this.imageLoads >= 2) break;
      if (entry.state !== "queued") continue;
      entry.state = "loading";
      entry.controller = new AbortController();
      this.imageLoads++;
      Promise.resolve().then(() => this.loadImage(entry.context, entry.ref, entry.controller.signal))
        .then(blob => {
          if (entry.controller.signal.aborted || this.previews.get(entry.ref.id) !== entry) return;
          entry.url = URL.createObjectURL(blob);
          entry.state = "ready";
        }).catch(() => {
          if (!entry.controller.signal.aborted) entry.state = "failed";
        }).finally(() => {
          this.imageLoads--;
          if (this.previews.get(entry.ref.id) === entry)
            for (const target of entry.targets) this.paintPreview(entry, target);
          this.pumpImages();
        });
    }
  }
  render() {
    const c = this.getContext(),
      q = this.current;
    const signature = JSON.stringify([
      c.key,
      c.writable, c.steerSupported, c.canRecover,
      c.connected,
      c.active,
      c.recoveryId,
      this.busy,
      q?.revision,
      q?.recoveries,
      q?.unknown,
      q?.confirmed,
      (q?.recoveries ?? []).map(r => this.isDiscarded(c, r.recoveryId)),
    ]);
    if (signature === this.lastRender) return;
    this.lastRender = signature;
    if (this.previewKey !== c.key || !c.connected || q?.unknown) this.clearPreviews();
    this.previewKey = c.key;
    for (const entry of this.previews.values()) entry.targets.clear();
    const messages = q?.messages ?? [],
      recoveries = (q?.recoveries ?? []).filter(
        (r) => r.recoveryId !== c.recoveryId && !this.isDiscarded(c, r.recoveryId),
      );
    this.root.hidden =
      !c.id || (!messages.length && !recoveries.length && !q?.unknown);
    this.root.replaceChildren();
    if (this.root.hidden) { this.clearPreviews(); return; }
    if (q?.unknown) {
      this.root.append(
        el("div", "queue-notice", "队列状态未知 · 重新连接后恢复"),
      );
      return;
    }
    this.root.title = q.confirmed ? "已与官方队列同步" : "从官方保存的队列读取";
    for (const m of messages) {
      const row = el("div", "queued-message");
      row.dataset.messageId = m.id;
      row.append(icon("queue"));
      const images = el("span", "queue-images");
      for (const ref of m.imageRefs ?? []) images.append(this.preview(ref, c));
      for (const url of imageUrls(m.imageDataUrls ?? m.imageDataUrl)) {
        const img = el("img", "queue-image");
        img.src = url;
        img.alt = "排队图片";
        zoomableImage(img, "排队图片.png");
        images.append(img);
      }
      if (images.childElementCount) row.append(images);
      const text = el("span", "queue-text", m.text);
      text.title = m.text;
      row.append(text);
      const steer = el("button", "queue-steer");
      steer.type = "button";
      steer.append(icon("steer"), el("span", "", "调整方向"));
      steer.setAttribute("aria-label", "调整方向：" + m.text);
      steer.title = m.restriction ?? "立即发送到当前正在运行的任务";
      steer.disabled =
        this.busy || !c.writable || c.steerSupported === false || !c.connected || !c.active || !m.editable;
      steer.onclick = () => this.act("steer", m).catch(this.onError);
      row.append(steer);
      const remove = el("button", "icon-button queue-delete");
      remove.type = "button";
      remove.append(icon("trash"));
      remove.title = "删除排队消息";
      remove.setAttribute("aria-label", "删除排队消息");
      remove.disabled = this.busy || !c.writable || !c.connected;
      remove.onclick = () => this.act("delete", m).catch(this.onError);
      row.append(remove);
      const menu = el("details", "queue-more"),
        summary = el("summary", "icon-button");
      summary.append(icon("new"));
      summary.title = "编辑排队消息";
      summary.setAttribute("aria-label", "排队消息选项");
      const edit = el("button", "queue-edit", "编辑消息");
      edit.type = "button";
      edit.prepend(icon("new"));
      edit.disabled = this.busy || !c.writable || !c.connected || !m.editable;
      edit.title = m.restriction ?? "从队列取回输入框";
      edit.onclick = () => {
        menu.open = false;
        this.act("take", m).catch(this.onError);
      };
      menu.append(summary, edit);
      summary.addEventListener("click", () => {
        const rect = summary.getBoundingClientRect();
        edit.style.left =
          Math.max(8, Math.min(innerWidth - 168, rect.right - 160)) + "px";
        edit.style.top = Math.max(8, rect.top - 45) + "px";
      });
      row.append(menu);
      if (m.pausedReason) {
        row.classList.add("queue-paused");
        text.title += "\n暂停：" + m.pausedReason;
      }
      this.root.append(row);
    }
    for (const r of recoveries) {
      const row = el("div", "queue-recovery");
      row.dataset.recoveryId = r.recoveryId;
      row.append(
        el(
          "span",
          "",
          r.state === "draft"
            ? "已取回草稿：" + r.draft.text
            : "提交结果待核对：" + r.draft.text,
        ),
      );
      const b = el(
        "button",
        "subtle",
        r.state === "draft" ? "继续编辑" : "状态未知",
      );
      b.type = "button";
      b.disabled = r.state !== "draft" || !r.draft.editable || this.busy || !(c.canRecover ?? c.writable) || !c.connected;
      b.onclick = () =>
        this.restoreRecovery(r, c).catch(this.onError);
      row.append(b);
      if (r.state === "draft" && this.discardRecovery) {
        const remove = el("button", "icon-button queue-discard");
        remove.type = "button";
        remove.title = "删除已取回草稿";
        remove.setAttribute("aria-label", remove.title);
        remove.append(icon("trash"));
        remove.disabled = this.busy;
        remove.onclick = () => this.discardRecovery(r.recoveryId, c).catch(this.onError);
        row.append(remove);
      }
      this.root.append(row);
    }
    for (const [key, entry] of this.previews) {
      if (entry.targets.size) continue;
      this.releasePreview(entry);
      this.previews.delete(key);
    }
    this.pumpImages();
  }
  async restoreRecovery(recovery, c) {
    if (this.busy || !c.connected || !(c.canRecover ?? c.writable)) return;
    if (c.hasDraft) { this.onToast("输入框已有草稿，请先发送或清空，再取回排队消息"); return; }
    this.busy = true;
    this.onChange();
    this.render();
    try {
      const draft = recovery.draft.imageRefs
        ? (await this.api(c.agent, `/threads/${c.id}/queue?images=multi-v1&recoveryId=${encodeURIComponent(recovery.recoveryId)}`)).draft
        : recovery.draft;
      await this.restoreDraft(draft, recovery.recoveryId, c);
    } finally {
      this.busy = false;
      this.onChange();
      this.render();
    }
  }
  async enqueue(prompt, images, key, recoveryId, c) {
    const q = await this.api(c.agent, `/threads/${c.id}/queue?images=multi-v1&previews=refs-v1`);
    return this.api(c.agent, `/threads/${c.id}/queue`, {
      action: "enqueue",
      prompt,
      ...images,
      revision: q.revision,
      requestId: key,
      recoveryId,
    });
  }
  async act(action, message) {
    if (action === "steer" && this.getContext().steerSupported === false) return;
    const c = this.getContext(),
      revision = this.current?.revision;
    if (this.busy || !c.writable || !c.connected) return;
    if (action === "take" && c.hasDraft) {
      this.onToast("输入框已有草稿，请先发送或清空，再取回排队消息");
      return;
    }
    this.busy = true;
    this.onChange();
    this.render();
    try {
      const payload = { action, messageId: message.id };
      const j = await this.journal(c.agent, c.id, "queue-" + action, payload);
      const r = await this.api(c.agent, `/threads/${c.id}/queue`, {
        ...payload,
        revision,
        requestId: j.id,
      });
      if (r.status !== "accepted")
        throw Error("队列操作结果未知，请刷新核对；不会自动重试");
      const result = r.result;
      if (result.disposition === "steer-unknown")
        throw Error("调整方向结果未知，消息已保留供核对；不会再次发送");
      j.clear();
      if (result.disposition === "draft")
        await this.restoreDraft(result.draft, result.recoveryId, c);
      else if (result.disposition === "steered")
        this.onToast("已调整当前任务方向");
      else this.onToast("已删除排队消息");
    } finally {
      this.busy = false;
      this.onChange();
      await this.refresh();
    }
  }
}
