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
    try {
      this.render(await this.api("/api/updates"));
    } catch {
      this.$("help-update-status").textContent =
        "更新状态暂时不可用，正在重新连接…";
    } finally {
      this.loading = false;
    }
  }
  render(state) {
    const $ = this.$;
    const phase = state.phase;
    const active = ["downloading", "waiting", "installing"].includes(phase);
    const progress = ["waiting", "installing"].includes(phase)
      ? 100
      : Math.max(0, Math.min(100, Number(state.progress) || 0));
    const labels = {
      idle: "尚未检查更新",
      checking: "正在检查更新…",
      current: "已是最新版本",
      available: "发现新版本 " + state.latestVersion,
      downloading: `正在下载 ${state.latestVersion} · ${progress}%`,
      waiting: "下载完成，可立即安装；自动安装正在等待草稿或编辑结束",
      installing: "正在安装，稍后自动重新打开",
      error: state.error || "更新失败，请重试",
    };
    const label = labels[phase] || "更新状态未知";
    const displayLabel = state.platform === "android" && phase === "waiting"
      ? "下载完成，点击安装后由 Android 系统确认"
      : label;
    $("help-update-status").textContent =
      `当前版本 ${state.currentVersion ?? "未知"} · ${displayLabel}`;
    $("help-update-progress").hidden = !active;
    $("help-update-progress").value = progress;
    $("help-automatic-updates").checked = !!state.automatic;
    $("help-automatic-updates").disabled = !state.supported;
    $("help-check-updates").disabled = [
      "checking",
      "downloading",
      "installing",
    ].includes(phase);
    $("help-install-update").disabled =
      !state.supported ||
      !state.available ||
      ["downloading", "installing"].includes(phase);
    $("help-install-update").textContent =
      phase === "waiting" ? "立即安装" : "安装更新";
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
    this.$("help-update-error").textContent = "";
    try {
      if (action === "install") await this.backupDrafts();
      this.render(await this.api("/api/updates/" + action, body));
    } catch (e) {
      this.$("help-update-error").textContent = e.message;
    } finally {
      this.acting = false;
    }
  }
}
