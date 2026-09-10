import { renderUpdateVersions } from './update-view.mjs';

export class HelpUpdates {
  constructor({ $, api, backupDrafts }) {
    Object.assign(this, { $, api, backupDrafts });
    $("help-check-updates").onclick = () => this.action("check");
    $("help-install-update").onclick = () => this.action("install");
    $("help-automatic-updates").onchange = () =>
      this.action("settings", {
        automatic: $("help-automatic-updates").checked,
      });
    this.refresh();
    this.timer = setInterval(() => this.refresh(), 2500);
    window.addEventListener("pagehide", () => clearInterval(this.timer));
  }
  async refresh() {
    if (this.loading || this.acting) return;
    this.loading = true;
    const sequence = this.sequence;
    try {
      const state = await this.api("/api/updates");
      if (sequence === this.sequence) this.render(state);
    } catch {
      if (sequence !== this.sequence) return;
      this.$("help-update-status").textContent =
        "更新状态暂时不可用，正在重新连接…";
      this.$("help-install-update").disabled = true;
      this.$("help-automatic-updates").disabled = true;
    } finally {
      this.loading = false;
    }
  }
  render(state) {
    const $ = this.$;
    const view = renderUpdateVersions($("help-update-versions"), state);
    const { active, progress, label } = view;
    $("help-update-status").textContent = label;
    $("help-update-progress").hidden = !active;
    $("help-update-progress").value = progress;
    $("help-automatic-updates").checked = !!state.automatic;
    $("help-automatic-updates").disabled = !state.supported;
    $("help-check-updates").disabled = view.checkDisabled;
    $("help-install-update").disabled = view.installDisabled;
    $("help-install-update").textContent = view.installLabel;
    $("help-update-scope").textContent = state.platform === "android"
      ? "更新当前手机上的 App，安装需要 Android 系统确认。其他电脑可在各自的设备设置中更新。"
      : "更新当前 Windows 程序；其他电脑可在各自的设备设置中更新。";
    const notice = state.available || active;
    $("help").classList.toggle("has-update", !!notice);
    $("help").title = notice ? label + "，点击查看更新" : "帮助与软件更新";
    $("help").setAttribute("aria-label", $("help").title);
    $("help-download-progress").style.width = progress + "%";
    $("help-download-meter").setAttribute("aria-valuenow", String(progress));
    $("help-download-meter").setAttribute("aria-valuetext", label);
    $("help-download-percent").textContent = active ? `${progress}%` : "更新";
  }
  async action(action, body = {}) {
    if (this.acting) return;
    this.acting = true;
    this.sequence = (this.sequence || 0) + 1;
    this.$("help-check-updates").disabled = true;
    this.$("help-install-update").disabled = true;
    this.$("help-automatic-updates").disabled = true;
    this.$("help-update-error").textContent = "";
    try {
      if (action === "install") await this.backupDrafts();
      this.render(await this.api("/api/updates/" + action, body));
    } catch (e) {
      this.$("help-update-error").textContent = e.message;
    } finally {
      this.acting = false;
      this.refresh();
    }
  }
}
