import { icon, markdown } from "./ui.mjs";
import { QueueUI } from "./queue-ui.mjs";
import { DeviceSettings } from "./device-settings.mjs";
import { QuestionsUI } from "./questions-ui.mjs";
import { questionReply, userContent } from "./message-content.mjs";
import {
  windowId,
  saveRecovery,
  readRecovery,
  clearRecovery,
} from "./update-recovery.mjs";
const $ = (id) => document.getElementById(id),
  csrf = document.querySelector("meta[name=bridge-csrf]").content;
let agents = [],
  agentId = "local",
  selected = null,
  generation = 0,
  readSequence = 0,
  status = {},
  taskData = null,
  projects = [],
  threads = [],
  turns = [],
  cursor = null,
  editing = null,
  streamAbort = null,
  readTimer = null,
  busy = new Set(),
  draft = new Map(),
  connectionStates = new Map(),
  viewEpoch = 0,
  routeHistory = [],
  routeIndex = -1,
  attachmentUrl = null;
let liveSettingsState = null,
  settingsTarget = null,
  pendingSettings = new Map(),
  booting = true;
let usageData = null,
  usageState = "loading",
  usageReason = "",
  usageSequence = 0,
  usagePending = false,
  usageFetchedAt = 0;
const sidebarStates = new Map();
let sidebarSequence = 0,
  sidebarPolling = false;
const currentAgent = () => agents.find((a) => a.id === agentId);
const endpoint = (a) =>
  a.kind === "local"
    ? "本机直连 · " + a.host
    : (a.host.includes(":") ? "[" + a.host + "]" : a.host) + ":" + a.port;
