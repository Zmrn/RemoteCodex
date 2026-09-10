import { renderUpdateVersions } from './update-view.mjs';

export function accessEndpoint(host, port) {
  return (host.includes(":") ? `[${host}]` : host) + ":" + port;
}
export function accessSummary(s) {
  const host = s.host || s.addresses?.[0];
  const state = s.listening
    ? "远程接入已开启：" + accessEndpoint(s.listening.address, s.listening.port)
    : s.error
      ? "远程接入未开放：" + s.error
      : "远程接入未开启，其他设备暂时无法连接。";
  return (
    state +
    "\n" +
    (host ? "本机 Tailscale IP：" + host : "未检测到本机 Tailscale IP") +
    "\n访问端口：" +
    s.port +
    (s.listening ? "（正在监听）" : "（尚未监听）") +
    (!s.listening
      ? "\n在这台电脑的接入设置中勾选允许其他设备连接，并保存。仅复制密钥不会开启接入。"
      : "\n请在控制端填写以上 IP、端口和这台电脑的访问密钥。")
  );
}
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
    this.renderUpdates({});
    $("update-status").textContent = "正在读取此设备的更新状态…";
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
    $("local-access-status").textContent = accessSummary(s);
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
    if (this.actingSequence === sequence || this.loadingSequence === sequence) return;
    this.loadingSequence = sequence;
    const request = this.updateRequest = (this.updateRequest || 0) + 1;
    try {
      const state = await this.updateApi();
      if (sequence === this.sequence && request === this.updateRequest) this.renderUpdates(state);
    } catch (error) {
      if (sequence === this.sequence && request === this.updateRequest) {
        this.$("update-status").textContent =
          "无法读取此设备的更新状态：" + error.message;
        this.$("automatic-updates").disabled = true;
        this.$("install-update").disabled = true;
      }
    } finally {
      if (this.loadingSequence === sequence) this.loadingSequence = null;
    }
  }
  renderUpdates(state) {
    const $ = this.$, view = renderUpdateVersions($("update-versions"), state);
    $("update-status").textContent =
      view.label +
      (state.result?.status === "rolled-back" ? " · 上次更新失败，已回退" : "");
    $("automatic-updates").checked = state.automatic;
    $("automatic-updates").disabled = !state.supported;
    $("check-updates").disabled = view.checkDisabled;
    $("install-update").disabled = view.installDisabled;
    $("install-update").textContent = view.installLabel;
    if (state.supported === false)
      $("update-status").textContent += " · 自动安装需要单 EXE 版本";
  }
  async updateAction(action, body = {}) {
    const sequence = this.sequence, agent = this.agent;
    if (!agent || this.actingSequence === sequence) return;
    this.actingSequence = sequence;
    this.updateRequest = (this.updateRequest || 0) + 1;
    for (const id of ["check-updates", "install-update", "automatic-updates"]) this.$(id).disabled = true;
    try {
      if (action === "install" && agent.kind === "local")
        await this.backupDrafts();
      if (sequence !== this.sequence) return;
      const state = await this.agentApi(agent.id, "/updates/" + action, body);
      if (sequence === this.sequence) this.renderUpdates(state);
    } catch (error) {
      if (sequence === this.sequence) this.fail(error);
    } finally {
      if (this.actingSequence === sequence) this.actingSequence = null;
      if (sequence === this.sequence) this.loadUpdates();
    }
  }
}
