export class DeviceSettings {
  constructor({ $, api, agentApi, toast, backupDrafts }) {
    Object.assign(this, { $, api, agentApi, toast, backupDrafts });
    $("refresh-local-access").onclick = () =>
      this.loadAccess().catch((e) => this.fail(e));
    $("generate-local-key").onclick = () => {
      $("local-key").value = Array.from(
        crypto.getRandomValues(new Uint8Array(32)),
        (n) => n.toString(16).padStart(2, "0"),
      ).join("");
      $("local-key").type = "password";
      toast("已生成新密钥，保存设备后生效");
    };
    $("copy-local-address").onclick = () =>
      this.copy(
        ($("local-host").value.includes(":")
          ? "[" + $("local-host").value + "]"
          : $("local-host").value) +
          ":" +
          $("local-port").value,
      );
    $("copy-local-key").onclick = async () => {
      const sequence = this.sequence;
      try {
        const key =
          $("local-key").value || (await api("/api/pairing-key", {})).key;
        if (sequence !== this.sequence || !$("agent-dialog").open) return;
        $("local-key").value = key;
        $("local-key").type = "text";
        await this.copy(key);
      } catch (e) {
        this.fail(e);
      }
    };
    $("check-updates").onclick = () => this.updateAction("check");
    $("install-update").onclick = () => this.updateAction("install");
    $("automatic-updates").onchange = () =>
      this.updateAction("settings", {
        automatic: $("automatic-updates").checked,
      });
  }
  fail(error) {
    this.$("agent-form-error").textContent = error.message;
  }
  async copy(value) {
    try {
      await navigator.clipboard.writeText(value);
      this.toast("已复制");
    } catch {
      this.toast("复制失败，可选中文本手动复制");
    }
  }
  open(agent) {
    this.close();
    this.agent = agent;
    this.sequence = (this.sequence || 0) + 1;
    const local = agent?.kind === "local",
      $ = this.$;
    $("local-access-fields").hidden = !local;
    $("update-fields").hidden = !agent;
    $("local-key").value = "";
    $("local-key").type = "password";
    this.loaded = false;
    if (local) this.loadAccess().catch((e) => this.fail(e));
    if (agent) {
      this.loadUpdates();
      this.timer = setInterval(() => this.loadUpdates(), 2500);
    }
  }
  close() {
    clearInterval(this.timer);
    this.sequence = (this.sequence || 0) + 1;
    this.$("local-key").value = "";
  }
  async loadAccess() {
    const sequence = this.sequence,
      s = await this.api("/api/local-access"),
      $ = this.$;
    if (sequence !== this.sequence) return;
    this.loaded = true;
    $("local-host").replaceChildren(
      ...s.addresses.map((address) => new Option(address, address)),
    );
    if (!s.addresses.length)
      $("local-host").add(new Option("未检测到 Tailscale IP", ""));
    if (s.host && !s.addresses.includes(s.host))
      $("local-host").add(new Option(s.host + "（当前不可用）", s.host));
    $("local-host").value = s.host || s.addresses[0] || "";
    $("local-port").value = s.port;
    $("local-enabled").checked = s.enabled;
    $("copy-local-address").disabled = !s.addresses.includes(
      $("local-host").value,
    );
    $("local-key").placeholder = s.hasKey
      ? "已设置，留空保持原密钥"
      : "可生成密钥，或输入自定义密钥";
    $("local-access-status").textContent = s.listening
      ? `已开放 ${s.listening.address}:${s.listening.port}`
      : s.error
        ? "未开放：" + s.error
        : "当前仅本机可访问。勾选允许连接并保存后开放。";
  }
  async saveLocal() {
    if (this.agent?.kind !== "local") return;
    if (!this.loaded) throw Error("请等待本机接入信息读取完成");
    const $ = this.$;
    await this.api("/api/local-access", {
      host: $("local-host").value,
      port: Number($("local-port").value),
      enabled: $("local-enabled").checked,
      key: $("local-key").value.trim(),
    });
  }
  updateApi(route = "", body) {
    return this.agentApi(this.agent.id, "/updates" + route, body);
  }
  async loadUpdates() {
    const sequence = this.sequence;
    try {
      const state = await this.updateApi();
      if (sequence === this.sequence) this.renderUpdates(state);
    } catch {
      if (sequence === this.sequence) {
        this.$("update-status").textContent =
          "此设备暂时无法检查更新；旧版需先手动安装一次支持更新的版本。";
        this.$("automatic-updates").disabled = true;
        this.$("install-update").disabled = true;
      }
    }
  }
  renderUpdates(state) {
    const $ = this.$,
      names = {
        idle: "尚未检查",
        checking: "正在检查",
        current: "已是最新版",
        available: "发现新版本",
        downloading: `正在下载 ${state.progress}%`,
        waiting: "已下载，等待草稿发送或设置编辑结束",
        installing: "正在安装，连接将自动恢复",
        error: state.error,
      };
    $("update-status").textContent =
      `当前 ${state.currentVersion} · ${names[state.phase] || state.phase}` +
      (state.available ? ` ${state.latestVersion}` : "") +
      (state.result?.status === "rolled-back" ? " · 上次更新失败，已回退" : "");
    $("automatic-updates").checked = state.automatic;
    $("automatic-updates").disabled = !state.supported;
    $("check-updates").disabled = [
      "checking",
      "downloading",
      "installing",
    ].includes(state.phase);
    $("install-update").disabled =
      !state.supported ||
      !state.available ||
      ["downloading", "installing"].includes(state.phase);
    if (!state.supported)
      $("update-status").textContent += " · 自动安装需要单 EXE 版本";
  }
  async updateAction(action, body = {}) {
    try {
      if (action === "install" && this.agent?.kind === "local")
        await this.backupDrafts();
      const sequence = this.sequence,
        state = await this.updateApi("/" + action, body);
      if (sequence === this.sequence) this.renderUpdates(state);
    } catch (error) {
      this.fail(error);
    }
  }
}