const base = (id) => "/api/agents/" + encodeURIComponent(id) + "/bridge";
const taskKey = (a = agentId, t = selected) => a + ":" + t;
const takenDrafts = new Map();
const deviceSettings = new DeviceSettings({
  $,
  api,
  agentApi,
  toast,
  backupDrafts,
});
async function backupDrafts() {
  saveDraft();
  await saveRecovery({
    agent: agentId,
    thread: selected,
    drafts: [...draft],
    taken: [...takenDrafts],
    settings: [...pendingSettings],
    prompt: $("prompt").value,
    file: $("image").files[0] ?? null,
  });
}
window.remoteCodexSaveDrafts = backupDrafts;
let queueWritable = false;
const queueUI = new QueueUI({
  getContext: () => ({
    agent: agentId,
    id: selected,
    key: taskKey(),
    connected: !!status.connected,
    writable: queueWritable,
    active: taskData?.thread?.status?.type === "active",
    hasDraft: !!$("prompt").value.trim() || !!$("image").files[0],
    recoveryId: takenDrafts.get(taskKey())?.recoveryId,
  }),
  api: agentApi,
  journal,
  onChange: permissions,
  onError: error,
  onToast: toast,
  restoreDraft: async (message, recoveryId, context) => {
    if (context.key !== taskKey()) {
      toast("消息已取回并保存，切回原会话可继续编辑");
      return;
    }
    if ($("prompt").value.trim() || $("image").files[0]) {
      toast("输入框已有草稿，取回的消息已另外保存");
      return;
    }
    $("prompt").value = message.text;
    draft.set(taskKey(), message.text);
    takenDrafts.set(taskKey(), { message, recoveryId });
    await restoreTakenImage();
    renderAttachment();
    permissions();
    queueUI.render();
    $("prompt").focus();
  },
});
async function restoreTakenImage() {
  const saved = takenDrafts.get(taskKey());
  if (saved && Object.hasOwn(saved, "file")) {
    if (saved.file) {
      const transfer = new DataTransfer();
      transfer.items.add(saved.file);
      $("image").files = transfer.files;
    }
    return;
  }
  const data = saved?.message.imageDataUrl;
  if (!data) return;
  const bytes = Uint8Array.from(atob(data.split(",")[1]), (c) =>
    c.charCodeAt(0),
  );
  const mime = data.slice(5, data.indexOf(";")),
    dt = new DataTransfer();
  dt.items.add(
    new File([bytes], "queued-image." + (mime.split("/")[1] ?? "png"), {
      type: mime,
    }),
  );
  $("image").files = dt.files;
}
const stateNames = {
  active: "运行中",
  running: "运行中",
  idle: "空闲",
  completed: "已完成",
  inProgress: "运行中",
  interrupted: "已中断",
  error: "出错",
  failed: "出错",
  notLoaded: "未加载 · 状态未知",
  unknown: "状态未知",
  "connection-interrupted": "连接中断",
  "waiting-approval": "等待审批",
  "waiting-user-input": "等待输入",
};
function label(s) {
  return stateNames[typeof s === "string" ? s : s?.type] ?? "状态未知";
}
function sidebarStatus(value, live) {
  const state = typeof value === "string" ? { type: value } : value;
  const source = "官方桌面实时查询";
  if (state?.type === "notLoaded") return { type: "unknown", source };
  if (state?.activeFlags?.includes("waitingOnApproval"))
    return { type: "waiting-approval", source };
  if (state?.activeFlags?.includes("waitingOnUserInput"))
    return { type: "waiting-user-input", source };
  const running = ["active", "running", "inProgress"].includes(state?.type);
  // A fresh active query must not be hidden by a cached terminal snapshot.
  if (
    live &&
    !(
      running &&
      ["completed", "idle", "interrupted", "error"].includes(live.type)
    )
  )
    return { ...live, source: "官方会话所有者实时事件" };
  return {
    ...state,
    type: running ? "running" : (state?.type ?? "unknown"),
    source,
  };
}
function rememberSidebarStatus(id, state, sequence = ++sidebarSequence) {
  if ((sidebarStates.get(id)?.sequence ?? -1) > sequence) return;
  sidebarStates.set(id, { ...state, sequence });
}
function renderThreadIndicator(card, thread) {
  const state = status.connected
    ? (sidebarStates.get(thread.id) ?? sidebarStatus(thread.status))
    : { type: "connection-interrupted", confirmed: false };
  const type =
    state.confirmed === false && state.type !== "connection-interrupted"
      ? "unknown"
      : state.type;
  card.title =
    (thread.title ?? "") +
    " · " +
    label(type) +
    (state.source ? " · " + state.source : "");
  if (card.dataset.status === type) return;
  card.dataset.status = type;
  card.querySelector(".thread-indicator")?.remove();
  const cls =
    type === "running"
      ? "thread-spinner"
      : type === "completed"
        ? "thread-dot completed"
        : type?.startsWith("waiting-")
          ? "thread-dot waiting"
          : ["failed", "error"].includes(type)
            ? "thread-dot error"
            : type !== "idle"
              ? "thread-dot neutral"
              : null;
  if (!cls) return;
  const indicator = node("span", "thread-indicator " + cls);
  indicator.setAttribute("role", "img");
  indicator.setAttribute("aria-label", label(type));
  card.append(indicator);
}
function updateThreadIndicators() {
  for (const card of document.querySelectorAll(".thread-card")) {
    const thread = threads.find((t) => t.id === card.dataset.threadId);
    if (thread) renderThreadIndicator(card, thread);
  }
}
function node(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
}
function error(e) {
  $("error").textContent = e.message ?? String(e);
  $("error").hidden = false;
}
function clearError() {
  $("error").hidden = true;
}
function toast(text) {
  $("toast").textContent = text;
  $("toast").hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => ($("toast").hidden = true), 3200);
}
async function api(route, body, options = {}) {
  const r = await fetch(route, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      "X-Bridge-CSRF": csrf,
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    ...options,
  });
  const d = await r.json();
  if (!r.ok) {
    const e = Error(d.error ?? "请求失败");
    e.status = r.status;
    throw e;
  }
  return d;
}
function agentApi(id, route, body) {
  return api(base(id) + route, body);
}
const questionUI = new QuestionsUI(async (context, payload) => {
  const j = await journal(
    context.agent,
    context.id,
    "question-answer",
    payload,
  );
  const result = await agentApi(
    context.agent,
    "/threads/" + context.id + "/questions",
    { ...payload, requestId: j.id },
  );
  if (result.status !== "accepted")
    throw Error("回答结果未知，请刷新核对，不要重复发送");
  j.clear();
  if (context.agent === agentId && context.id === selected)
    setTimeout(() => read(), 250);
});
const messageImageCache = new Map();
function messageImage(ref) {
  const box = node("div", "message-image"),
    img = node("img"),
    link = node("a", "image-download", "下载原图");
  img.alt = ref.name ?? "图片附件";
  img.loading = "lazy";
  link.download = ref.name ?? "image.png";
  box.append(img, link);
  const key = agentId + ":" + selected + ":" + (ref.id ?? ref.src);
  let ready = messageImageCache.get(key);
  if (!ready) {
    ready = ref.src
      ? Promise.resolve(ref.src)
      : fetch(
          base(agentId) +
            "/threads/" +
            selected +
            "/media?id=" +
            encodeURIComponent(ref.id),
          { headers: { "X-Bridge-CSRF": csrf } },
        ).then(async (r) => {
          if (!r.ok) throw Error("原图不可用（源文件可能已移动或删除）");
          return URL.createObjectURL(await r.blob());
        });
    messageImageCache.set(key, ready);
    if (messageImageCache.size > 100) {
      const first = messageImageCache.keys().next().value;
      messageImageCache
        .get(first)
        .then((url) => {
          if (url.startsWith("blob:")) URL.revokeObjectURL(url);
        })
        .catch(() => {});
      messageImageCache.delete(first);
    }
  }
  ready
    .then((src) => {
      img.src = src;
      link.href = src;
      link.target = "_blank";
      link.rel = "noopener";
    })
    .catch((e) => {
      img.hidden = true;
      link.removeAttribute("href");
      link.textContent = e.message;
      messageImageCache.delete(key);
    });
  return box;
}
function permissions() {
  const fresh = selected === null;
  const readOnlyTask = (
    status.readOnlyThreadIds ??
    status.protectedThreadIds ?? [status.protectedThreadId]
  ).includes(selected);
  const probe = Object.hasOwn(status.testThreads ?? {}, selected);
  const writable =
    fresh ||
    (!readOnlyTask &&
      (probe ||
        (status.existingCodexWritable && taskData?.thread?.kind === "codex")));
  const inFlight = busy.has(fresh ? agentId + ":create" : taskKey());
  const settingsAvailable =
    status.connected &&
    writable &&
    (fresh ||
      ["idle", "active", "notLoaded"].includes(taskData?.thread?.status?.type));
  if (settingsTarget && !settingsAvailable) closeSettingsMenu(false);
  const submitting = inFlight || queueUI.busy;
  queueWritable = writable && !booting;
  const idle =
    fresh || ["idle", "notLoaded"].includes(taskData?.thread?.status?.type);
  $("create").disabled = $("mobile-new").disabled = busy.has(
    agentId + ":create",
  );
  $("prompt").disabled = booting || !writable || submitting;
  $("image").disabled =
    !status.connected ||
    !writable ||
    fresh ||
    inFlight ||
    taskData?.thread?.status?.type === "notLoaded";
  $("attach-label").title = fresh
    ? "先发送第一条文字消息，创建对话后可添加图片"
    : "添加图片（PNG / JPEG / WebP）";
  $("send").disabled =
    booting ||
    !status.connected ||
    !writable ||
    inFlight ||
    (!idle && taskData?.thread?.status?.type !== "active") ||
    queueUI.busy ||
    !$("prompt").value.trim();
  $("send").title = submitting
    ? "提交中…"
    : !idle
      ? "加入队列，当前任务完成后发送"
      : "发送消息";
  $("send").setAttribute("aria-label", !idle ? "加入队列" : "发送消息");
  $("open").disabled = !status.connected || fresh || readOnlyTask;
  $("listfiles").disabled = !status.connected || fresh || !probe;
  $("model-display").disabled =
    $("effort-display").disabled =
    $("permission-display").disabled =
    $("settings-nav").disabled =
      !settingsAvailable || inFlight;
  $("interrupt").hidden = !(
    status.connected &&
    probe &&
    !readOnlyTask &&
    !(status.testExcludedThreadIds ?? []).includes(selected) &&
    !fresh &&
    taskData?.thread?.status?.type === "active"
  );
  $("send").hidden = !$("interrupt").hidden && !$("prompt").value.trim();
  if (!$("send").hidden) $("interrupt").hidden = true;
  $("interrupt").disabled =
    !turns.some((t) => t.status === "inProgress") || inFlight;
  $("older").disabled = !status.connected;
  $("refresh").disabled = !status.connected;
  $("writable").textContent = !status.connected
    ? "连接中断 · 状态未知"
    : !writable
      ? readOnlyTask
        ? "此设备将该会话设为只读"
        : "当前仅支持 Codex 对话写入"
      : inFlight
        ? "正在提交…"
        : !fresh && !idle
          ? "发送后排队 · 可在队列中调整方向"
          : taskData?.thread?.status?.type === "notLoaded"
            ? "发送文字时由官方桌面继续此会话"
            : "";
  $("destination").textContent = currentAgent()?.name ?? "";
  queueUI.render();
}
function modelSettings(state) {
  liveSettingsState = state;
  const pending = pendingSettings.get(taskKey());
  const settings = { ...state?.latestThreadSettings, ...pending };
  const model = settings?.model ?? state?.latestModel;
  $("model-display").replaceChildren(
    icon("bolt"),
    node("span", "model-name", modelName(model)),
  );
  $("model-display").setAttribute(
    "aria-label",
    "选择模型 · " + modelName(model),
  );
  $("effort-display").replaceChildren(
    node(
      "span",
      "",
      effortNames[
        pending
          ? pending.effort
          : (settings?.effort ?? state?.latestReasoningEffort)
      ] ?? "默认",
    ),
    icon("chevron"),
  );
  const profile =
    {
      "read-only": ":read-only",
      workspace: ":workspace",
      full: ":danger-full-access",
    }[settings.permissionMode] ??
    settings.permissions ??
    settings.activePermissionProfile?.id;
  const policy =
    {
      ":read-only": "readOnly",
      ":workspace": "workspaceWrite",
      ":danger-full-access": "dangerFullAccess",
    }[profile] ?? settings?.sandboxPolicy?.type;
  $("permission-name").textContent =
    policy === "dangerFullAccess"
      ? "完全访问"
      : policy === "workspaceWrite"
        ? "工作区权限"
        : policy === "readOnly"
          ? "只读权限"
          : "桌面默认权限";
  $("permission-display").classList.toggle(
    "full-access",
    policy === "dangerFullAccess",
  );
  $("permission-display").title = "调整此会话下一轮的权限";
  $("model-display").title = pending
    ? "下次发送时应用所选模型"
    : "更换模型与推理强度";
  $("effort-display").title = "调整推理强度";
}
function setConnection(connected, text) {
  if (!connected) {
    closeSettingsMenu(false);
    readSequence++;
    sidebarSequence++;
    for (const t of threads)
      rememberSidebarStatus(t.id, { type: "unknown", confirmed: false });
  }
  status.connected = connected;
  $("connection-dot").style.background = connected ? "#3986f6" : "#b9c0c4";
  $("connection").textContent =
    text ?? (connected ? "已连接官方桌面" : "连接中断");
  $("connection").className = "badge " + (connected ? "online" : "offline");
  connectionStates.set(agentId, connected ? "online" : "offline");
  renderAgents();
  updateThreadIndicators();
  permissions();
  if (!connected) {
    queueUI.reset(true);
    resetUsage("unknown", "连接中断，额度未知");
    $("task-state").textContent = "连接中断 · 状态未知";
    $("task-state").className = "badge offline";
    $("activity").hidden = true;
  }
}
function resetUsage(state = "loading", reason = "") {
  usageSequence++;
  usagePending = false;
  usageData = null;
  usageFetchedAt = 0;
  usageState = state;
  usageReason = reason;
  renderUsage();
}
function renderUsage() {
  const details = $("usage-details");
  details.replaceChildren();
  $("refresh-usage").disabled = usagePending || !status.connected;
  const weekly = usageData?.weekly ?? [];
  const main = weekly.find((w) => w.limitId === "codex") ?? weekly[0];
  const valid = usageState === "available" && status.connected;
  const percent = (value) =>
    new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 1 }).format(value) +
    "%";
  $("agent-quota").textContent =
    valid && main?.remainingPercent !== null && main
      ? (main.limitId === "codex" ? "周额度剩余 " : main.label + " 周剩余 ") +
        percent(main.remainingPercent)
      : usageState === "loading"
        ? "周额度 · 读取中…"
        : "周额度 · 未知";
  const observed = usageData?.observedAt;
  $("usage-observed").textContent =
    observed && valid
      ? "官方实时接口 · " +
        new Date(observed).toLocaleTimeString("zh-CN") +
        " 读取"
      : "";
  $("agent-quota").title = valid
    ? "所选设备登录账号的共享额度；" + $("usage-observed").textContent
    : usageReason || "正在读取官方账号额度";
  if (!valid) {
    details.append(
      node(
        "div",
        "usage-unknown",
        usageState === "loading"
          ? "正在读取…"
          : usageReason || "官方未提供可用的周额度",
      ),
    );
    return;
  }
  for (const w of weekly) {
    const row = node("div", "usage-row");
    const line = node("div", "usage-value");
    line.append(
      node("span", "", w.label),
      node(
        "strong",
        "",
        w.remainingPercent === null ? "未知" : percent(w.remainingPercent),
      ),
    );
    row.append(line);
    if (w.remainingPercent !== null) {
      const bar = node("progress");
      bar.max = 100;
      bar.value = w.remainingPercent;
      bar.setAttribute("aria-label", w.label + " 周额度剩余");
      row.append(bar);
    }
    if (w.resetsAt) {
      const reset = new Date(w.resetsAt * 1000);
      if (Number.isFinite(reset.getTime()))
        row.append(
          node(
            "div",
            "usage-reset",
            reset.toLocaleString("zh-CN", {
              month: "long",
              day: "numeric",
              hour: "2-digit",
              minute: "2-digit",
            }) + " 重置",
          ),
        );
    }
    details.append(row);
  }
}
async function refreshUsage() {
  if (!status.connected || usagePending) return;
  const id = agentId,
    g = generation,
    sequence = ++usageSequence;
  usagePending = true;
  renderUsage();
  try {
    const result = await api(base(id) + "/usage", undefined, {
      signal: AbortSignal.timeout(15000),
    });
    if (
      id !== agentId ||
      g !== generation ||
      sequence !== usageSequence ||
      !status.connected
    )
      return;
    usageData = result;
    usageState =
      result.status === "available" && Array.isArray(result.weekly)
        ? "available"
        : "unknown";
    usageReason = "官方未提供可用的周额度";
    usageFetchedAt = Date.now();
  } catch {
    if (id !== agentId || g !== generation || sequence !== usageSequence)
      return;
    usageData = null;
    usageState = "unknown";
    usageReason = "额度读取失败，请稍后刷新";
  } finally {
    if (id === agentId && g === generation && sequence === usageSequence) {
      usagePending = false;
      renderUsage();
    }
  }
}
function closeAgentMenu(restoreFocus = false) {
  const wasOpen = !$("agent-menu").hidden;
  $("agent-menu").hidden = true;
  $("footer-agent").setAttribute("aria-expanded", "false");
  if (wasOpen && restoreFocus) $("footer-agent").focus();
}
function openAgentMenu() {
  $("agent-menu").hidden = false;
  $("footer-agent").setAttribute("aria-expanded", "true");
  $("agents").querySelector('[aria-current="true"]')?.focus();
  refreshUsage();
}
function renderAgents() {
  $("agent-count").textContent = agents.length;
  $("agents").replaceChildren();
  for (const a of agents) {
    const b = node(
      "button",
      "agent-card" + (a.id === agentId ? " active" : ""),
    );
    b.dataset.agentId = a.id;
    b.title = a.name + " · " + endpoint(a);
    b.setAttribute("aria-label", "切换到 " + a.name);
    b.setAttribute("aria-current", String(a.id === agentId));
    const info = node("span", "agent-info");
    info.append(
      node("strong", "", a.name),
      node("small", "", a.kind === "local" ? "此设备 · Windows" : a.host),
    );
    b.append(
      Object.assign(node("span", "agent-avatar"), { title: a.name }),
      info,
      node("span", "dot " + (connectionStates.get(a.id) ?? "")),
    );
    b.querySelector(".agent-avatar").append(icon("device"));
    b.onclick = () => {
      closeAgentMenu(true);
      if (a.id !== agentId) switchAgent(a.id).catch(error);
    };
    $("agents").append(b);
  }
}
function renderThreads() {
  const query = $("search").value.toLocaleLowerCase(),
    project = $("project-filter").value;
  const filtered = threads.filter(
    (t) =>
      (t.title ?? "").toLocaleLowerCase().includes(query) &&
      (project === "all" ||
        (project === "none" ? !t.projectId : t.projectId === project)),
  );
  const card = (t) => {
    const b = node(
      "button",
      "thread-card" + (t.id === selected ? " selected" : ""),
    );
    b.dataset.threadId = t.id;
    b.append(node("strong", "", t.title ?? "未命名对话"));
    renderThreadIndicator(b, t);
    b.onclick = () => selectThread(t.id).catch(error);
    return b;
  };
  const wasOpen = new Map(
    [...$("project-groups").querySelectorAll("details")].map((d) => [
      d.dataset.projectId,
      d.open,
    ]),
  );
  $("project-groups").replaceChildren();
  for (const p of projects) {
    if (project !== "all" && project !== p.projectId) continue;
    const list = filtered.filter((t) => t.projectId === p.projectId);
    if (query && !list.length) continue;
    const d = node("details", "project-group");
    d.dataset.projectId = p.projectId;
    d.open = wasOpen.get(p.projectId) ?? true;
    const summary = node("summary");
    summary.append(
      icon("folder"),
      document.createTextNode(p.label ?? p.name ?? p.path),
      icon("chevron"),
    );
    d.append(summary);
    const children = node("div", "project-threads");
    for (const t of list) children.append(card(t));
    if (!list.length)
      children.append(node("div", "list-empty", "暂无最近对话"));
    d.append(children);
    $("project-groups").append(d);
  }
  if (!projects.length)
    $("project-groups").append(
      node(
        "div",
        "list-empty",
        status.connected ? "暂无项目" : "连接设备后显示项目",
      ),
    );
  const recent = filtered.filter(
    (t) => !projects.some((p) => p.projectId === t.projectId),
  );
  $("thread-count").textContent = recent.length;
  $("threads").replaceChildren(...recent.map(card));
  if (!recent.length)
    $("threads").append(
      node(
        "div",
        "list-empty",
        status.connected ? "没有匹配的对话" : "连接设备后显示对话",
      ),
    );
  $("mobile-suggestions").replaceChildren();
  for (const t of threads.slice(0, 2)) {
    const b = node("button", "suggestion");
    b.append(icon("new"), node("span", "", t.title ?? "继续最近对话"));
    b.onclick = () => selectThread(t.id).catch(error);
    $("mobile-suggestions").append(b);
  }
  const device = node("button", "suggestion device-suggestion");
  device.append(
    icon("device"),
    node(
      "span",
      "",
      (currentAgent()?.name ?? "设备") +
        " · " +
        (status.connected ? "已连接" : "未连接"),
    ),
  );
  device.onclick = () => {
    openDrawer();
    openAgentMenu();
  };
  $("mobile-suggestions").append(device);
}
async function refresh(g = generation) {
  const id = agentId,
    sequence = ++sidebarSequence;
  const [p, t, s] = await Promise.all([
    agentApi(id, "/projects"),
    agentApi(id, "/threads"),
    agentApi(id, "/status"),
  ]);
  if (g !== generation) return;
  status = s;
  projects = p.data.projects ?? [];
  threads = [...(t.data.pinnedThreads ?? []), ...(t.data.threads ?? [])];
  for (const thread of threads)
    rememberSidebarStatus(
      thread.id,
      sidebarStatus(thread.status, s.threads?.[thread.id]?.status),
      sequence,
    );
  // Official recent-list indexing can lag task creation. Keep the confirmed
  // create result visible, but leave its runtime state unknown until read.
  for (const [id, record] of Object.entries(status.testThreads ?? {})) {
    if (!threads.some((t) => t.id === id))
      threads.unshift({
        id,
        title: record.title,
        kind: "codex",
        status: "unknown",
        updatedAt: Date.parse(record.createdAt) / 1000,
      });
  }
  const filter = $("project-filter").value;
  $("project-filter").replaceChildren(
    new Option("所有项目", "all"),
    new Option("未归入项目", "none"),
  );
  for (const p of projects)
    $("project-filter").append(
      new Option(p.label ?? p.name ?? p.path, p.projectId),
    );
  if ([...$("project-filter").options].some((o) => o.value === filter))
    $("project-filter").value = filter;
  renderThreads();
  permissions();
}
async function pollSidebar() {
  if (sidebarPolling || booting || document.hidden || !status.connected) return;
  sidebarPolling = true;
  const a = agentId,
    g = generation,
    sequence = ++sidebarSequence;
  try {
    const [list, snapshot] = await Promise.all([
      agentApi(a, "/threads"),
      agentApi(a, "/status"),
    ]);
    if (g !== generation) return;
    if (!snapshot.connected) {
      setConnection(false);
      return;
    }
    for (const t of [
      ...(list.data.pinnedThreads ?? []),
      ...(list.data.threads ?? []),
    ])
      rememberSidebarStatus(
        t.id,
        sidebarStatus(t.status, snapshot.threads?.[t.id]?.status),
        sequence,
      );
    updateThreadIndicators();
  } catch {
    if (g === generation) setConnection(false, "状态读取失败 · 状态未知");
  } finally {
    sidebarPolling = false;
  }
}
function saveDraft() {
  draft.set(taskKey(), $("prompt").value);
  const saved = takenDrafts.get(taskKey());
  if (saved) saved.file = $("image").files[0] ?? null;
}
async function switchAgent(id, record = true, resumeId = null) {
  closeSettingsMenu(false);
  saveDraft();
  const g = ++generation;
  readSequence++;
  clearTimeout(readTimer);
  streamAbort?.abort();
  agentId = id;
  sidebarStates.clear();
  selected = null;
  queueUI.reset();
  status = { connected: false };
  resetUsage();
  taskData = null;
  threads = [];
  projects = [];
  turns = [];
  cursor = null;
  $("messages").replaceChildren();
  $("files").replaceChildren();
  $("task-view").hidden = false;
  $("metadata").hidden = true;
  $("task-state").hidden = true;
  $("older").hidden = true;
  $("activity").hidden = true;
  viewEpoch++;
  document.querySelector(".conversation").classList.add("is-new");
  $("title").textContent = "新对话";
  modelSettings(null);
  closeDrawer(false);
  $("empty").hidden = false;
  $("file-tray").hidden = true;
  $("prompt").value = draft.get(taskKey()) ?? "";
  $("image").value = "";
  await restoreTakenImage();
  renderAttachment();
  $("search").value = "";
  $("project-filter").replaceChildren(new Option("所有项目", "all"));
  clearError();
  $("agent-title").textContent = currentAgent().name;
  $("agent-endpoint").textContent = endpoint(currentAgent());
  $("empty-title").textContent = "今天有什么安排？";
  $("empty-description").textContent = "正在读取这台电脑上的官方 ChatGPT。";
  $("connection").textContent = "正在连接";
  $("connection").className = "badge neutral";
  renderAgents();
  renderThreads();
  permissions();
  await api("/api/agents/select", { id });
  if (g !== generation) return;
  try {
    let s = await agentApi(id, "/status");
    if (!s.connected) s = await agentApi(id, "/connect", {});
    if (g !== generation) return;
    status = s;
    setConnection(!!s.connected);
    if (!s.connected)
      throw Error("桥接程序可访问，但这台电脑的官方 ChatGPT 尚未连接");
    refreshUsage();
    await refresh(g);
    if (g !== generation) return;
    $("empty-title").textContent = "今天有什么安排？";
    $("empty-description").textContent = "在下方输入，开始一个新对话";
    stream(id, g);
    if (record) recordRoute(id, null);
    if (resumeId) await selectThread(resumeId, false);
  } catch (e) {
    if (g !== generation) return;
    setConnection(false);
    error(e);
    $("empty-title").textContent = "暂时无法连接 " + currentAgent().name;
    $("empty-description").textContent =
      "地址已保存。确认远端桥接程序正在运行后，点击右上角重新连接。";
    renderThreads();
  }
}
async function selectThread(id, record = true) {
  closeSettingsMenu(false);
  viewEpoch++;
  document.querySelector(".conversation").classList.remove("is-new");
  closeDrawer(false);
  if (record) recordRoute(agentId, id);
  saveDraft();
  selected = id;
  queueUI.reset();
  readSequence++;
  taskData = null;
  modelSettings(null);
  turns = [];
  cursor = null;
  $("messages").replaceChildren();
  $("files").replaceChildren();
  $("file-tray").hidden = true;
  $("empty").hidden = true;
  $("task-view").hidden = false;
  $("title").textContent =
    threads.find((t) => t.id === id)?.title ?? "读取任务…";
  $("task-agent").textContent = currentAgent().name;
  $("task-state").textContent = "读取中";
  $("task-state").className = "badge neutral";
  $("prompt").value = draft.get(taskKey()) ?? "";
  $("image").value = "";
  await restoreTakenImage();
  renderAttachment();
  clearError();
  renderThreads();
  permissions();
  const a = agentId,
    g = generation;
  agentApi(a, "/threads/" + id + "/follow", {}).catch((e) => {
    if (
      g === generation &&
      selected === id &&
      !e.message.includes("no-client-found")
    )
      error(Error("历史可读；实时状态尚不可用：" + e.message));
  });
  await read();
}
function renderItem(item) {
  const question = questionUI.render(item, {
    agent: agentId,
    id: selected,
    connected: status.connected,
  });
  if (question) return question;
  let text = "",
    images = [],
    user = false;
  if (item.type === "userMessage" || item.type === "steeringUserMessage") {
    user = true;
    text = (item.content ?? item.input ?? [])
      .filter((c) => c.type === "text")
      .map((c) => c.text)
      .join("\n");
    const reply = questionReply(text);
    if (reply) {
      if (reply.every((r) => questionUI.known?.has(r.questionItemId)))
        return null;
      const card = node("section", "question-card answered");
      for (const row of reply)
        card.append(
          node("p", "question-title", row.question),
          node("p", "question-answer", row.answer),
        );
      card.append(node("small", "question-state", "已回答"));
      return card;
    }
    text = item.bridgeDisplay?.text ?? userContent(text).text;
    images = (item.content ?? item.input ?? []).filter(
      (c) =>
        c.type === "image" &&
        /^data:image\/(png|jpeg|webp);base64,/.test(c.url),
    );
  } else if (item.type === "agentMessage")
    text = item.bridgeDisplay?.text ?? item.text;
  else if (
    item.type === "functionCallOutput" &&
    item.namespace === "codex_app"
  ) {
    const out =
      typeof item.output === "string" ? item.output : item.output?.text;
    const m = /<input>([\s\S]*?)<\/input>/.exec(out ?? "");
    if (!m) return null;
    text = item.bridgeDisplay?.text ?? userContent(m[1]).text;
    user = true;
  } else if (
    item.type === "imageGeneration" &&
    !item.bridgeDisplay?.images?.length
  )
    return node(
      "div",
      "tool-summary",
      "▧ " +
        (item.status === "completed"
          ? "图片已生成 · 可在结果文件中取回原图"
          : "正在生成图片…"),
    );
  else if (item.type !== "imageGeneration") return null;
  const box = node(
    "article",
    "message " + (user ? "user-message" : "assistant-message"),
  );
  const body = node("div", "message-body");
  if (user) body.textContent = text ?? "";
  else body.append(markdown(text));
  for (const ref of item.bridgeDisplay?.images ??
    images.map((c) => ({ src: c.url, name: "已上传的图片" })))
    body.append(messageImage(ref));
  for (const file of item.bridgeDisplay?.files ?? [])
    body.append(node("div", "attachment-chip", file.name));
  box.append(body);
  if (!user) {
    const actions = node("div", "message-actions"),
      copy = node("button", "icon-button");
    copy.title = "复制回复";
    copy.setAttribute("aria-label", "复制回复");
    copy.append(icon("copy"));
    copy.onclick = () =>
      navigator.clipboard
        .writeText(text ?? "")
        .then(() => toast("已复制"))
        .catch(() => toast("复制失败，请手动选择文本"));
    actions.append(copy);
    box.append(actions);
  }

  return box;
}
function displayTurns() {
  questionUI.index(turns);
  $("messages").replaceChildren();
  for (const t of [...turns].sort(
    (a, b) => (a.startedAt ?? 0) - (b.startedAt ?? 0),
  )) {
    const wrapper = node("div", "turn");
    wrapper.dataset.turnId = t.id;
    wrapper.append(
      node(
        "div",
        "turn-divider",
        (t.startedAt
          ? new Date(t.startedAt * 1000).toLocaleString("zh-CN")
          : "时间未知") +
          " · " +
          label(t.status),
      ),
    );
    for (const item of t.items ?? []) {
      const n = renderItem(item);
      if (n) wrapper.append(n);
    }
    const changed = new Map(
      (t.items ?? [])
        .filter((i) => i.type === "fileChange")
        .flatMap((i) => i.changes ?? [])
        .filter((c) => typeof c.path === "string")
        .map((c) => [c.path, c]),
    );
    if (changed.size) {
      const card = node("details", "result-card"),
        summary = node("summary"),
        symbol = node("span", "card-icon"),
        title = node("span", "card-label");
      symbol.append(icon("files"));
      title.append(
        node("strong", "", `已编辑 ${changed.size} 个文件`),
        node("small", "", "查看这轮对话中的文件变更"),
      );
      summary.append(symbol, title, icon("chevron"));
      card.append(summary);
      for (const c of changed.values()) {
        const row = node("details", "file-change-row"),
          name = node("summary", "", c.path.replaceAll("\\", "/"));
        row.append(
          name,
          node("pre", "card-content", c.diff ?? "无可显示的 diff"),
        );
        card.append(row);
      }
      wrapper.append(card);
    }
    const commands = (t.items ?? []).filter(
      (i) => i.type === "commandExecution",
    );
    if (commands.length) {
      const card = node("details", "result-card"),
        summary = node("summary"),
        symbol = node("span", "card-icon"),
        title = node("span", "card-label");
      symbol.append(icon("device"));
      title.append(
        node("strong", "", `执行了 ${commands.length} 条命令`),
        node(
          "small",
          "",
          commands.some((c) => c.status === "inProgress")
            ? "正在执行"
            : "查看命令与返回结果",
        ),
      );
      summary.append(symbol, title, icon("chevron"));
      card.append(summary);
      for (const c of commands)
        card.append(
          node(
            "pre",
            "card-content",
            (c.command ?? "") + "\n\n" + String(c.output ?? "").slice(0, 6000),
          ),
        );
      wrapper.append(card);
    }
    for (const request of liveSettingsState?.requests ?? []) {
      if (
        request.method !== "item/tool/requestUserInput" ||
        request.params?.turnId !== t.id ||
        (t.items ?? []).some(
          (i) =>
            i.type === "userInputResponse" &&
            String(i.requestId) === String(request.id),
        )
      )
        continue;
      const card = questionUI.render(
        {
          type: "userInputResponse",
          requestId: request.id,
          questions: request.params.questions,
          completed: false,
        },
        { agent: agentId, id: selected, connected: status.connected },
      );
      if (card) wrapper.append(card);
    }
    $("messages").append(wrapper);
  }
}
async function read(older = false) {
  if (!selected) return;
  const a = agentId,
    id = selected,
    g = generation,
    seq = ++readSequence,
    sidebarSeq = ++sidebarSequence;
  try {
    const r = await agentApi(
      a,
      "/threads/" +
        id +
        (older && cursor ? "?cursor=" + encodeURIComponent(cursor) : ""),
    );
    if (
      g !== generation ||
      id !== selected ||
      seq !== readSequence ||
      !status.connected
    )
      return;
    taskData = r.data;
    modelSettings(r.live?.state);
    const entry = threads.find((t) => t.id === id);
    const listChanged = !entry || entry.title !== taskData.thread.title;
    if (entry) {
      entry.title = taskData.thread.title;
      entry.status = taskData.thread.status.type;
    } else
      threads.unshift({
        ...taskData.thread,
        id,
        status: taskData.thread.status.type,
      });
    rememberSidebarStatus(
      id,
      sidebarStatus(taskData.thread.status, r.live?.status),
      sidebarSeq,
    );
    if (listChanged) renderThreads();
    else updateThreadIndicators();
    cursor = r.data.page?.nextCursor;
    turns = older
      ? [...new Map([...turns, ...r.data.turns].map((t) => [t.id, t])).values()]
      : (r.data.turns ?? []);
    $("title").textContent = taskData.thread.title;
    $("task-project").textContent =
      projects.find(
        (p) => p.projectId === threads.find((t) => t.id === id)?.projectId,
      )?.label ??
      (taskData.thread.kind === "chatgpt" ? "Chat · 只读" : "Codex");
    let st = taskData.thread.status;
    if (r.live?.status?.confirmed) st = r.live.status;
    if (st?.activeFlags?.includes("waitingOnApproval"))
      st = { type: "waiting-approval" };
    else if (st?.activeFlags?.includes("waitingOnUserInput"))
      st = { type: "waiting-user-input" };
    $("task-state").textContent = label(st);
    $("task-state").hidden = ![
      "waiting-approval",
      "waiting-user-input",
      "error",
      "failed",
      "unknown",
      "notLoaded",
    ].includes(st?.type);
    $("task-state").className =
      "badge " +
      (/active|running/.test(st?.type)
        ? "running"
        : st?.type?.startsWith("waiting")
          ? "waiting"
          : ["idle", "completed"].includes(st?.type)
            ? "online"
            : "neutral");
    $("activity").hidden = taskData.thread.status.type !== "active";
    $("older").hidden = !cursor;
    $("metadata").textContent =
      "Agent: " +
      a +
      "\n任务 ID: " +
      id +
      "\n来源: " +
      r.source +
      "\n读取时间: " +
      r.observedAt +
      "\n目录: " +
      taskData.thread.cwd;
    const scroll = $("message-scroll"),
      atBottom =
        scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight < 100 ||
        !scroll.scrollTop;
    displayTurns();
    permissions();
    queueUI.refresh();
    if (!older && atBottom) scroll.scrollTop = scroll.scrollHeight;
  } catch (e) {
    if (g === generation && id === selected) {
      error(e);
      setConnection(false, "读取失败 · 状态未知");
    }
  }
}
async function stream(id, g) {
  streamAbort?.abort();
  const controller = new AbortController();
  streamAbort = controller;
  try {
    const r = await fetch(base(id) + "/events", {
      headers: { "X-Bridge-CSRF": csrf },
      signal: controller.signal,
    });
    if (!r.ok) throw Error("事件连接失败");
    const reader = r.body.getReader(),
      decoder = new TextDecoder();
    let buffer = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) throw Error("查看连接已断开");
      if (g !== generation) break;
      buffer += decoder.decode(value, { stream: true });
      let i;
      while ((i = buffer.indexOf("\n\n")) >= 0) {
        const frame = buffer.slice(0, i);
        buffer = buffer.slice(i + 2);
        const line = frame.split("\n").find((l) => l.startsWith("data: "));
        if (!line) continue;
        const e = JSON.parse(line.slice(6));
        if (e.kind === "bridge-updating") {
          toast("桥接程序正在更新，官方任务继续运行");
          if (id === "local") backupDrafts().catch(error);
        }
        if (e.kind === "connection-interrupted") setConnection(false);
        if (["thread-state", "unknown"].includes(e.kind)) {
          rememberSidebarStatus(e.threadId, {
            ...(e.kind === "thread-state"
              ? e.status
              : { type: "unknown", confirmed: false }),
            source: "官方会话所有者实时事件",
          });
          updateThreadIndicators();
        }
        if (e.threadId === selected && e.kind === "queue-changed")
          queueUI.refresh();
        if (e.threadId === selected && e.kind === "unknown") {
          $("task-state").textContent = "状态未知";
          $("task-state").className = "badge neutral";
        }
        if (e.threadId === selected && e.kind === "thread-state") {
          clearTimeout(readTimer);
          readTimer = setTimeout(() => {
            if (g === generation) read();
          }, 500);
        }
        if (e.kind === "resync-required") {
          if (!e.connected) setConnection(false);
          else {
            for (const [threadId, snapshot] of Object.entries(e.threads ?? {}))
              rememberSidebarStatus(threadId, {
                ...snapshot.status,
                source: "官方会话所有者实时事件",
              });
            updateThreadIndicators();
            if (selected) read();
          }
        }
      }
    }
  } catch (e) {
    if (g === generation && e.name !== "AbortError") {
      error(e);
      setConnection(false);
      setTimeout(() => {
        if (g === generation) {
          stream(id, g);
          if (selected) read();
        }
      }, 2000);
    }
  }
}
function editAgent(id) {
  editing = id;
  const a = id ? agents.find((a) => a.id === id) : null;
  $("agent-form").reset();
  $("agent-dialog-title").textContent = a ? "编辑设备" : "添加设备";
  $("agent-name").value = a?.name ?? "";
  $("agent-host").value = a?.kind === "remote" ? a.host : "";
  $("agent-port").value = a?.kind === "remote" ? a.port : 43128;
  $("agent-key").placeholder = a?.hasKey
    ? "已保存。留空保持原密钥；地址改变时请重新填写。"
    : "从远端桥接程序复制；可先留空保存";
  $("remote-fields").hidden = a?.kind === "local";
  $("remove-agent").hidden = !a || a.kind === "local";
  $("agent-form-error").textContent = "";
  $("agent-dialog").showModal();
  deviceSettings.open(a);
}
function journal(a, t, operation, payload) {
  const key = "remote-bridge-request:" + a + ":" + t + ":" + operation,
    content = JSON.stringify(payload);
  return crypto.subtle
    .digest("SHA-256", new TextEncoder().encode(content))
    .then((buffer) => {
      const hash = Array.from(new Uint8Array(buffer), (v) =>
        v.toString(16).padStart(2, "0"),
      ).join("");
      let old;
      try {
        old = JSON.parse(localStorage.getItem(key));
      } catch {}
      const value =
        old?.hash === hash ? old : { hash, id: crypto.randomUUID() };
      localStorage.setItem(key, JSON.stringify(value));
      return {
        id: value.id,
        clear: () => {
          if (JSON.parse(localStorage.getItem(key) ?? "{}").id === value.id)
            localStorage.removeItem(key);
        },
      };
    });
}
function renderAttachment() {
  if (attachmentUrl) URL.revokeObjectURL(attachmentUrl);
  attachmentUrl = null;
  const f = $("image").files[0];
  $("attachment").hidden = !f;
  $("attachment").replaceChildren();
  if (f) {
    const chip = node("span", "attachment-chip"),
      im = node("img");
    attachmentUrl = URL.createObjectURL(f);
    im.src = attachmentUrl;
    im.alt = "待发送图片";
    const b = node("button", "", "×");
    b.type = "button";
    b.title = "移除图片";
    b.onclick = () => {
      $("image").value = "";
      renderAttachment();
    };
    chip.append(im, document.createTextNode(f.name), b);
    $("attachment").append(chip);
  }
}
async function fileData(file) {
  if (!file) return undefined;
  if (file.size > 5 * 1024 * 1024) throw Error("图片不得超过 5 MB");
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(Error("无法读取图片"));
    reader.readAsDataURL(file);
  });
}
function recordRoute(a, t) {
  if (routeHistory[routeIndex]?.a === a && routeHistory[routeIndex]?.t === t)
    return;
  routeHistory = routeHistory.slice(0, routeIndex + 1);
  routeHistory.push({ a, t });
  routeIndex = routeHistory.length - 1;
  navigationButtons();
}
function navigationButtons() {
  $("nav-back").disabled = routeIndex <= 0;
  $("nav-forward").disabled = routeIndex >= routeHistory.length - 1;
}
async function navigateBy(delta) {
  const i = routeIndex + delta;
  if (i < 0 || i >= routeHistory.length) return;
  routeIndex = i;
  const r = routeHistory[i];
  navigationButtons();
  if (r.a !== agentId) await switchAgent(r.a, false, r.t);
  else if (r.t) await selectThread(r.t, false);
  else newConversation(false);
}
function newConversation(record = true) {
  closeSettingsMenu(false);
  saveDraft();
  viewEpoch++;
  readSequence++;
  selected = null;
  queueUI.reset();
  turns = [];
  cursor = null;
  taskData = null;
  $("messages").replaceChildren();
  $("files").replaceChildren();
  $("file-tray").hidden = true;
  $("older").hidden = true;
  $("activity").hidden = true;
  $("metadata").hidden = true;
  $("empty").hidden = false;
  document.querySelector(".conversation").classList.add("is-new");
  $("title").textContent = "新对话";
  $("task-state").hidden = true;
  $("empty-title").textContent = "今天有什么安排？";
  $("empty-description").textContent = "在下方输入，开始一个新对话";
  $("prompt").value = "";
  $("prompt").style.height = "";
  draft.delete(taskKey());
  $("image").value = "";
  renderAttachment();
  modelSettings(null);
  clearError();
  renderThreads();
  permissions();
  closeDrawer(false);
  if (record) recordRoute(agentId, null);
  $("prompt").focus();
}
$("form").onsubmit = async (e) => {
  e.preventDefault();
  if ($("send").disabled) return;
  const a = agentId,
    t = selected,
    g = generation,
    v = viewEpoch,
    fresh = t === null,
    enqueue = !fresh && taskData?.thread?.status?.type === "active",
    k = fresh ? a + ":create" : taskKey(),
    prompt = $("prompt").value,
    file = $("image").files[0];
  if (!prompt.trim()) return;
  const sendSettings = pendingSettings.get(taskKey(a, t));
  busy.add(k);
  permissions();
  clearError();
  if (fresh) {
    $("empty").hidden = true;
    document.querySelector(".conversation").classList.remove("is-new");
    const preview = renderItem({
      type: "userMessage",
      content: [{ type: "text", text: prompt }],
    });
    $("messages").replaceChildren(preview);
    $("activity").hidden = false;
  }
  try {
    const imageDataUrl = await fileData(file),
      payload = {
        prompt,
        ...(takenDrafts.get(taskKey(a, t))
          ? { recoveryId: takenDrafts.get(taskKey(a, t)).recoveryId }
          : {}),
        ...(imageDataUrl ? { imageDataUrl } : {}),
        ...(sendSettings ? { settings: sendSettings } : {}),
      };
    const j = await journal(
      a,
      fresh ? "new" : t,
      fresh ? "create" : enqueue ? "enqueue" : "send",
      payload,
    );
    const r = enqueue
      ? await queueUI.enqueue(prompt, imageDataUrl, j.id, payload.recoveryId, {
          agent: a,
          id: t,
        })
      : await agentApi(a, fresh ? "/threads" : "/threads/" + t + "/messages", {
          ...payload,
          requestId: j.id,
        });
    if (r.status !== "accepted" || (fresh && !r.result?.threadId))
      throw Error("提交结果未知，已阻止重复发送；请先核对官方对话。");
    j.clear();
    takenDrafts.delete(taskKey(a, t));
    draft.delete(taskKey(a, t));
    pendingSettings.delete(taskKey(a, t));
    if (g === generation && v === viewEpoch) {
      $("prompt").value = "";
      $("image").value = "";
      renderAttachment();
      if (fresh) {
        await refresh(g);
        if (g === generation && v === viewEpoch)
          await selectThread(r.result.threadId);
      } else await read();
      if (enqueue) toast("已加入官方队列");
    } else
      toast("已发送到 " + (agents.find((x) => x.id === a)?.name ?? "原设备"));
  } catch (e) {
    if (g === generation && v === viewEpoch) {
      error(e);
      $("activity").hidden = true;
    } else toast("原设备的提交结果未知，请切回核对。");
  } finally {
    busy.delete(k);
    permissions();
  }
};
$("prompt").oninput = () => {
  saveDraft();
  permissions();
  $("prompt").style.height = "auto";
  $("prompt").style.height = Math.min($("prompt").scrollHeight, 180) + "px";
};
$("prompt").onkeydown = (e) => {
  if (e.key === "Enter" && !e.shiftKey && !e.isComposing && e.keyCode !== 229) {
    e.preventDefault();
    $("form").requestSubmit();
  }
};
$("image").onchange = renderAttachment;
$("create").onclick = $("mobile-new").onclick = () => newConversation();
$("nav-back").onclick = () => navigateBy(-1).catch(error);
$("nav-forward").onclick = () => navigateBy(1).catch(error);

