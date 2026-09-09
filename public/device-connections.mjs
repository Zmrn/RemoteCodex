export class DeviceConnections {
  constructor({ $, api }) {
    Object.assign(this, { $, api });
    $("device-connections-panel").hidden = false;
    $("keep-device-connections").onchange = () => this.toggle();
    this.refresh();
    this.timer = setInterval(() => this.refresh(), 5000);
    window.addEventListener("pagehide", () => clearInterval(this.timer));
  }
  render(state) {
    this.$("keep-device-connections").checked = !!state.enabled;
    this.$("device-connections-status").textContent = state.detail + (state.running ? ` · ${state.connected} / ${state.devices} 台已连接` : "");
  }
  async refresh() {
    if (this.busy) return;
    this.busy = true;
    this.$("keep-device-connections").disabled = true;
    try { this.render(await this.api("/api/device-connections")); }
    catch { this.$("device-connections-status").textContent = "设备同步状态暂不可用"; }
    finally { this.busy = false; this.$("keep-device-connections").disabled = false; }
  }
  async toggle() {
    const control = this.$("keep-device-connections");
    if (this.busy) { await this.refresh(); return; }
    this.busy = true; control.disabled = true;
    try { this.render(await this.api("/api/device-connections", { enabled: control.checked })); }
    catch (e) { control.checked = !control.checked; this.$("device-connections-status").textContent = e.message; }
    finally { this.busy = false; control.disabled = false; }
  }
}
