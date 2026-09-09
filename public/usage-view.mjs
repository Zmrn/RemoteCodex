// The main Codex bucket takes precedence over separate model buckets. Within
// each bucket, the five-hour window comes first, including an unknown value.
export function usageWindows(data) {
  const rows = [];
  for (const [field, duration] of [["fiveHour", 300], ["weekly", 10080]]) {
    if (!Array.isArray(data?.[field])) continue;
    for (const row of data[field]) {
      if (!row || typeof row.limitId !== "string") continue;
      const value = row.remainingPercent;
      rows.push({ ...row, windowDurationMins: duration,
        label: row.label || (row.limitId === "codex" ? "Codex" : row.limitId),
        remainingPercent: typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : null });
    }
  }
  return rows.sort((a, b) => Number(b.limitId === "codex") - Number(a.limitId === "codex") ||
    a.limitId.localeCompare(b.limitId) || a.windowDurationMins - b.windowDurationMins);
}
export const planName = data => ({ plus: "Plus", pro: "Pro", free: "Free", team: "Team", business: "Business", enterprise: "Enterprise", edu: "Edu" })[data?.planType] ?? "";
const durationName = row => row.windowDurationMins === 300 ? "5h 额度" : "周额度";
const percent = value => new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 1 }).format(value) + "%";
export function resetCountdown(resetsAt, now = Date.now()) {
  if (typeof resetsAt !== "number" || !Number.isFinite(resetsAt * 1000) || resetsAt <= 0 || !Number.isFinite(now)) return "";
  let seconds = Math.max(0, Math.ceil((resetsAt * 1000 - now) / 1000));
  if (!seconds) return "已到重置时间，等待刷新";
  const days = Math.floor(seconds / 86400); seconds %= 86400;
  const hours = Math.floor(seconds / 3600); seconds %= 3600;
  const minutes = Math.floor(seconds / 60); seconds %= 60;
  return `剩余 ${days}天${hours}小时${minutes}分${seconds}秒`;
}
// Update text only: preserve menu scroll/focus and use wall time after sleep.
export function updateQuotaCountdowns(root, now = Date.now()) {
  for (const node of root.querySelectorAll("[data-usage-reset]"))
    node.textContent = resetCountdown(Number(node.dataset.usageReset), now);
}
export function quotaSummary(data, state, connected) {
  if (!connected) return "额度 · 未知";
  const main = usageWindows(data).find(row => row.limitId === "codex");
  const label = main ? (main.limitId === "codex" ? "" : main.label + " ") + durationName(main) : "额度";
  if (state === "available" && main?.remainingPercent != null) return label + "剩余 " + percent(main.remainingPercent);
  return label + (state === "loading" ? " · 读取中…" : " · 未知");
}

export function renderQuota({ $, data, state, connected, reason = "" }) {
  const details = $("usage-details"), footer = $("agent-quota");
  details.replaceChildren();
  const valid = state === "available" && connected;
  const rows = usageWindows(data);
  footer.textContent = quotaSummary(data, state, connected);
  const observed = new Date(data?.observedAt);
  $("usage-observed").textContent = valid && Number.isFinite(observed.getTime())
    ? "官方实时接口 · " + observed.toLocaleTimeString("zh-CN") + " 读取" : "";
  $("usage-account-note").textContent = (connected && planName(data) ? planName(data) + " · " : "") + "所选设备登录账号的共享额度";
  footer.title = valid ? $("usage-account-note").textContent + "；" + $("usage-observed").textContent
    : reason || "正在读取官方账号额度";
  const node = (tag, className, text) => {
    const n = document.createElement(tag); n.className = className;
    if (text !== undefined) n.textContent = text;
    return n;
  };
  if (!valid) {
    details.append(node("div", "usage-unknown", state === "loading" ? "正在读取…" : reason || "官方未提供可用的额度"));
    return;
  }
  for (const row of rows) {
    const container = node("div", "usage-row"), line = node("div", "usage-value");
    container.dataset.limitId = row.limitId; container.dataset.duration = row.windowDurationMins;
    const label = row.label + " · " + durationName(row);
    line.append(node("span", "", label), node("strong", "", row.remainingPercent === null ? "未知" : percent(row.remainingPercent)));
    container.append(line);
    if (row.remainingPercent !== null) {
      const bar = document.createElement("progress"); bar.max = 100; bar.value = row.remainingPercent;
      bar.setAttribute("aria-label", label + "剩余"); container.append(bar);
    }
    if (typeof row.resetsAt === "number" && row.resetsAt > 0) {
      const reset = new Date(row.resetsAt * 1000);
      if (Number.isFinite(reset.getTime())) {
        const resetLine = node("div", "usage-reset", reset.toLocaleString("zh-CN", {
          month: "long", day: "numeric", hour: "2-digit", minute: "2-digit",
        }) + " 重置 · ");
        const countdown = node("span", "usage-countdown", resetCountdown(row.resetsAt));
        countdown.dataset.usageReset = row.resetsAt;
        resetLine.append(countdown);
        container.append(resetLine);
      }
    }
    details.append(container);
  }
  if (data?.schemaVersion !== 2) details.append(node("p", "usage-note", "目标设备目前只返回周额度；更新目标设备后可读取 5h 额度"));
}