$("agent-form").onsubmit = async (e) => {
  e.preventDefault();
  $("save-agent").disabled = true;
  try {
    await deviceSettings.saveLocal();
    const d = await api("/api/agents", {
      id: editing,
      name: $("agent-name").value,
      host: $("agent-host").value,
      port: $("agent-port").value,
      key: $("agent-key").value.trim(),
    });
    agents = d.agents;
    $("agent-dialog").close();
    $("agent-key").value = "";
    renderAgents();
    if (editing === agentId) await switchAgent(agentId);
    toast("设备已保存");
  } catch (e) {
    $("agent-form-error").textContent = e.message;
  } finally {
    $("save-agent").disabled = false;
  }
};
$("remove-agent").onclick = async () => {
  try {
    const removed = editing,
      d = await api("/api/agents/remove", { id: removed });
    agents = d.agents;
    $("agent-dialog").close();
    if (agentId === removed) await switchAgent("local");
    else renderAgents();
    toast("设备配置已移除，电脑上的任务不受影响");
  } catch (e) {
    $("agent-form-error").textContent = e.message;
  }
};
$("add-agent").onclick = () => {
  closeAgentMenu();
  editAgent(null);
};
$("devices-nav").onclick = openAgentMenu;
$("footer-agent").onclick = () => {
  if ($("agent-menu").hidden) openAgentMenu();
  else closeAgentMenu();
};
$("edit-agent").onclick = () => {
  closeAgentMenu();
  editAgent(agentId);
};
$("refresh-usage").onclick = refreshUsage;
document.addEventListener("pointerdown", (e) => {
  if (
    !$("agent-menu").contains(e.target) &&
    !$("footer-agent").contains(e.target)
  )
    closeAgentMenu();
});
document.addEventListener("focusin", (e) => {
  // Blank-area clicks and disabled/replaced controls can blur to no element.
  // Dismiss only when focus actually enters an element outside the footer.
  if (!document.querySelector(".sidebar-footer").contains(e.target))
    closeAgentMenu();
});
setInterval(() => {
  if (usageData && Date.now() - usageFetchedAt > 90000)
    resetUsage("unknown", "额度已过期，请刷新");
  if (!document.hidden) refreshUsage();
}, 60000);
setInterval(pollSidebar, 15000);
document.addEventListener("visibilitychange", () => {
  if (document.hidden) return;
  pollSidebar();
  if (Date.now() - usageFetchedAt > 90000) resetUsage("loading");
  refreshUsage();
});
$("reconnect").onclick = () => switchAgent(agentId).catch(error);
$("refresh").onclick = () => refresh().catch(error);
$("search").oninput = renderThreads;
function toggleSearch() {
  $("search-panel").hidden = !$("search-panel").hidden;
  if (!$("search-panel").hidden) $("search").focus();
}
$("search-toggle").onclick = $("search-nav").onclick = toggleSearch;
$("project-filter").onchange = renderThreads;
$("open").onclick = async () => {
  const a = agentId,
    id = selected,
    g = generation;
  try {
    await agentApi(a, "/threads/" + id + "/open", {});
    for (let attempt = 0; attempt < 20; attempt++) {
      try {
        await agentApi(a, "/threads/" + id + "/follow", {});
        break;
      } catch (e) {
        if (!e.message.includes("no-client-found") || attempt === 19) throw e;
        await new Promise((r) => setTimeout(r, 250));
      }
    }
    if (a === agentId && id === selected && g === generation) await read();
  } catch (e) {
    if (a === agentId && id === selected) error(e);
  }
};
$("older").onclick = () => read(true);
$("interrupt").onclick = async () => {
  const a = agentId,
    t = selected,
    g = generation,
    k = taskKey(),
    turn = turns.find((t) => t.status === "inProgress");
  if (!turn || busy.has(k)) return;
  busy.add(k);
  permissions();
  try {
    const j = await journal(a, t, "interrupt", { turn: turn.id }),
      r = await agentApi(a, "/threads/" + t + "/interrupt", {
        expectedTurnId: turn.id,
        requestId: j.id,
      });
    if (r.status === "accepted") j.clear();
    if (g === generation) await read();
  } catch (e) {
    if (g === generation) error(e);
  } finally {
    busy.delete(k);
    permissions();
  }
};
$("detail-toggle").onclick = () =>
  ($("metadata").hidden = !$("metadata").hidden);
