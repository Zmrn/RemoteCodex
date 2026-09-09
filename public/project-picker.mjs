import { icon } from "./ui.mjs";

export const localProjects = projects => projects.filter(p =>
  (p.projectKind ?? p.kind) === "local" && (!p.hostId || p.hostId === "local"));

export class ProjectPicker {
  constructor({ $, changed }) {
    this.$ = $;
    this.changed = changed;
    this.choices = new Map();
    this.context = {};
    this.trigger = $("project-display");
    this.menu = $("project-menu");
    this.search = $("project-search");
    let wasOpen = false;
    this.trigger.onpointerdown = () => { wasOpen = this.menu.matches(":popover-open"); };
    this.trigger.onclick = e => { if (e.detail && wasOpen) this.close(true); else this.toggle(); wasOpen = false; };
    this.search.oninput = () => this.renderMenu();
    this.menu.addEventListener("toggle", () => {
      this.trigger.setAttribute("aria-expanded", String(this.menu.matches(":popover-open")));
    });
    this.menu.addEventListener("keydown", e => {
      if (e.key === "Escape") { e.preventDefault(); this.close(true); }
      if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key) ||
          (e.target === this.search && ["Home", "End"].includes(e.key))) return;
      const options = [...this.menu.querySelectorAll("button:not(:disabled)")];
      if (!options.length) return;
      e.preventDefault();
      const index = options.indexOf(document.activeElement);
      const next = e.key === "Home" ? 0 : e.key === "End" ? options.length - 1
        : (index + (e.key === "ArrowDown" ? 1 : -1) + options.length) % options.length;
      options[next].focus();
    });
    window.addEventListener("resize", () => this.position());
    window.visualViewport?.addEventListener("resize", () => this.position());
    window.visualViewport?.addEventListener("scroll", () => this.position());
  }
  restore(rows) {
    if (!Array.isArray(rows)) return;
    this.choices = new Map(rows.filter(row => Array.isArray(row) && typeof row[0] === "string" &&
      (row[1] === null || (typeof row[1]?.projectId === "string" && row[1]?.environment === "local"))));
  }
  snapshot() { return [...this.choices]; }
  selection() { return this.choices.get(this.context.agentId) ?? null; }
  prefer(projectId) {
    if (projectId && localProjects(this.context.projects ?? []).some(p => p.projectId === projectId))
      this.choices.set(this.context.agentId, { projectId, environment: "local" });
  }
  reason() {
    if (this.context.mode !== "codex" || !this.context.fresh || !this.selection()) return "";
    if (!this.context.status?.projectCreation?.local) return "目标设备尚不支持项目新建，请先更新该设备";
    if (!localProjects(this.context.projects).some(p => p.projectId === this.selection().projectId))
      return "所选项目已不可用，请重新选择项目或无项目";
    return "";
  }
  update(context) {
    const old = this.context;
    this.context = context;
    if (old.agentId !== context.agentId || old.mode !== context.mode || old.fresh !== context.fresh ||
        !context.status.connected || context.busy) this.close();
    this.$("creation-context").hidden = context.mode !== "codex" || !context.fresh;
    const selected = this.selection();
    const project = localProjects(context.projects).find(p => p.projectId === selected?.projectId);
    this.$("project-name").textContent = project?.label ?? project?.name ?? project?.path ?? (selected ? "所选项目不可用" : "无项目");
    this.trigger.disabled = !context.status.connected || context.busy || context.booting;
    this.trigger.title = this.reason() || project?.path || "选择当前设备的项目";
    this.$("project-location").hidden = !selected;
    this.$("project-location").title = "使用所选项目的当前工作目录和分支";
    this.$("project-hint").textContent = this.reason() || (selected ? "在所选项目的当前目录和分支中开始" : "在独立目录中开始，不归入项目");
    if (this.menu.matches(":popover-open")) this.renderMenu();
  }
  close(focus = false) {
    if (this.menu.matches(":popover-open")) this.menu.hidePopover();
    if (focus && !this.trigger.disabled) this.trigger.focus();
  }
  toggle() {
    if (this.menu.matches(":popover-open")) { this.close(true); return; }
    if (this.trigger.disabled) return;
    this.search.value = "";
    this.renderMenu();
    this.menu.showPopover();
    this.position();
    this.search.focus();
  }
  renderMenu() {
    const list = this.$("project-options"), context = this.context;
    const term = this.search.value.trim().toLocaleLowerCase();
    list.replaceChildren();
    const add = (id, label, description, enabled = true) => {
      const button = document.createElement("button");
      button.type = "button"; button.className = "setting-option";
      button.dataset.project = id ?? "";
      button.setAttribute("role", "menuitemradio");
      button.setAttribute("aria-checked", String((this.selection()?.projectId ?? null) === id));
      button.disabled = !enabled;
      button.append(icon("folder"));
      const copy = document.createElement("span"), title = document.createElement("span"), detail = document.createElement("small");
      copy.className = "setting-option-copy"; title.textContent = label; detail.textContent = description;
      copy.append(title, detail); button.append(copy);
      if (button.getAttribute("aria-checked") === "true") button.append(icon("check"));
      button.onclick = () => {
        if (this.context.agentId !== context.agentId || this.context.mode !== "codex" ||
            !this.context.fresh || this.context.busy || !this.context.status.connected) return;
        this.choices.set(context.agentId, id ? { projectId: id, environment: "local" } : null);
        this.close(true); this.changed();
      };
      list.append(button);
    };
    add(null, "无项目", "使用独立目录");
    for (const p of localProjects(context.projects)) {
      if (term && ![p.label, p.name, p.path].filter(Boolean).join(" ").toLocaleLowerCase().includes(term)) continue;
      add(p.projectId, p.label ?? p.name ?? p.path, p.path ?? "本地项目", context.status.projectCreation?.local === true);
    }
    this.$("project-menu-note").textContent = !context.status.projectCreation?.local
      ? "目标设备需要更新后才能在项目中新建"
      : "来自当前设备的官方 Codex · 使用项目当前目录和分支";
    this.position();
  }
  position() {
    if (!this.menu.matches(":popover-open")) return;
    const v = window.visualViewport, left = v?.offsetLeft ?? 0, top = v?.offsetTop ?? 0;
    const width = v?.width ?? innerWidth, height = v?.height ?? innerHeight;
    const anchor = this.trigger.getBoundingClientRect();
    this.menu.style.width = Math.min(400, width - 16) + "px";
    const above = Math.max(0, anchor.top - top - 16), below = Math.max(0, top + height - anchor.bottom - 16);
    const up = above >= Math.min(this.menu.scrollHeight, 320) || above >= below;
    this.menu.style.maxHeight = Math.max(72, up ? above : below) + "px";
    const box = this.menu.getBoundingClientRect();
    this.menu.style.left = Math.max(left + 8, Math.min(anchor.left, left + width - box.width - 8)) + "px";
    this.menu.style.top = Math.max(top + 8, Math.min(up ? anchor.top - box.height - 8 : anchor.bottom + 8, top + height - box.height - 8)) + "px";
  }
}
