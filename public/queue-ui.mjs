import { icon } from "./ui.mjs";
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
    journal,
    onChange,
    onError,
    onToast,
    restoreDraft,
  }) {
    Object.assign(this, {
      getContext,
      api,
      journal,
      onChange,
      onError,
      onToast,
      restoreDraft,
    });
    this.root = document.getElementById("message-queue");
    this.busy = false;
    this.sequence = 0;
    this.current = null;
    this.lastRender = "";
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
    this.current = unknown
      ? { unknown: true, messages: [], recoveries: [] }
      : null;
    this.lastRender = "";
    this.render();
  }
  async refresh() {
    const c = this.getContext(),
      seq = ++this.sequence;
    if (!c.id || !c.connected) {
      this.current = null;
      this.render();
      return;
    }
    try {
      const result = await this.api(c.agent, `/threads/${c.id}/queue`);
      if (seq !== this.sequence || c.key !== this.getContext().key) return;
      this.current = result;
    } catch {
      if (seq !== this.sequence) return;
      this.current = { messages: [], recoveries: [], unknown: true };
    }
    this.render();
  }
  render() {
    const c = this.getContext(),
      q = this.current;
    const signature = JSON.stringify([
      c.key,
      c.writable,
      c.connected,
      c.active,
      c.recoveryId,
      this.busy,
      q?.revision,
      q?.recoveries,
      q?.unknown,
      q?.confirmed,
    ]);
    if (signature === this.lastRender) return;
    this.lastRender = signature;
    const messages = q?.messages ?? [],
      recoveries = (q?.recoveries ?? []).filter(
        (r) => r.recoveryId !== c.recoveryId,
      );
    this.root.hidden =
      !c.id || (!messages.length && !recoveries.length && !q?.unknown);
    this.root.replaceChildren();
    if (this.root.hidden) return;
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
      if (m.imageDataUrl) {
        const img = el("img", "queue-image");
        img.src = m.imageDataUrl;
        img.alt = "排队图片";
        row.append(img);
      }
      const text = el("span", "queue-text", m.text);
      text.title = m.text;
      row.append(text);
      const steer = el("button", "queue-steer");
      steer.type = "button";
      steer.append(icon("steer"), el("span", "", "调整方向"));
      steer.setAttribute("aria-label", "调整方向：" + m.text);
      steer.title = m.restriction ?? "立即发送到当前正在运行的任务";
      steer.disabled =
        this.busy || !c.writable || !c.connected || !c.active || !m.editable;
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
      b.disabled = r.state !== "draft" || this.busy || !c.writable;
      b.onclick = () =>
        this.restoreDraft(r.draft, r.recoveryId, c).catch(this.onError);
      row.append(b);
      this.root.append(row);
    }
  }
  async enqueue(prompt, imageDataUrl, key, recoveryId, c) {
    const q = await this.api(c.agent, `/threads/${c.id}/queue`);
    return this.api(c.agent, `/threads/${c.id}/queue`, {
      action: "enqueue",
      prompt,
      ...(imageDataUrl ? { imageDataUrl } : {}),
      revision: q.revision,
      requestId: key,
      recoveryId,
    });
  }
  async act(action, message) {
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