async function files() {
  const a = agentId,
    t = selected,
    g = generation;
  try {
    const r = await agentApi(a, "/threads/" + t + "/files");
    if (g !== generation || t !== selected) return;
    $("files").replaceChildren();
    for (const f of r.files) {
      const b = node("button", "file-entry", "↓ " + f.name);
      b.append(node("span", "", (f.size / 1024).toFixed(0) + " KB"));
      b.onclick = async () => {
        try {
          const r = await fetch(
            base(a) +
              "/threads/" +
              t +
              "/file?name=" +
              encodeURIComponent(f.name),
            { headers: { "X-Bridge-CSRF": csrf } },
          );
          if (!r.ok) throw Error("文件下载失败");
          const blob = await r.blob(),
            url = URL.createObjectURL(blob),
            link = node("a");
          link.href = url;
          link.download = f.name.split("/").at(-1);
          link.click();
          setTimeout(() => URL.revokeObjectURL(url), 20000);
        } catch (e) {
          error(e);
        }
      };
      $("files").append(b);
    }
    if (!r.files.length) $("files").textContent = "此任务还没有 outputs 文件。";
  } catch (e) {
    if (g === generation) error(e);
  }
}
$("toggle-files").onclick = () => {
  $("file-tray").hidden = !$("file-tray").hidden;
  if (
    !$("file-tray").hidden &&
    Object.hasOwn(status.testThreads ?? {}, selected)
  )
    files();
};
$("listfiles").onclick = files;
$("close-files").onclick = () => {
  $("file-tray").hidden = true;
  $("mobile-conversation").classList.add("active");
  $("mobile-results").classList.remove("active");
};
$("files-nav").onclick = $("mobile-results").onclick = () => {
  closeDrawer(false);
  if (!selected) {
    toast("先选择一个对话，再查看结果文件");
    return;
  }
  $("file-tray").hidden = false;
  $("mobile-results").classList.add("active");
  $("mobile-conversation").classList.remove("active");
  if (Object.hasOwn(status.testThreads ?? {}, selected)) files();
  else $("files").textContent = "此历史对话暂不提供文件下载";
};
$("mobile-conversation").onclick = () => $("close-files").click();
const effortNames = {
  low: "低",
  medium: "中",
  high: "高",
  xhigh: "极高",
  max: "最高",
  ultra: "超高",
  minimal: "最小",
  none: "无",
};
function modelName(model) {
  return (
    {
      "gpt-6-astra": "GPT-6 Astra",
      "gpt-5.6-sol": "GPT-5.6 Sol",
      "gpt-5.6-terra": "GPT-5.6 Terra",
      "gpt-5.6-luna": "GPT-5.6 Luna",
      "gpt-5.5": "GPT-5.5",
      "gpt-5.4-mini": "GPT-5.4 Mini",
      "gpt-5.3-codex-spark": "GPT-5.3 Codex Spark",
    }[model] ??
    model ??
    "桌面默认模型"
  );
}
let settingsMenuSequence = 0;
function settingsContextMatches(t) {
  return (
    t &&
    t.a === agentId &&
    t.id === selected &&
    t.g === generation &&
    t.v === viewEpoch
  );
}
function closeSettingsMenu(restoreFocus = true) {
  const menu = $("settings-menu"),
    trigger = settingsTarget?.trigger;
  settingsMenuSequence++;
  settingsTarget = null;
  if (menu.matches(":popover-open")) menu.hidePopover();
  for (const id of ["model-display", "effort-display", "permission-display"])
    $(id).setAttribute("aria-expanded", "false");
  if (restoreFocus && trigger && !trigger.disabled) trigger.focus();
}
function positionSettingsMenu() {
  const menu = $("settings-menu"),
    target = settingsTarget;
  if (!target || !menu.matches(":popover-open")) return;
  const viewport = window.visualViewport;
  const left = viewport?.offsetLeft ?? 0,
    top = viewport?.offsetTop ?? 0;
  const width = viewport?.width ?? innerWidth,
    height = viewport?.height ?? innerHeight;
  const anchor = target.trigger.getBoundingClientRect(),
    gap = 8;
  menu.style.width =
    Math.min(target.kind === "permission" ? 400 : 320, width - 16) + "px";
  const above = Math.max(0, anchor.top - top - gap - 8);
  const below = Math.max(0, top + height - anchor.bottom - gap - 8);
  const openAbove = above >= Math.min(menu.scrollHeight, 350) || above >= below;
  menu.style.maxHeight = Math.max(72, openAbove ? above : below) + "px";
  const box = menu.getBoundingClientRect();
  const x =
    target.kind === "permission" ? anchor.left : anchor.right - box.width;
  menu.style.left =
    Math.max(left + 8, Math.min(x, left + width - box.width - 8)) + "px";
  const y = openAbove ? anchor.top - box.height - gap : anchor.bottom + gap;
  menu.style.top =
    Math.max(top + 8, Math.min(y, top + height - box.height - 8)) + "px";
}
function permissionMode(settings) {
  return (
    {
      ":read-only": "read-only",
      ":workspace": "workspace",
      ":danger-full-access": "full",
    }[settings?.permissions ?? settings?.activePermissionProfile?.id] ??
    {
      readOnly: "read-only",
      workspaceWrite: "workspace",
      dangerFullAccess: "full",
    }[settings?.sandboxPolicy?.type]
  );
}
function settingOption(
  text,
  value,
  selectedValue,
  action,
  description = "",
  symbol = null,
) {
  const b = node("button", "setting-option");
  b.type = "button";
  b.dataset.value = value;
  b.setAttribute("role", "menuitemradio");
  b.setAttribute("aria-checked", String(value === selectedValue));
  if (symbol) b.append(icon(symbol));
  const content = node("span", "setting-option-copy");
  content.append(node("span", "", text));
  if (description) content.append(node("small", "", description));
  b.append(content);
  if (value === selectedValue) b.append(icon("check"));
  b.onclick = action;
  return b;
}
function renderSettingsMenu(focus = false) {
  const t = settingsTarget;
  if (!settingsContextMatches(t)) return;
  const menu = $("settings-menu"),
    choice = t.choice ?? {};
  menu.replaceChildren();
  menu.dataset.kind = t.kind;
  menu.setAttribute(
    "aria-label",
    { model: "选择模型", effort: "推理强度", permission: "权限设置" }[t.kind],
  );
  menu.setAttribute("role", t.kind === "effort" ? "group" : "menu");
  if (!t.models)
    menu.append(node("p", "setting-note", t.error ?? "读取官方模型目录…"));
  else if (t.kind === "model") {
    menu.append(node("div", "setting-heading", "选择模型"));
    menu.append(
      settingOption(
        t.id ? "保持官方当前模型" : "默认",
        "",
        choice.model ?? "",
        () => applySetting({ model: "" }),
        t.id ? "取消本地预选，沿用此会话的设置" : "使用官方桌面的默认设置",
      ),
    );
    for (const model of t.models) {
      const row = settingOption(
        modelName(model.id),
        model.id,
        choice.model,
        () => {
          const effort = model.efforts.includes(choice.effort)
            ? choice.effort
            : choice.effort
              ? model.efforts.includes("medium")
                ? "medium"
                : model.efforts[0]
              : undefined;
          applySetting({ model: model.id, ...(effort ? { effort } : {}) });
        },
      );
      row.title = model.description;
      menu.append(row);
    }
  } else if (t.kind === "permission") {
    menu.append(node("div", "setting-heading", "此会话的访问权限"));
    const selectedMode = choice.permissionMode ?? permissionMode(t.current);
    for (const [mode, name, description, symbol] of [
      ["read-only", "只读", "查看文件；审批由官方策略决定", "shield"],
      [
        "workspace",
        "工作区权限",
        "允许工作区内读写；审批由官方策略决定",
        "device",
      ],
      [
        "full",
        "完全访问权限",
        "允许访问工作区外文件并使用官方完全访问策略",
        "shield",
      ],
    ]) {
      const row = settingOption(
        name,
        mode,
        selectedMode,
        () => applySetting({ permissionMode: mode }),
        description,
        symbol,
      );
      row.disabled = false;
      if (mode === "full") row.classList.add("full-access");
      menu.append(row);
    }
    menu.append(
      node(
        "p",
        "setting-note",
        t.loaded
          ? "点击即应用到此会话，下一轮生效。"
          : "已选权限将在发送时应用；新对话的首条消息也使用该权限。",
      ),
    );
  } else {
    const model = t.models.find((m) => m.id === choice.model);
    const head = node("div", "effort-heading"),
      title = node("button", "effort-title");
    title.type = "button";
    title.append(
      node("strong", "", effortNames[choice.effort] ?? "选择强度"),
      icon("forward"),
      node("small", "", modelName(choice.model)),
    );
    title.title = "返回模型列表";
    title.onclick = () => openSettingsMenu("model");
    const reset = node("button", "icon-button effort-reset");
    reset.type = "button";
    reset.title = "恢复打开菜单时的强度";
    reset.setAttribute("aria-label", reset.title);
    reset.append(icon("refresh"));
    reset.disabled = !t.baselineEffort || t.baselineEffort === choice.effort;
    reset.onclick = () =>
      applySetting({ model: choice.model, effort: t.baselineEffort }, true);
    const speed = node("button", "icon-button speed-toggle");
    speed.type = "button";
    speed.id = "speed-toggle";
    const fast = model?.serviceTiers?.find((t) =>
      ["priority", "fast"].includes(t.id),
    );
    const active = ["priority", "fast"].includes(
      choice.serviceTier ?? t.current?.serviceTier,
    );
    speed.append(icon("bolt"));
    speed.setAttribute("aria-pressed", String(active));
    speed.title = !t.id
      ? "官方新建接口尚未提供首轮加速参数，创建后可切换"
      : !fast
        ? "此模型暂未提供加速档位"
        : (choice.model === "gpt-6-astra" ? "2× speed" : "1.5× speed") +
          " · 用量更多";
    speed.setAttribute("aria-label", speed.title);
    speed.disabled = !t.loaded || (!fast && !active);
    speed.onclick = () =>
      applySetting({ serviceTier: active ? "default" : fast.id }, true);
    head.append(speed, title, reset);
    menu.append(head);
    if (!model?.efforts.length) {
      const choose = node("button", "setting-option", "先选择一个模型");
      choose.type = "button";
      choose.onclick = () => openSettingsMenu("model");
      menu.append(choose);
    } else {
      const rail = node("div", "effort-rail"),
        slider = node("input", "effort-slider");
      const selectedIndex = model.efforts.indexOf(choice.effort);
      slider.id = "effort-slider";
      slider.type = "range";
      slider.min = "0";
      slider.max = String(model.efforts.length - 1);
      slider.step = "1";
      slider.value = String(Math.max(0, selectedIndex));
      slider.setAttribute("aria-label", "推理强度");
      const preview = () => {
        const index = Number(slider.value),
          name = effortNames[model.efforts[index]] ?? model.efforts[index];
        title.querySelector("strong").textContent = name;
        slider.setAttribute("aria-valuetext", name);
        rail.style.setProperty(
          "--effort-fill",
          `${(index / Math.max(1, model.efforts.length - 1)) * 100}%`,
        );
      };
      preview();
      if (selectedIndex < 0) {
        title.querySelector("strong").textContent = "选择强度";
        slider.setAttribute("aria-valuetext", "尚未指定，滑动选择");
      }
      slider.oninput = preview;
      slider.onchange = () =>
        applySetting(
          { model: model.id, effort: model.efforts[Number(slider.value)] },
          true,
        );
      rail.append(slider);
      const ticks = node("div", "effort-ticks");
      for (const effort of model.efforts) {
        const tick = node("button", "effort-tick");
        tick.type = "button";
        tick.title = effortNames[effort] ?? effort;
        tick.setAttribute("aria-label", "设为" + tick.title);
        tick.onclick = () => applySetting({ model: model.id, effort }, true);
        ticks.append(tick);
      }
      rail.append(ticks);
      menu.append(rail);
    }
  }
  if (t.error && t.models) menu.append(node("p", "setting-error", t.error));
  if (t.saving) menu.append(node("p", "setting-note", "正在应用…"));
  for (const control of menu.querySelectorAll("button,input"))
    control.disabled ||= !!t.saving;
  positionSettingsMenu();
  if (focus)
    (
      menu.querySelector('[aria-checked="true"]') ??
      menu.querySelector("button:not(:disabled),input:not(:disabled)")
    )?.focus();
}
async function openSettingsMenu(kind) {
  const trigger = $(
    kind === "model"
      ? "model-display"
      : kind === "effort"
        ? "effort-display"
        : "permission-display",
  );
  if (booting || trigger.disabled) return;
  if (
    settingsTarget?.kind === kind &&
    $("settings-menu").matches(":popover-open")
  ) {
    closeSettingsMenu();
    return;
  }
  closeSettingsMenu(false);
  closeDrawer(false);
  closeAgentMenu();
  const sequence = ++settingsMenuSequence;
  const current = liveSettingsState?.latestThreadSettings;
  const choice = pendingSettings.get(taskKey()) ?? {
    ...current,
    model: current?.model ?? liveSettingsState?.latestModel,
    effort: current?.effort ?? liveSettingsState?.latestReasoningEffort,
  };
  const target = (settingsTarget = {
    a: agentId,
    id: selected,
    g: generation,
    v: viewEpoch,
    kind,
    trigger,
    current,
    choice,
    baselineEffort: choice.effort,
    // Loaded tasks always use their official owner, even before settings arrive.
    loaded: ["idle", "active"].includes(taskData?.thread?.status?.type),
  });
  trigger.setAttribute("aria-expanded", "true");
  $("settings-menu").showPopover();
  renderSettingsMenu();
  try {
    const data = await agentApi(target.a, "/models");
    if (
      sequence !== settingsMenuSequence ||
      settingsTarget !== target ||
      !settingsContextMatches(target)
    )
      return;
    target.models = data.models;
    renderSettingsMenu(true);
  } catch (e) {
    if (settingsTarget === target) {
      target.error = e.message;
      renderSettingsMenu();
    }
  }
}
async function applySetting(choice, keepOpen = false) {
  const t = settingsTarget;
  if (
    !settingsContextMatches(t) ||
    t.saving ||
    !t.models ||
    $("model-display").disabled
  )
    return;
  const { a, id, g, v, loaded } = t;
  const key = taskKey(a, id),
    busyKey = id ? key : a + ":create";
  t.saving = true;
  t.error = null;
  busy.add(busyKey);
  permissions();
  renderSettingsMenu();
  try {
    if (!loaded || choice.model === "") {
      const next = { ...(pendingSettings.get(key) ?? {}), ...choice };
      if (choice.model === "") {
        delete next.model;
        delete next.effort;
      }
      if (Object.keys(next).length) pendingSettings.set(key, next);
      else pendingSettings.delete(key);
      modelSettings(liveSettingsState);
      t.choice = pendingSettings.get(key) ?? t.current ?? {};
      if (!keepOpen) closeSettingsMenu();
      toast(
        Object.keys(next).length
          ? "已选择，下一次发送时使用"
          : "已沿用官方模型设置",
      );
      return;
    }
    const j = await journal(a, id, "settings", choice);
    const result = await agentApi(a, "/threads/" + id + "/settings", {
      requestId: j.id,
      settings: choice,
    });
    if (result.status !== "accepted")
      throw Error("设置提交结果未知，请重新读取官方状态后核对");
    j.clear();
    pendingSettings.delete(key);
    if (settingsContextMatches(t)) {
      await read();
      if (!settingsContextMatches(t)) return;
      t.current = liveSettingsState?.latestThreadSettings;
      t.choice = { ...t.choice, ...choice };
      if (!keepOpen && settingsTarget === t) closeSettingsMenu();
      toast("官方会话已接受，下一轮生效");
    }
  } catch (e) {
    if (settingsTarget === t) {
      t.error = e.message;
    } else if (settingsContextMatches(t)) error(e);
  } finally {
    t.saving = false;
    busy.delete(busyKey);
    permissions();
    if (settingsTarget === t) {
      renderSettingsMenu();
      if (keepOpen) $("effort-slider")?.focus();
    }
  }
}
for (const [id, kind] of [
  ["model-display", "model"],
  ["effort-display", "effort"],
  ["permission-display", "permission"],
]) {
  let wasOpen = false;
  $(id).onpointerdown = () => {
    wasOpen =
      settingsTarget?.kind === kind &&
      $("settings-menu").matches(":popover-open");
  };
  $(id).onclick = (e) => {
    if (e.detail && wasOpen) closeSettingsMenu();
    else openSettingsMenu(kind);
    wasOpen = false;
  };
}
$("settings-nav").onclick = () => openSettingsMenu("model");
$("settings-menu").addEventListener("toggle", (e) => {
  if (e.newState === "closed" && !$("settings-menu").matches(":popover-open"))
    closeSettingsMenu(false);
});
$("settings-menu").addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    e.preventDefault();
    closeSettingsMenu();
    return;
  }
  if (e.target.matches('input[type="range"]')) return;
  if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) return;
  const buttons = [
    ...$("settings-menu").querySelectorAll("button:not(:disabled)"),
  ];
  if (!buttons.length) return;
  e.preventDefault();
  const index = buttons.indexOf(document.activeElement);
  const next =
    e.key === "Home"
      ? 0
      : e.key === "End"
        ? buttons.length - 1
        : (index + (e.key === "ArrowDown" ? 1 : -1) + buttons.length) %
          buttons.length;
  buttons[next].focus();
});
window.addEventListener("resize", positionSettingsMenu);
window.addEventListener("scroll", positionSettingsMenu, true);
window.visualViewport?.addEventListener("resize", positionSettingsMenu);
window.visualViewport?.addEventListener("scroll", positionSettingsMenu);

for (const b of document.querySelectorAll(".close-dialog"))
  b.onclick = () => b.closest("dialog").close();
$("agent-dialog").addEventListener("close", () => {
  $("agent-key").value = "";
  deviceSettings.close();
});
$("remote-setup").onclick = async () => {
  $("setup-dialog").showModal();
  $("remote-info").textContent = "读取中…";
  try {
    const r = await api("/api/remote-info");
    $("remote-info").textContent =
      (r.listening
        ? "已监听 " + r.listening.address + ":" + r.listening.port
        : "远程入口尚未启用；当前只允许本机访问。") +
      "\n本机 Tailscale 地址：" +
      (r.addresses.join(" / ") || "未发现");
  } catch (e) {
    $("remote-info").textContent = e.message;
  }
};
$("help").onclick = () => $("remote-setup").click();
$("show-key").onclick = async () => {
  try {
    const r = await api("/api/pairing-key", {});
    $("pairing-key").value = r.key;
    $("pairing-key").type = "text";
    $("pairing-key").hidden = $("copy-key").hidden = false;
  } catch (e) {
    $("remote-info").textContent = e.message;
  }
};
$("copy-key").onclick = () =>
  navigator.clipboard
    .writeText($("pairing-key").value)
    .then(() => toast("连接密钥已复制"))
    .catch(() => toast("请选中密钥手动复制"));
$("setup-dialog").addEventListener("close", () => {
  $("pairing-key").value = "";
  $("pairing-key").hidden = $("copy-key").hidden = true;
});
api("/api/agents")
  .then(async (d) => {
    agents = d.agents;
    const saved = await readRecovery().catch(() => null);
    await switchAgent(
      saved && agents.some((a) => a.id === saved.agent)
        ? saved.agent
        : d.selectedId,
    );
    const requested =
      saved?.thread || new URL(location.href).searchParams.get("thread");
    if (requested && /^[a-f0-9-]{36}$/.test(requested))
      await selectThread(requested);
    if (saved) {
      draft = new Map(saved.drafts || []);
      pendingSettings = new Map(saved.settings || []);
      takenDrafts.clear();
      for (const [key, value] of saved.taken || []) takenDrafts.set(key, value);
      $("prompt").value = saved.prompt || "";
      if (saved.file) {
        const dt = new DataTransfer();
        dt.items.add(saved.file);
        $("image").files = dt.files;
      }
      renderAttachment();
      await clearRecovery();
    }
  })
  .catch(error)
  .finally(() => {
    booting = false;
    permissions();
  });
let checkingInstance = false;
setInterval(async () => {
  if (booting || checkingInstance) return;
  checkingInstance = true;
  try {
    const page = await (
      await fetch("/", { cache: "no-store", signal: AbortSignal.timeout(3000) })
    ).text();
    const current = /name="bridge-csrf" content="([a-f0-9]+)"/.exec(page)?.[1];
    if (current && current !== csrf) {
      await backupDrafts();
      location.reload();
      return;
    }
    await api("/api/updates/activity", {
      id: windowId,
      busy:
        !!document.querySelector("dialog[open]") ||
        !!$("prompt").value ||
        !!$("image").files[0] ||
        busy.size > 0 ||
        [...draft.values()].some(Boolean),
    });
  } catch {
  } finally {
    checkingInstance = false;
  }
}, 4000);

const mobileQuery = matchMedia(
  "(max-width:819px) and (orientation:portrait), (max-width:599px), (max-width:819px) and (min-height:501px)",
);
let drawerOpen = false,
  desktopCollapsed = false;
function syncLayout() {
  document.body.classList.toggle("mobile-layout", mobileQuery.matches);
  document.body.classList.toggle(
    "sidebar-collapsed",
    !mobileQuery.matches && desktopCollapsed,
  );
  closeDrawer(false);
}
function openDrawer() {
  if (!mobileQuery.matches) {
    desktopCollapsed = false;
    document.body.classList.remove("sidebar-collapsed");
    $("footer-agent").focus();
    return;
  }
  drawerOpen = true;
  document.body.classList.add("drawer-open");
  $("drawer-backdrop").hidden = false;
  $("sidebar").inert = false;
  $("sidebar").setAttribute("role", "dialog");
  $("sidebar").setAttribute("aria-modal", "true");
  document.querySelector(".conversation").inert = true;
  document.querySelector(".mobile-topbar").inert = true;
  $("mobile-menu").setAttribute("aria-expanded", "true");
  $("drawer-close").focus();
}
function closeDrawer(restoreFocus = true) {
  closeAgentMenu();
  const wasOpen = drawerOpen;
  drawerOpen = false;
  document.body.classList.remove("drawer-open");
  $("drawer-backdrop").hidden = true;
  $("sidebar").inert = mobileQuery.matches;
  $("sidebar").removeAttribute("role");
  $("sidebar").removeAttribute("aria-modal");
  document.querySelector(".conversation").inert = false;
  document.querySelector(".mobile-topbar").inert = false;
  $("mobile-menu").setAttribute("aria-expanded", "false");
  if (wasOpen && restoreFocus) $("mobile-menu").focus();
}
$("mobile-menu").onclick = openDrawer;
$("drawer-close").onclick = $("drawer-backdrop").onclick = () => closeDrawer();
$("sidebar-toggle").onclick = () => {
  if (mobileQuery.matches) openDrawer();
  else {
    closeAgentMenu();
    desktopCollapsed = !desktopCollapsed;
    document.body.classList.toggle("sidebar-collapsed", desktopCollapsed);
  }
};
window.addEventListener("keydown", (e) => {
  if (
    e.key === "Escape" &&
    !$("agent-menu").hidden &&
    !document.querySelector("dialog[open]")
  ) {
    e.preventDefault();
    closeAgentMenu(true);
    return;
  }
  if (
    drawerOpen &&
    e.key === "Escape" &&
    !document.querySelector("dialog[open]")
  ) {
    e.preventDefault();
    closeDrawer();
  }
  if (
    drawerOpen &&
    e.key === "Tab" &&
    !document.querySelector("dialog[open]")
  ) {
    const nodes = [
      ...$("sidebar").querySelectorAll("button:not(:disabled),input,summary,a"),
    ].filter((n) => n.offsetParent !== null);
    const first = nodes[0],
      last = nodes.at(-1);
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }
});
mobileQuery.addEventListener("change", syncLayout);
syncLayout();
for (const n of document.querySelectorAll("[data-icon]"))
  n.replaceChildren(icon(n.dataset.icon));
