import { draftBinding, protectRecovery, orphanEntries } from "./draft-guard.mjs";
import { ConnectionDiagnostics } from "./connection-diagnostics.mjs";
import { SidebarReports, sidebarIndicator } from "./sidebar-reports.mjs";
import { USER_INPUT_REQUEST } from "./official-events.mjs";
import { validateImageBatch, imagePayload, imageUrls } from "./image-input.mjs";
import { normalizeMode, matchesMode, modeTaskKey, modeCatalog, chatComposer, chatNotice, chatEmpty } from "./modes.mjs";
import { icon, markdown, copyMarkdown } from "./ui.mjs";
import { QueueUI } from "./queue-ui.mjs";
import { DraftDiscards } from "./draft-discards.mjs";
import { DeviceSettings, accessSummary } from "./device-settings.mjs";
import { QuestionsUI } from "./questions-ui.mjs";
import { questionReply, userContent } from "./message-content.mjs";
import { mergeTurns, overlaps } from "./conversation-history.mjs";
import { Reconnector } from "./reconnect.mjs";
import { clipboardImages } from "./clipboard-images.mjs";
import { HelpUpdates } from "./help-updates.mjs";
import { DeviceConnections } from "./device-connections.mjs";
import { zoomableImage } from "./image-viewer.mjs";
import { imageLoadState } from "./image-load-state.mjs";
import { ProjectPicker } from "./project-picker.mjs";
import { renderQuota, updateQuotaCountdowns } from "./usage-view.mjs";
import {
  windowId,
  saveRecovery,
  readRecovery,
} from "./update-recovery.mjs";
const $ = (id) => document.getElementById(id),
  csrf = document.querySelector("meta[name=bridge-csrf]").content;
const android = document.querySelector('meta[name="bridge-platform"]')?.content === "android";
if (android) {
  document.querySelector('.setup-local').hidden = true;
  document.querySelector('#help-automatic-updates').parentElement.lastChild.textContent = '自动检查并下载更新';
  document.querySelector('#help-update-error + .field-help').textContent = '更新当前 Android 应用；安装新版时需由系统确认。';
  document.querySelector('#setup-dialog > .field-help:last-of-type').textContent = '手机需连接 Tailscale。选择电脑后，消息由那台电脑上正在运行的官方 ChatGPT 处理。';
  document.addEventListener('click', async event => {
    const link = event.target.closest?.('a[download]');
    if (!link) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    try {
      if (link.dataset.downloadRoute) {
        await api('/api/downloads/start', { route: link.dataset.downloadRoute, name: link.download || 'image.png' });
        toast('正在读取原图，随后选择保存位置');
        return;
      }
      if (!/^(blob:|data:image\/)/.test(link.href)) throw Error('此下载格式暂不支持');
      const blob = await (await fetch(link.href)).blob();
      if (blob.size > 25 * 1024 * 1024) throw Error('图片超过 25 MiB 下载上限');
      const response = await fetch('/api/downloads/image?name=' + encodeURIComponent(link.download || 'image.png'), { method: 'POST', headers: { 'X-Bridge-CSRF': csrf, 'Content-Type': 'application/octet-stream' }, body: blob, signal: AbortSignal.timeout(75000) });
      if (!response.ok) throw Error((await response.json()).error || '图片保存失败');
      toast('请选择原图保存位置');
    } catch (e) { error(e); }
  }, true);
}
let agents = [],
  agentId = "local",
  selected = null,
  mode = normalizeMode(localStorage.getItem("remote-codex-mode")),
  generation = 0,
  readSequence = 0,
  agentReads = new AbortController(),
  taskReads = new AbortController(),
  readInFlight = null,
  status = {},
  taskData = null,
  projects = [],
  threads = [],
  turns = [],
  cursor = null,
  pageProtocol = null,
  gapCursor = null,
  headHash = null,
  historyReadNotice = null,
  historyFailure = null,
  visibleReport = null,
  receiptTimer = null,
  editing = null,
  streamAbort = null,
  viewerRecovery = null,
  streamLastSeen = 0,
  readTimer = null,
  readRetryTimer = null,
  readFailures = 0,
  viewingSubscription = null,
  busy = new Set(),
  draft = new Map(),
  connectionStates = new Map(),
  viewEpoch = 0,
  routeHistory = [],
  routeIndex = -1,
  attachmentUrls = [], composerImages = [];
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
const sidebarReports = new SidebarReports({
  read: (id, signal) => agentApi(id, '/task-summary', undefined, { signal: AbortSignal.any([signal, AbortSignal.timeout(22000)]) }),
  changed: updateThreadIndicators,
});
function refreshSidebarReports(invalidate = false) {
  if (invalidate) { sidebarReports.reset(); updateThreadIndicators(); }
  if (!booting && !document.hidden && status.connected && agentId && mode === 'codex') sidebarReports.refresh(agentId);
}
let sidebarSequence = 0,
  sidebarPolling = false;
const currentAgent = () => agents.find((a) => a.id === agentId);
const endpoint = (a) =>
  a.kind === "local"
    ? "本机直连 · " + a.host
    : (a.host.includes(":") ? "[" + a.host + "]" : a.host) + ":" + a.port;
const base = (id) => "/api/agents/" + encodeURIComponent(id) + "/bridge";
const taskKey = (a = agentId, t = selected, m = mode) => modeTaskKey(a, t, m);
const modeSelections = new Map();
const takenDrafts = new Map();
let draftBindings = new Map(), orphanedDrafts = [];
let recoveryLoaded = false;
const draftDiscards = new DraftDiscards({
  api: agentApi,
  persist: backupDrafts,
  onChange: () => queueUI.render(),
  onError: () => toast("草稿清理尚未完成，将自动重试"),
});
const deviceSettings = new DeviceSettings({
  $,
  api,
  agentApi,
  toast,
  backupDrafts,
});
const helpUpdates = new HelpUpdates({ $, api, backupDrafts });
const projectPicker = new ProjectPicker({ $, changed: () => {
  permissions();
  backupDrafts().catch(error);
} });
function draftSnapshot() {
  return {
    deviceBindings: [...draftBindings], orphanedDrafts,
    agent: agentId,
    mode,
    modeSelections: [...modeSelections],
    thread: selected,
    drafts: [...draft],
    taken: [...takenDrafts],
    discardedRecoveries: draftDiscards.snapshot(),
    settings: [...pendingSettings],
    creationProjects: projectPicker.snapshot(),
    prompt: $("prompt").value,
    files: [...composerImages],
    questions: questionUI.snapshot(),
  };
}
function guardDraftTargets() {
  const protectedDrafts = protectRecovery(draftSnapshot(), agents);
  if (protectedDrafts.saved.orphanedDrafts.length === orphanedDrafts.length && !protectedDrafts.blockedActive) return false;
  const saved = protectedDrafts.saved;
  draft = new Map(saved.drafts);pendingSettings = new Map(saved.settings);
  takenDrafts.clear();for(const [key,value] of saved.taken)takenDrafts.set(key,value);
  modeSelections.clear();for(const [key,value] of saved.modeSelections)modeSelections.set(key,value);
  draftDiscards.entries.clear();draftDiscards.restore(saved.discardedRecoveries);
  questionUI.restore(saved.questions);projectPicker.restore(saved.creationProjects);
  draftBindings = new Map(saved.deviceBindings);orphanedDrafts = saved.orphanedDrafts;
  if(protectedDrafts.blockedActive){
    setPromptValue("");setImages([]);renderAttachment();
    selected=null;
    if(currentAgent())newConversation(false,{preserveDrawer:true});
  }
  renderOrphanNotice();return protectedDrafts.blockedActive;
}
async function backupDrafts() {
  if (booting || !recoveryLoaded) return;
  saveDraft();guardDraftTargets();await saveRecovery(draftSnapshot());
}
let draftBackupTimer;
function scheduleDraftBackup() {
  clearTimeout(draftBackupTimer);
  draftBackupTimer = setTimeout(() => backupDrafts().catch(error), 200);
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
    hasDraft: !!$("prompt").value.trim() || !!composerImages[0],
    recoveryId: takenDrafts.get(taskKey())?.recoveryId,
  }),
  api: agentApi,
  loadImage: async (context, ref, signal) => {
    const response = await fetch(base(context.agent) + `/threads/${context.id}/media?id=${encodeURIComponent(ref.id)}`, {
      headers: { "X-Bridge-CSRF": csrf },
      signal: AbortSignal.any([signal, agentReads.signal, taskReads.signal, AbortSignal.timeout(75000)]),
    });
    if (!response.ok) throw Error("排队图片暂时不可用");
    return response.blob();
  },
  journal,
  onChange: permissions,
  onError: error,
  onToast: toast,
  restoreDraft: async (message, recoveryId, context) => {
    if (draftDiscards.has(context, recoveryId)) return;
    if (context.key !== taskKey()) {
      toast("消息已取回并保存，切回原会话可继续编辑");
      return;
    }
    if ($("prompt").value.trim() || composerImages[0]) {
      toast("输入框已有草稿，取回的消息已另外保存");
      return;
    }
    setPromptValue(message.text);
    draft.set(taskKey(), message.text);
    takenDrafts.set(taskKey(), { message, recoveryId });
    await restoreTakenImage();
    renderAttachment();
    permissions();
    queueUI.render();
    await backupDrafts();
    if (context.key === taskKey()) $("prompt").focus();
  },
  isDiscarded: (c, recoveryId) => draftDiscards.has(c, recoveryId),
  discardRecovery: discardTakenRecovery,
  onRefresh: c => { if (!booting) draftDiscards.flush(c); },
});
async function discardTakenRecovery(recoveryId, context) {
  // Detach only this backup; newer text/images remain an ordinary local draft.
  const saved = takenDrafts.get(context.key);
  if (saved?.recoveryId === recoveryId) {
    delete saved.recoveryId; delete saved.message;
    if (!(saved.files?.length || saved.file)) takenDrafts.delete(context.key);
  }
  draftDiscards.add(context, recoveryId);
  await backupDrafts();
  await draftDiscards.flush(context);
}
function discardEmptyTakenDraft() {
  // Only user edits reach this function. Navigation, loading and startup also
  // clear the composer transiently and must never discard a recoverable draft.
  if ($("prompt").value.trim() || composerImages.length) return;
  const recoveryId = takenDrafts.get(taskKey())?.recoveryId;
  if (!recoveryId) return;
  discardTakenRecovery(recoveryId, { agent: agentId, id: selected, key: taskKey(), connected: !!status.connected }).catch(error);
}
function setImages(files) {
  composerImages = [...files];
  const transfer = new DataTransfer();
  for (const file of composerImages) transfer.items.add(file);
  $("image").files = transfer.files;
}
async function restoreTakenImage() {
  const saved = takenDrafts.get(taskKey());
  if (saved && (Object.hasOwn(saved, "files") || Object.hasOwn(saved, "file"))) {
    setImages(saved.files ?? (saved.file ? [saved.file] : []));
    return;
  }
  setImages(imageUrls(saved?.message?.imageDataUrls ?? saved?.message?.imageDataUrl).map((data, i) => {
    const bytes = Uint8Array.from(atob(data.split(",")[1]), c => c.charCodeAt(0));
    const mime = data.slice(5, data.indexOf(";"));
    return new File([bytes], "queued-image-" + (i + 1) + "." + mime.split("/")[1], { type: mime });
  }));
}
const stateNames = {
  history: "历史记录",
  systemError: "出错",
  active: "运行中",
  running: "运行中",
  idle: "空闲",
  completed: "已完成",
  unread: "未读回报",
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
  const source = mode === "chat" ? "官方 Chat 状态查询（非订阅）" : "官方桌面实时查询";
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
  const runtime = status.connected
    ? (sidebarStates.get(thread.id) ?? sidebarStatus(thread.status))
    : { type: "connection-interrupted", confirmed: false };
  const state = sidebarIndicator(runtime, sidebarReports.get(thread.id), mode, status.connected);
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
      : type === "unread"
        ? "thread-dot unread"
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
function renderOrphanNotice() {
  const button=$("orphan-drafts");if(!button)return;
  button.hidden=!orphanedDrafts.length;button.textContent="保留的草稿（"+orphanedDrafts.length+"）";
}
function openOrphanDrafts() {
  const dialog=$("orphan-dialog"),rows=$("orphan-draft-rows");rows.replaceChildren();
  for(const orphan of orphanedDrafts){
    const card=node('section','diagnostic-check');card.append(node('strong','',orphan.name+' · '+orphan.reason));
    for(const row of orphanEntries(orphan)){
      card.append(node('p','orphan-preview',row.text||'图片草稿'));
      const source=row.taken,files=source?.files??(source?.file?[source.file]:imageUrls(source?.message?.imageDataUrls??source?.message?.imageDataUrl).map((data,i)=>new File([Uint8Array.from(atob(data.split(',')[1]),c=>c.charCodeAt(0))],'recovered-'+(i+1)+'.png',{type:data.slice(5,data.indexOf(';'))})));
      if(files.length)card.append(node('p','field-help',files.length+' 张原始图片已保留'));
      const target=currentAgent(),targetMode=mode,targetBinding=draftBinding(target);
      const restore=node('button','',target?'放入「'+target.name+' · '+targetMode+'」的新对话':'请先选择设备');
      restore.disabled=!target||selected!==null||!!$('prompt').value||!!composerImages.length||(row.mode&&row.mode!==mode)||mode==='chat';
      restore.onclick=async()=>{try{
        if(target?.id!==agentId||targetMode!==mode||targetBinding!==draftBinding(currentAgent())||selected!==null||$('prompt').value||composerImages.length)throw Error('目标或输入框已变化，请重新打开草稿列表');
        validateImageBatch(files);setPromptValue(row.text);setImages(files);renderAttachment();saveDraft();permissions();await backupDrafts();dialog.close();closeDrawer(false);toast('已放入当前新对话，保护备份仍保留');
      }catch(e){error(e);}};
      const copy=node('button','','复制文字');copy.disabled=!row.text;copy.onclick=()=>navigator.clipboard.writeText(row.text).then(()=>toast('已复制草稿文字')).catch(error);
      const actions=node('div','diagnostic-actions');actions.append(restore,copy);card.append(actions);
    }
    const remove=node('button','','删除这份保护备份');remove.onclick=async()=>{
      const previous=orphanedDrafts;orphanedDrafts=orphanedDrafts.filter(o=>o.id!==orphan.id);
      try{await backupDrafts();renderOrphanNotice();openOrphanDrafts();}catch(e){orphanedDrafts=previous;error(e);}
    };card.append(remove);rows.append(card);
  }
  if(!orphanedDrafts.length)rows.append(node('p','','没有另外保留的草稿。'));
  if(!dialog.open)dialog.showModal();
}
function error(e) {
  $("error").textContent = e.message ?? String(e);
  $("error").hidden = false;
}
function clearError() {
  $("error").hidden = true;
}
function updateHistoryNotice() {
  $("history-notice").textContent = historyFailure
    ? "这段历史暂时无法读取，已保留当前内容。可点击下方按钮重试。"
    : historyReadNotice ?? "";
  $("history-notice").hidden = !$("history-notice").textContent;
}
const acknowledgedReports = new Map();
function checkVisibleReport() {
  clearTimeout(receiptTimer);
  const report = visibleReport;
  if (mode !== "codex" || !report || !status.connected || document.hidden || !document.hasFocus() || document.querySelector(".conversation").inert || !status.taskSummary?.readReceipts) return;
  const key = report.a + ":" + report.id + ":" + viewEpoch;
  if (acknowledgedReports.get(key) === report.token) return;
  receiptTimer = setTimeout(async () => {
    if (visibleReport !== report || report.g !== generation || report.id !== selected || !status.connected || document.hidden || !document.hasFocus() || document.querySelector(".conversation").inert) return;
    const scroll = $("message-scroll"), item = $("messages").querySelector('[data-item-id="' + CSS.escape(report.itemId) + '"]');
    if (!item || scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight > 80) return;
    const rect = item.getBoundingClientRect(), viewport = scroll.getBoundingClientRect();
    if (rect.bottom < viewport.top || rect.top > viewport.bottom) return;
    // Suppress duplicate attempts in this viewing episode, including lost
    // acknowledgements. This does not decide or persist an unread state.
    acknowledgedReports.set(key, report.token);
    try {
      const result = await agentApi(report.a, "/threads/" + report.id + "/read-receipt", { token: report.token });
      if (report.a === agentId && report.g === generation) refreshSidebarReports(true);
      if (!result.accepted && visibleReport === report)
        toast("官方已读状态尚未确认，统计以官方为准");
    } catch { /* Do not replay an uncertain notification or infer local read. */ }
  }, 800);
}
function toast(text) {
  $("toast").textContent = text;
  $("toast").hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => ($("toast").hidden = true), 3200);
}
async function api(route, body, options = {}) {
  const signal = AbortSignal.any([
    AbortSignal.timeout(body === undefined ? 75000 : 90000),
    ...(options.signal ? [options.signal] : []),
  ]);
  try {
    const r = await fetch(route, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        "X-Bridge-CSRF": csrf,
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      ...options,
      signal,
    });
    const d = await r.json();
    if (!r.ok) {
      const e = Error(d.error ?? "请求失败");
      e.status = r.status;
      throw e;
    }
    return d;
  } catch (e) {
    if (e.name === "TimeoutError")
      throw Error(
        body === undefined
          ? "读取超时，请刷新重试；官方任务继续运行"
          : "请求超时，提交结果未知；请先刷新核对，不要重复发送",
      );
    throw e;
  }
}
function agentApi(id, route, body, options = {}) {
  if (route.endsWith('/follow') && body && body.following !== false && id === agentId && route === '/threads/' + selected + '/follow') {
    body = { ...body, viewerId: windowId + '-' + viewEpoch };
    viewingSubscription = { agent: id, thread: selected, viewerId: body.viewerId, leased: status.viewerLeases === true };
  }
  // Cancel viewing requests only. Never cancel or replay a dispatched task write.
  const signals = options.signal ? [options.signal] : [];
  if (body === undefined && id === agentId) {
    signals.push(agentReads.signal);
    if (selected && route.startsWith("/threads/" + selected))
      signals.push(taskReads.signal);
  }
  return api(base(id) + route, body, {
    ...options,
    ...(signals.length ? { signal: AbortSignal.any(signals) } : {}),
  });
}
function resetTaskReads() {
  releaseViewing();
  readSequence++;
  clearTimeout(readTimer);
  readTimer = null;
  clearTimeout(readRetryTimer);
  readRetryTimer = null;
  readFailures = 0;
  taskReads.abort();
  taskReads = new AbortController();
  readInFlight = null;
  pageProtocol = null;
  gapCursor = null;
  headHash = null;
  historyReadNotice = historyFailure = null;
  visibleReport = null;
  clearTimeout(receiptTimer);
  updateHistoryNotice();
}
function scheduleRead(older = false) {
  // Throttle instead of debounce: continuous events must still make progress.
  if (readTimer !== null || readRetryTimer !== null) return;
  readTimer = setTimeout(() => {
    readTimer = null;
    read(older);
  }, 500);
}
const questionUI = new QuestionsUI(async (context, payload) => {
  const j = await journal(
    context.agent,
    context.id,
    "question-answer:" + (payload.questionRequestId ?? payload.answers[0]?.questionItemId),
    payload,
    "question-answer",
  );
  const result = await agentApi(
    context.agent,
    "/threads/" + context.id + "/questions",
    { ...payload, requestId: j.id },
  );
  if (result.status !== "accepted")
    throw Error("回答结果未知，请刷新核对，不要重复发送");
  // Retain the per-question request ID: acknowledgement is not an answer.
  // An explicit retry of the same answer must not dispatch it twice.
  if (context.agent === agentId && context.id === selected)
    setTimeout(() => read(), 250);
}, scheduleDraftBackup);
const messageImageCache = new Map();
const messageImageObserver = new IntersectionObserver(
  (entries) => {
    for (const entry of entries)
      if (entry.isIntersecting) {
        messageImageObserver.unobserve(entry.target);
        entry.target.loadImage?.();
      }
  },
  { root: $("message-scroll"), rootMargin: "240px" },
);
function messageImage(ref) {
  const box = node("div", "message-image"),
    img = node("img"),
    link = node("a", "image-download", "下载原图");
  img.alt = ref.name ?? "图片附件";
  zoomableImage(img, ref.name ?? "image.png");
  img.decoding = "async";
  link.download = ref.name ?? "image.png";
  link.hidden = true;
  const imageAgent = agentId,
    imageThread = selected,
    imageSignals = [agentReads.signal, taskReads.signal];
  if (ref.id) img.dataset.downloadRoute = link.dataset.downloadRoute = base(imageAgent) + '/threads/' + imageThread + '/media?id=' + encodeURIComponent(ref.id);
  const key = imageAgent + ":" + imageThread + ":" + (ref.id ?? ref.src);
  let started = false, ready;
  const forget = () => {
    if (messageImageCache.get(key) !== ready) return;
    messageImageCache.delete(key);
    ready?.then(url => { if (url.startsWith("blob:")) URL.revokeObjectURL(url); }).catch(() => {});
  };
  const state = imageLoadState(img, {
    ready: () => { link.href = img.src; link.hidden = false; },
    failed: () => { started = false; link.hidden = true; link.removeAttribute("href"); forget(); },
    retry: () => { img.removeAttribute("src"); box.loadImage(); },
  });
  box.append(img, state.element, link);
  box.loadImage = () => {
    if (started || imageSignals.some(signal => signal.aborted)) return;
    started = true;
    state.loading();
    ready = messageImageCache.get(key);
    if (!ready) {
      ready = ref.src
        ? Promise.resolve(ref.src)
        : fetch(
            base(imageAgent) +
              "/threads/" +
              imageThread +
              "/media?id=" +
              encodeURIComponent(ref.id),
            {
              headers: { "X-Bridge-CSRF": csrf },
              signal: AbortSignal.any([
                ...imageSignals,
                AbortSignal.timeout(75000),
              ]),
            },
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
        if (imageSignals.some(signal => signal.aborted)) return;
        img.src = src;
        link.rel = "noopener";
      })
      .catch(() => {
        forget();
        if (!imageSignals.some(signal => signal.aborted)) state.error();
      });
  };
  messageImageObserver.observe(box);
  return box;
}
function permissions() {
  const fresh = selected === null;
  const canDraft = fresh && mode === "codex" && !!currentAgent();
  const readOnlyTask = (
    status.readOnlyThreadIds ??
    status.protectedThreadIds ?? [status.protectedThreadId]
  ).includes(selected);
  const chat = mode === "chat";
  const chatAccess = chatComposer(status, taskData?.thread);
  const writable = chat ? !readOnlyTask && chatAccess.writable :
    (fresh && !!currentAgent() && status.existingCodexWritable === true) ||
    (!readOnlyTask && status.existingCodexWritable === true && taskData?.thread?.kind === "codex");
  const inFlight = busy.has(fresh ? agentId + ":create" : taskKey());
  projectPicker.update({ agentId, mode, fresh, projects, status, busy: inFlight, booting });
  const settingsAvailable =
    !chat && status.connected &&
    writable &&
    (fresh ||
      ["idle", "active", "notLoaded"].includes(taskData?.thread?.status?.type));
  if (settingsTarget && !settingsAvailable) closeSettingsMenu(false);
  const submitting = inFlight || queueUI.busy;
  queueWritable = !chat && writable && !booting;
  const idle =
    fresh || ["idle", "notLoaded"].includes(taskData?.thread?.status?.type);
  $("create").disabled = $("mobile-new").disabled = busy.has(
    agentId + ":create",
  );
  $("prompt").disabled = booting || !(writable || canDraft) || submitting;
  $("image").disabled =
    chat || (!fresh && !status.connected) ||
    !(writable || canDraft) ||
    inFlight ||
    taskData?.thread?.status?.type === "notLoaded";
  $("attach-label").title = fresh && status.imageCreation?.supported !== true
    ? "可先添加图片；更新目标电脑的 Remote Codex 后发送"
    : "添加图片（最多 20 张，每张 5 MB，合计 10 MB；PNG / JPEG / WebP）";
  $("send").disabled =
    booting ||
    !status.connected ||
    !writable ||
    inFlight ||
    !!projectPicker.reason() ||
    (chat ? !chatAccess.canSend : (!idle && taskData?.thread?.status?.type !== "active")) ||
    queueUI.busy ||
    (fresh && composerImages.length > 0 && status.imageCreation?.supported !== true) ||
    (!$("prompt").value.trim() && !composerImages.length);
  $("send").title = submitting
    ? "提交中…"
    : !idle && !chat
      ? "Enter 加入队列；Ctrl+Enter 立即调整方向"
      : "发送消息";
  $("send").setAttribute("aria-label", !idle && !chat ? "加入队列" : "发送消息");
  $("open").disabled = !status.connected || fresh || readOnlyTask;
  $("listfiles").disabled = chat || !status.connected || fresh;
  for (const id of ["permission-display", "effort-display", "settings-nav", "attach-label", "files-nav", "toggle-files", "mobile-files"]) {
    if ($(id)) $(id).hidden = chat;
  }
  $("model-display").disabled =
    $("effort-display").disabled =
    $("permission-display").disabled =
    $("settings-nav").disabled =
      !settingsAvailable || inFlight;
  const stopSupported = status.interrupt?.supported === true;
  const stopRunning = taskData?.live?.status?.confirmed
    ? ["running", "waiting-approval", "waiting-user-input"].includes(taskData.live.status.type)
    : taskData?.thread?.status?.type === "active";
  $("interrupt").hidden = !(
    !chat && status.connected && writable && stopSupported &&
    !readOnlyTask &&
    !fresh &&
    stopRunning
  );
  $("send").hidden = !$("interrupt").hidden && !$("prompt").value.trim() && !composerImages.length;
  $("interrupt").disabled = booting || !interruptTurnId() || inFlight;
  $("interrupt").title = inFlight ? "正在提交…" : !interruptTurnId()
    ? "正在确认当前运行轮次…" : "停止当前回复";
  $("older").disabled = !status.connected || !!readInFlight;
  $("refresh").disabled = !status.connected;
  $("writable").textContent = !status.connected
    ? "连接中断 · 状态未知"
    : !writable
      ? readOnlyTask
        ? "此设备将该会话设为只读"
        : !fresh && !taskData
          ? "会话内容尚未读入，请等待或刷新重试"
          : status.desktopCompatibility?.writeSupported === false
            ? "目标官方桌面版本尚未验证，请在官方桌面操作"
            : "当前仅支持 Codex 对话写入"
      : inFlight
        ? "正在提交…"
        : !fresh && !idle
          ? status.steer?.supported === true ? "Enter 排队 · Ctrl+Enter 调整方向" : "发送后排队 · 可在队列中调整方向"
          : taskData?.thread?.status?.type === "notLoaded"
            ? "发送文字时由官方桌面继续此会话"
            : "";
  if (writable && fresh && composerImages.length && status.imageCreation?.supported !== true)
    $("writable").textContent = "目标电脑尚不支持带图新建，请更新目标电脑；文字和图片已保留";
  if (chat && !readOnlyTask) $("writable").textContent = inFlight ? "正在转交官方 Chat…" : chatAccess.reason;
  if (!chat && projectPicker.reason()) $("writable").textContent = projectPicker.reason();
  $("destination").textContent = currentAgent()?.name ?? "";
  queueUI.render();
}
function modelSettings(state) {
  liveSettingsState = state;
  if (mode === "chat") {
    liveSettingsState = null;
    $("model-display").textContent = "官方 Chat 模型";
    $("model-display").title = "沿用此会话在官方 ChatGPT 中的模型；模型列表与切换尚未接入";
    $("model-display").setAttribute("aria-label", "官方 Chat 模型，需在官方桌面切换");
    return;
  }
  const pending = pendingSettings.get(taskKey());
  const settings = { ...state?.latestThreadSettings, ...pending };
  const model = settings?.model ?? state?.latestModel;
  const loaded = ["idle", "active"].includes(taskData?.thread?.status?.type);
  const displayedModel = loaded && !model ? "模型未确认" : modelName(model);
  $("model-display").replaceChildren(
    icon("bolt"),
    node("span", "model-name", displayedModel),
  );
  $("model-display").setAttribute(
    "aria-label",
    "选择模型 · " + displayedModel,
  );
  $("effort-display").replaceChildren(
    node(
      "span",
      "",
      effortNames[
        pending
          ? pending.effort
          : (settings?.effort ?? state?.latestReasoningEffort)
      ] ?? (loaded && !pending ? "未确认" : "默认"),
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
          : loaded && !pending ? "权限未确认" : "桌面默认权限";
  $("permission-display").classList.toggle(
    "full-access",
    policy === "dangerFullAccess",
  );
  $("permission-display").title = "调整此会话下一轮的权限";
  $("model-display").title = pending
    ? "下次发送时应用所选模型"
    : "更换模型与推理强度";
  $("effort-display").title = "调整推理强度";
  const target = settingsTarget;
  if (settingsContextMatches(target) && target.loaded && !pending) {
    const choice = { ...state?.latestThreadSettings,
      model: state?.latestThreadSettings?.model ?? state?.latestModel,
      effort: state?.latestThreadSettings?.effort ?? state?.latestReasoningEffort };
    const changed = JSON.stringify(target.choice) !== JSON.stringify(choice);
    target.current = state?.latestThreadSettings;
    target.choice = choice;
    if (changed) renderSettingsMenu();
  }
}
function setConnection(connected, text) {
  if (!connected) {
    sidebarReports.reset();
    closeSettingsMenu(false);
    resetTaskReads();
    taskData = null;
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
    $("task-state").hidden = !selected;
    $("task-state").className = "badge offline";
    $("activity").hidden = true;
    viewerRecovery?.request();
  }
}
function startViewerRecovery(id, g) {
  viewerRecovery = new Reconnector(
    async (signal) => {
      const options = {
        signal: AbortSignal.any([
          signal,
          agentReads.signal,
          AbortSignal.timeout(20000),
        ]),
      };
      try {
        let snapshot = await agentApi(id, "/status", undefined, options);
        if (!snapshot.connected)
          snapshot = await agentApi(id, "/connect", {}, options);
        if (g !== generation || signal.aborted) return;
        if (!snapshot.connected) throw Error("官方桌面尚未连接");
        status = snapshot;
        setConnection(true);
        clearError();
        if (!streamAbort || streamAbort.signal.aborted) stream(id, g);
        refreshUsage();
        if (selected) {
          const task = selected;
          const followSignal = AbortSignal.any([
            signal,
            taskReads.signal,
            agentReads.signal,
            AbortSignal.timeout(20000),
          ]);
          if (mode === "codex") agentApi(
            id,
            "/threads/" + task + "/follow",
            {},
            { signal: followSignal },
          )
            .then(() => {
              if (g === generation && task === selected) read();
            })
            .catch(() => {});
          read();
        }
        await refresh(g, options);
        if (g !== generation || signal.aborted) return;
        if (!status.connected) throw Error("官方桌面尚未连接");
        modeUI();
      } catch (e) {
        if (g !== generation || signal.aborted) return;
        setConnection(false);
        throw e;
      }
    },
    {
      onRetry: (delay) => {
        if (g === generation) {
          $("connection").textContent = delay
            ? `连接中断 · ${Math.ceil(delay / 1000)} 秒后自动重连`
            : "正在重新连接…";
        }
      },
    },
  );
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
  $("refresh-usage").disabled = usagePending || !status.connected;
  renderQuota({ $ , data: usageData, state: usageState, connected: status.connected, reason: usageReason });
}
async function refreshUsage() {
  if (!status.connected || usagePending) return;
  const id = agentId,
    g = generation,
    sequence = ++usageSequence;
  usagePending = true;
  renderUsage();
  try {
    const result = await agentApi(id, "/usage", undefined, {
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
      result.status === "available" && (Array.isArray(result.weekly) || Array.isArray(result.fiveHour))
        ? "available"
        : "unknown";
    usageReason = "官方未提供可用的额度";
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
let agentRefresh = 0;
const reportedStorageRecovery = new Set();
function storageNotice(data) {
  if (data.storage?.recovered && !reportedStorageRecovery.has(data.storage.source)) {
    reportedStorageRecovery.add(data.storage.source);
    toast(data.storage.warning);
  }
}
async function openAgentMenu() {
  $("agent-menu").hidden = false;
  $("footer-agent").setAttribute("aria-expanded", "true");
  $("agents").querySelector('[aria-current="true"]')?.focus();
  refreshUsage();
  const request = ++agentRefresh;
  try {
    const data = await api("/api/agents");
    if (request !== agentRefresh) return;
    agents = data.agents;
    storageNotice(data);
    const focusedId = document.activeElement?.dataset.agentId;
    renderAgents();
    if (!$("agent-menu").hidden && focusedId)
      [...$("agents").children].find(item => item.dataset.agentId === focusedId)?.focus();
    if (!currentAgent()) await switchAgent(data.selectedId || agents[0]?.id || "");
    else {
      $("agent-title").textContent = currentAgent().name;
      $("agent-endpoint").textContent = endpoint(currentAgent());
    }
  } catch (e) { error(e); }
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
async function refresh(g = generation, options = {}) {
  const id = agentId,
    sequence = ++sidebarSequence;
  const [p, t, s] = await Promise.all([
    agentApi(id, "/projects", undefined, options),
    agentApi(id, "/threads", undefined, options),
    agentApi(id, "/status", undefined, options),
  ]);
  if (g !== generation) return;
  status = s;
  threads = modeCatalog(t.data, mode);
  projects = (p.data.projects ?? []).filter(p => mode === "chat" ? (p.projectKind ?? p.kind) === "chatgpt" || threads.some(t => t.projectId === p.projectId) : (p.projectKind ?? p.kind) !== "chatgpt");
  for (const thread of threads)
    rememberSidebarStatus(
      thread.id,
      sidebarStatus(thread.status, s.threads?.[thread.id]?.status),
      sequence,
    );
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
  refreshSidebarReports();
}
async function pollSidebar() {
  if (sidebarPolling || booting || document.hidden || !status.connected) return;
  const polling = {};
  sidebarPolling = polling;
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
    status = { ...status, ...snapshot };
    threads = modeCatalog(list.data, mode);
    for (const t of threads)
      rememberSidebarStatus(
        t.id,
        sidebarStatus(t.status, snapshot.threads?.[t.id]?.status),
        sequence,
      );
    renderThreads();
    permissions();
    refreshSidebarReports();
  } catch {
    if (g === generation) setConnection(false, "状态读取失败 · 状态未知");
  } finally {
    if (sidebarPolling === polling) sidebarPolling = false;
  }
}
function saveDraft() {
  if (currentAgent() && !draftBindings.has(agentId)) draftBindings.set(agentId,{binding:draftBinding(currentAgent()),name:currentAgent().name});
  draft.set(taskKey(), $("prompt").value);
  const saved = takenDrafts.get(taskKey());
  const files = [...composerImages];
  if (saved) { saved.files = files; delete saved.file; }
  else if (files.length) takenDrafts.set(taskKey(), { files });
}
async function switchAgent(id, record = true, resumeId = null, nextMode = mode) {
  sidebarReports.reset();
  $("mode-menu").hidePopover();
  viewerRecovery?.stop();
  viewerRecovery = null;
  closeSettingsMenu(false);
  saveDraft();
  guardDraftTargets();
  modeSelections.set(agentId + ":" + mode, selected);
  mode = normalizeMode(nextMode);
  localStorage.setItem("remote-codex-mode", mode);
  modeUI();
  const g = ++generation;
  agentReads.abort();
  agentReads = new AbortController();
  resetTaskReads();
  sidebarPolling = false;
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
  closeAgentMenu();
  $("empty").hidden = false;
  $("file-tray").hidden = true;
  setPromptValue(draft.get(taskKey()) ?? "");
  setImages([]);
  await restoreTakenImage();
  if (g !== generation) return;
  renderAttachment();
  $("search").value = "";
  $("project-filter").replaceChildren(new Option("所有项目", "all"));
  clearError();
  if (!currentAgent()) {
    agentId = "";
    $("agent-title").textContent = "添加电脑";
    $("agent-endpoint").textContent = "通过 Tailscale 连接";
    $("empty-title").textContent = "连接你的电脑";
    $("empty-description").textContent = "从左下角添加设备，填写电脑的 Tailscale IP、端口和访问密钥。";
    $("connection").textContent = "尚未添加设备";
    $("connection").className = "badge neutral";
    resetUsage("unknown", "先添加一台电脑");
    renderAgents(); renderThreads(); permissions();
    return;
  }
  $("agent-title").textContent = currentAgent().name;
  $("agent-endpoint").textContent = endpoint(currentAgent());
  $("empty-title").textContent = "今天有什么安排？";
  $("empty-description").textContent = "正在读取这台电脑上的官方 ChatGPT。";
  $("connection").textContent = "正在连接";
  $("connection").className = "badge neutral";
  renderAgents();
  renderThreads();
  permissions();
  startViewerRecovery(id, g);
  try {
    await api(
      "/api/agents/select",
      { id },
      { signal: AbortSignal.timeout(10000) },
    );
    if (g !== generation) return;
    await backupDrafts();
    if (g !== generation) return;
    let s = await agentApi(id, "/status");
    if (!s.connected)
      s = await agentApi(id, "/connect", {}, { signal: agentReads.signal });
    if (g !== generation) return;
    status = s;
    setConnection(!!s.connected);
    if (!s.connected)
      throw Error("桥接程序可访问，但这台电脑的官方 ChatGPT 尚未连接");
    refreshUsage();
    await refresh(g);
    if (g !== generation) return;
    modeUI();
    stream(id, g);
    if (record) recordRoute(id, null);
    if (resumeId) await selectThread(resumeId, false, { preserveDrawer: true });
  } catch (e) {
    if (g !== generation) return;
    setConnection(false);
    error(e);
    $("empty-title").textContent = "暂时无法连接 " + currentAgent().name;
    $("empty-description").textContent =
      "地址已保存，正在自动重连。请保持目标电脑的桥接程序打开。";
    renderThreads();
    if (resumeId) await selectThread(resumeId, false, { preserveDrawer: true });
  }
}
async function selectThread(id, record = true, { preserveDrawer = false } = {}) {
  const a = agentId,
    g = generation;
  closeSettingsMenu(false);
  viewEpoch++;
  document.querySelector(".conversation").classList.remove("is-new");
  // Restoring a task after a mode/device change must not dismiss navigation.
  if (!preserveDrawer) closeDrawer(false);
  if (record) recordRoute(agentId, id);
  saveDraft();
  selected = id;
  modeSelections.set(agentId + ":" + mode, id);
  queueUI.reset();
  resetTaskReads();
  taskData = null;
  modelSettings(null);
  turns = [];
  cursor = null;
  $("messages").replaceChildren();
  $("messages").append(node("p", "read-notice", "正在读取会话内容…"));
  $("files").replaceChildren();
  $("file-tray").hidden = true;
  $("empty").hidden = true;
  $("task-view").hidden = false;
  $("title").textContent =
    threads.find((t) => t.id === id)?.title ?? "读取任务…";
  $("task-agent").textContent = currentAgent().name;
  $("task-state").textContent = "读取中";
  $("task-state").hidden = false;
  $("activity").hidden = true;
  $("older").hidden = true;
  $("task-state").className = "badge neutral";
  setPromptValue(draft.get(taskKey()) ?? "");
  setImages([]);
  await restoreTakenImage();
  if (g !== generation || a !== agentId || id !== selected) return;
  renderAttachment();
  clearError();
  renderThreads();
  permissions();
  if (!status.connected) {
    setConnection(false);
    return;
  }
  if (mode === "codex") agentApi(
    a,
    "/threads/" + id + "/follow",
    {},
    { signal: taskReads.signal },
  ).catch((e) => {
    if (
      g === generation &&
      selected === id &&
      e.name !== "AbortError" &&
      !e.message.includes("no-client-found")
    )
      error(Error("历史可读；实时状态尚不可用：" + e.message));
  });
  await read();
}
function renderItem(item, turnId) {
  const pending = item.type === "userInputResponse" && liveSettingsState?.requests?.find(r =>
    r.method === USER_INPUT_REQUEST && r.params?.turnId === turnId && String(r.id) === String(item.requestId));
  if (pending) item = { ...item, completed: false, answers: undefined, questions: pending.params.questions ?? item.questions };
  const question = mode === "codex" && questionUI.render(item, {
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
    const reply = mode === "codex" && questionReply(text);
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
    text = mode === "chat" ? text : (item.bridgeDisplay?.text ?? userContent(text).text);
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
  for (const file of item.bridgeDisplay?.files ?? []) {
    const button = node("button", "attachment-chip file-download", file.name);
    button.type = "button";
    button.prepend(icon("files"));
    button.append(icon("download"));
    const a = agentId,
      t = selected;
    button.disabled = !file.id;
    button.title = file.id ? "下载原文件" : "原文件暂不可下载";
    button.onclick = () => downloadFile(a, t, file).catch(error);
    body.append(button);
  }
  box.append(body);
  if (!user) {
    const actions = node("div", "message-actions"),
      copy = node("button", "icon-button");
    copy.title = "复制回复";
    copy.setAttribute("aria-label", "复制回复");
    copy.append(icon("copy"));
    copy.onclick = () =>
      navigator.clipboard
        .writeText(copyMarkdown(text))
        .then(() => toast("已复制"))
        .catch(() => toast("复制失败，请手动选择文本"));
    actions.append(copy);
    box.append(actions);
  }

  return box;
}
function displayTurns() {
  messageImageObserver.disconnect();
  questionUI.index(turns);
  const incoming = document.createElement('div');
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
          (mode === "chat" ? "历史记录" : label(t.status)),
      ),
    );
    for (const item of t.items ?? []) {
      const n = renderItem(item, t.id);
      if (n) {
        n.dataset.itemId = item.id;
        wrapper.append(n);
      }
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
        node("strong", "", `${changed.size} 个文件变更记录`),
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
        node("strong", "", `${commands.length} 条命令记录`),
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
        request.method !== USER_INPUT_REQUEST ||
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
    incoming.append(wrapper);
  }
  reconcileMessages($("messages"), [...incoming.children]);
}
function releaseViewing() {
  const previous = viewingSubscription;
  viewingSubscription = null;
  if (previous?.leased) api(base(previous.agent) + '/threads/' + previous.thread + '/follow', { viewerId: previous.viewerId, following: false }, { keepalive: true }).catch(() => {});
}
function reconcileMessages(parent, incoming) {
  const key = node => node.dataset.turnId ? 'turn:' + node.dataset.turnId : node.questionKey ? 'question:' + node.questionKey : node.dataset.itemId ? 'item:' + node.dataset.itemId : null;
  const old = new Map([...parent.children].filter(node => key(node)).map(node => [key(node), node]));
  const desired = incoming.map(node => {
    const previous = old.get(key(node));
    if (previous?.dataset.turnId) {
      reconcileMessages(previous, [...node.children]);
      node = previous;
    } else if (previous?.questionKey && previous.questionKey === node.questionKey && previous.questionSignature === node.questionSignature) {
      // Keep the actual textarea attached: refocusing a new textarea breaks IME composition.
      node = previous;
    }
    return node;
  });
  const keep = new Set(desired);
  for (const node of [...parent.children]) if (!keep.has(node)) node.remove();
  let position = parent.firstChild;
  for (const node of desired) {
    if (node !== position) parent.insertBefore(node, position);
    position = node.nextSibling;
  }
}
function captureMessageAnchor() {
  const scroll = $("message-scroll"),
    top = scroll.getBoundingClientRect().top;
  const item = [...$("messages").querySelectorAll("[data-item-id]")].find(
    (el) => el.getBoundingClientRect().bottom > top + 5,
  );
  return item
    ? {
        id: item.dataset.itemId,
        offset: item.getBoundingClientRect().top - top,
      }
    : null;
}
function restoreMessageAnchor(anchor) {
  if (!anchor) return;
  const item = $("messages").querySelector(
    '[data-item-id="' + CSS.escape(anchor.id) + '"]',
  );
  const scroll = $("message-scroll");
  if (item)
    scroll.scrollTop +=
      item.getBoundingClientRect().top -
      scroll.getBoundingClientRect().top -
      anchor.offset;
}
function read(older = false) {
  if (
    !selected ||
    !status.connected ||
    (older === true && !cursor) ||
    (older === "gap" && !gapCursor)
  )
    return Promise.resolve();
  if (readInFlight) {
    if (!older) readInFlight.pending = true;
    if (older === true && !readInFlight.history) readInFlight.older = true;
    return readInFlight.promise;
  }
  clearTimeout(readRetryTimer);
  readRetryTimer = null;
  const job = {
    a: agentId,
    id: selected,
    g: generation,
    seq: readSequence,
    history: older === true,
  };
  readInFlight = job;
  $("older").disabled = true;
  $("older").textContent =
    older === true ? "正在加载更早的消息…" : "加载更早的消息";
  job.promise = readTask(job, older).finally(() => {
    if (readInFlight !== job) return;
    readInFlight = null;
    $("older").disabled = !status.connected;
    $("older").textContent = historyFailure ? "重试更早的消息" : "加载更早的消息";
    if (job.failed && job.retryable) {
      const delay = [1000, 2000, 4000, 8000, 15000, 30000][Math.min(readFailures++, 5)];
      readRetryTimer = setTimeout(() => {
        readRetryTimer = null;
        if (job.seq === readSequence && job.g === generation && job.id === selected) read(older);
      }, delay);
    } else if (gapCursor && !job.failed && !historyFailure) scheduleRead("gap");
    else if (job.older && !historyFailure) scheduleRead(true);
    else if (job.pending) scheduleRead();
  });
  return job.promise;
}
async function readTask(job, older) {
  const { a, id, g, seq } = job;
  const requestedCursor = older === "gap" ? gapCursor : older ? cursor : null;
  const sidebarSeq = ++sidebarSequence;
  // Queue text must not wait for the task history or its attachments.
  if (!older && mode === "codex") queueUI.refresh();
  try {
    const r = await agentApi(
      a,
      "/threads/" +
        id +
        "?view=conversation&paging=items-v1" +
        (requestedCursor
          ? (pageProtocol === "items-v1" ? "&before=" : "&cursor=") +
            encodeURIComponent(requestedCursor)
          : "") +
        (pageProtocol === "items-v1" && cursor
          ? "&retain=" + encodeURIComponent(cursor)
          : "") +
        (!older && taskData && headHash ? "&known=" + headHash : ""),
    );
    if (
      g !== generation ||
      id !== selected ||
      seq !== readSequence ||
      !status.connected
    )
      return;
    if (r.notModified && !older && taskData) {
      readFailures = 0;
      clearError();
      if (r.reportReceipt !== undefined) visibleReport = r.reportReceipt ? { ...r.reportReceipt, a, id, g } : null;
      checkVisibleReport();
      return;
    }
    if (r.data?.thread?.id !== id || !Array.isArray(r.data?.turns))
      throw Error("设备返回的会话内容格式不受支持，请更新目标设备后重试");
    if (!matchesMode(r.data.thread, mode)) throw Error("会话类型与当前模式不同，请切换模式后重新选择");
    readFailures = 0;
    const firstLoad = !turns.length;
    const resetPaging = !pageProtocol;
    const intersects = overlaps(turns, r.data.turns);
    const next = r.data.page?.nextCursor ?? null;
    pageProtocol = r.data.page?.pagination ?? null;
    if (older === "gap") gapCursor = intersects ? null : next;
    else if (older || firstLoad || resetPaging) {
      cursor = next;
      if (!firstLoad && !older && !intersects) gapCursor = next;
    } else if (pageProtocol === "items-v1" && !intersects) gapCursor ??= next;
    if (!older) {
      headHash = r.headHash ?? null;
      visibleReport = r.reportReceipt ? { ...r.reportReceipt, a, id, g } : null;
      taskData = { ...r.data, live: r.live };
      modelSettings(r.live?.state);
    }
    clearError();
    if (!older) historyReadNotice = r.readNotice ?? null;
    if (older && historyFailure?.cursor === requestedCursor) historyFailure = null;
    updateHistoryNotice();
    const scroll = $("message-scroll");
    const atBottom =
      firstLoad ||
      scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight < 100;
    const anchor = captureMessageAnchor();
    turns = mergeTurns(turns, r.data.turns, !!older);
    if (older) {
      $("older").hidden = !cursor && !historyFailure;
      displayTurns();
      restoreMessageAnchor(anchor);
      return;
    }
    const entry = threads.find((t) => t.id === id);
    const listChanged = !entry || entry.title !== taskData.thread.title;
    if (entry) {
      entry.title = taskData.thread.title;
      entry.status = taskData.thread.status.type;
    }
    rememberSidebarStatus(
      id,
      sidebarStatus(taskData.thread.status, r.live?.status),
      sidebarSeq,
    );
    if (listChanged) renderThreads();
    else updateThreadIndicators();
    $("title").textContent = taskData.thread.title;
    $("task-project").textContent =
      projects.find(
        (p) => p.projectId === threads.find((t) => t.id === id)?.projectId,
      )?.label ??
      (taskData.thread.kind === "chatgpt" ? "ChatGPT · 定时查询" : "Codex");
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
    $("older").hidden = !cursor && !historyFailure;
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
    displayTurns();
    permissions();
    if (atBottom) scroll.scrollTop = scroll.scrollHeight;
    else restoreMessageAnchor(anchor);
    checkVisibleReport();
  } catch (e) {
    if (
      g === generation &&
      id === selected &&
      seq === readSequence &&
      e.name !== "AbortError"
    ) {
      job.failed = true;
      job.retryable = ![400, 401, 403, 404].includes(e.status);
      error(e);
      if (older) {
        job.retryable = false;
        historyFailure = { cursor: requestedCursor, kind: older };
        $("older").hidden = false;
        updateHistoryNotice();
        return;
      }
      taskData = null;
      visibleReport = null;
      clearTimeout(receiptTimer);
      rememberSidebarStatus(id, { type: "unknown", confirmed: false });
      updateThreadIndicators();
      $("messages").querySelector(".read-notice")?.remove();
      $("task-state").textContent = (turns.length ? "刷新失败，已保留当前内容 · 状态未知" : "内容读取失败 · 状态未知") + (job.retryable ? " · 自动重试中" : "");
      $("task-state").className = "badge offline";
      $("task-state").hidden = false;
      $("activity").hidden = true;
      permissions();
    }
  }
}
async function stream(id, g) {
  if (g !== generation) return;
  streamAbort?.abort();
  const controller = new AbortController();
  streamAbort = controller;
  streamLastSeen = Date.now();
  const watchdog = setInterval(() => {
    if (Date.now() - streamLastSeen > 45000)
      controller.abort(Error("事件连接长时间无响应"));
  }, 5000);
  let reader;
  try {
    const r = await fetch(base(id) + "/events", {
      headers: { "X-Bridge-CSRF": csrf },
      signal: controller.signal,
    });
    if (!r.ok) throw Error("事件连接失败");
    reader = r.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) throw Error("查看连接已断开");
      if (g !== generation || controller.signal.aborted) break;
      streamLastSeen = Date.now();
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
        if (e.kind === "connection-interrupted") {
          setConnection(false);
          if (e.reason?.includes("Oversize IPC frame"))
            error(
              Error(
                "目标设备无法接收此会话的大型快照，请更新目标电脑的 Remote Codex。",
              ),
            );
        }
        if (e.kind === "connected") {
          viewerRecovery?.request(true);
        }
        if (e.kind === 'report-read') refreshSidebarReports(true);
        if (status.connected && ["thread-state", "unknown"].includes(e.kind)) {
          rememberSidebarStatus(e.threadId, {
            ...(e.kind === "thread-state"
              ? e.status
              : { type: "unknown", confirmed: false }),
            source: "官方会话所有者实时事件",
          });
          updateThreadIndicators();
        }
        if (mode === "codex" && e.threadId === selected && e.kind === "queue-changed")
          queueUI.refresh();
        if (e.threadId === selected && e.kind === "unknown") {
          $("task-state").textContent = "状态未知";
          $("task-state").className = "badge neutral";
        }
        if (e.threadId === selected && e.kind === "thread-state")
          scheduleRead();
        if (e.kind === "resync-required") {
          if (!e.connected) setConnection(false);
          else {
            const recovering = !status.connected;
            status = { ...status, ...e };
            viewerRecovery?.healthy();
            setConnection(true);
            clearError();
            refreshUsage();
            for (const [threadId, snapshot] of Object.entries(e.threads ?? {}))
              rememberSidebarStatus(threadId, {
                ...snapshot.status,
                source: "官方会话所有者实时事件",
              });
            updateThreadIndicators();
            if (selected) read();
            if (recovering) viewerRecovery?.request(true);
          }
        }
      }
    }
  } catch (e) {
    if (
      g === generation &&
      streamAbort === controller &&
      (!controller.signal.aborted ||
        controller.signal.reason?.name !== "AbortError")
    ) {
      setConnection(false);
    }
  } finally {
    clearInterval(watchdog);
    controller.abort();
    await reader?.cancel().catch(() => {});
    if (streamAbort === controller) streamAbort = null;
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
function journal(a, t, operation, payload, legacyOperation) {
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
        if (!old && legacyOperation)
          old = JSON.parse(localStorage.getItem("remote-bridge-request:" + a + ":" + t + ":" + legacyOperation));
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
  attachmentUrls.forEach(url => URL.revokeObjectURL(url));
  attachmentUrls = [];
  $("attachment").hidden = !composerImages.length;
  $("attachment").replaceChildren();
  composerImages.forEach((f, index) => {
    const chip = node("span", "attachment-chip"), im = node("img");
    im.src = URL.createObjectURL(f);
    attachmentUrls.push(im.src);
    im.alt = "待发送图片 " + (index + 1);
    zoomableImage(im, f.name);
    const label = node("span", "attachment-name", f.name);
    label.title = f.name;
    const b = node("button", "", "×");
    b.type = "button";
    b.title = "移除图片 " + (index + 1);
    b.setAttribute("aria-label", b.title);
    b.onclick = () => {
      if ($("image").disabled) return;
      setImages(composerImages.filter((_, i) => i !== index));
      saveDraft(); discardEmptyTakenDraft(); renderAttachment(); permissions(); scheduleDraftBackup();
    };
    chip.append(im, label, b);
    $("attachment").append(chip);
  });
}
function appendImages(files) {
  const combined = validateImageBatch([...composerImages, ...files]);
  setImages(combined);
  saveDraft(); renderAttachment(); permissions(); clearError();
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
function modeUI() {
  const chat = mode === "chat";
  $("mode-name").textContent = chat ? "Chat" : "Codex";
  document.body.dataset.mode = mode;
  for (const button of $("mode-menu").querySelectorAll("[data-mode]"))
    button.setAttribute("aria-checked", String(button.dataset.mode === mode));
  $("mode-notice").hidden = !chat;
  $("mode-notice").textContent = chatNotice;
  $("empty-title").textContent = chat ? "你的 ChatGPT 会话" : "今天有什么安排？";
  $("empty-description").textContent = chat ? chatEmpty : "在下方输入，开始一个新对话";
}
async function switchMode(next) {
  next = normalizeMode(next);
  if (next === mode) return;
  const resume = modeSelections.get(agentId + ":" + next) ?? null;
  await switchAgent(agentId, false, resume, next);
  recordRoute(agentId, selected);
}
function positionModeMenu() {
  const rect = $("mode-picker").getBoundingClientRect();
  $("mode-menu").style.left = Math.max(8, Math.min(rect.left, innerWidth - 256)) + "px";
  $("mode-menu").style.top = rect.bottom + 8 + "px";
}
$("mode-menu").addEventListener("beforetoggle", e => { if (e.newState === "open") positionModeMenu(); });
window.addEventListener("resize", positionModeMenu);
for (const button of $("mode-menu").querySelectorAll("[data-mode]")) button.onclick = () => {
  $("mode-menu").hidePopover();
  switchMode(button.dataset.mode).catch(error);
};
$("mode-menu").addEventListener("keydown", e => {
  if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) return;
  e.preventDefault();
  const buttons = [...$("mode-menu").querySelectorAll("button")];
  const current = buttons.indexOf(document.activeElement);
  buttons[e.key === "Home" ? 0 : e.key === "End" ? buttons.length - 1 : (current + (e.key === "ArrowUp" ? -1 : 1) + buttons.length) % buttons.length].focus();
});

function recordRoute(a, t) {
  if (routeHistory[routeIndex]?.a === a && routeHistory[routeIndex]?.t === t && routeHistory[routeIndex]?.mode === mode)
    return;
  routeHistory = routeHistory.slice(0, routeIndex + 1);
  routeHistory.push({ a, t, mode });
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
  closeDrawer(false);
  if (r.a !== agentId || r.mode !== mode) await switchAgent(r.a, false, r.t, r.mode);
  else if (r.t) await selectThread(r.t, false);
  else newConversation(false);
}
function newConversation(record = true, { preserveDrawer = false } = {}) {
  if (!currentAgent()) { editAgent(null); return; }
  closeSettingsMenu(false);
  projectPicker.close();
  if (mode === "codex" && record) projectPicker.prefer(
    threads.find(t => t.id === selected)?.projectId ?? $("project-filter").value,
  );
  saveDraft();
  viewEpoch++;
  resetTaskReads();
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
  modeUI();
  setPromptValue("");
  draft.delete(taskKey());
  setImages([]);
  renderAttachment();
  modelSettings(null);
  clearError();
  renderThreads();
  permissions();
  if (!preserveDrawer) closeDrawer(false);
  if (record) recordRoute(agentId, null);
  $("prompt").focus();
}
$("form").onsubmit = async (e) => {
  e.preventDefault();
  await submitMessage();
};
async function submitMessage({ steer = false } = {}) {
  if ($("send").disabled) return;
  if (!recoveryLoaded) { error(Error('草稿存储尚未读取，已暂停发送，请重新打开 Remote Codex')); return; }
  saveDraft();
  if(guardDraftTargets()){await backupDrafts();permissions();toast("原连接已变化，草稿已另外保留，请核对目标设备");return;}
  const a = agentId,
    t = selected,
    g = generation,
    v = viewEpoch,
    fresh = t === null,
    m = mode,
    running = m === "codex" && !fresh && taskData?.thread?.status?.type === "active",
    steering = steer && running,
    enqueue = running && !steering,
    k = fresh ? a + ":create" : taskKey(),
    prompt = $("prompt").value,
    files = [...composerImages],
    multiImageSupported = status.multiImageInput === true;
  if (!prompt.trim() && !files.length) return;
  const expectedTurnId = steering ? taskData?.live?.activeTurnId : null;
  if (steering && (status.steer?.supported !== true || !expectedTurnId)) {
    error(Error(status.steer?.supported !== true
      ? "目标设备尚不支持 Ctrl+Enter 调整方向，请先更新目标设备；草稿已保留"
      : "当前运行轮次尚未确认，请刷新后重试；草稿已保留"));
    return;
  }
  const sendSettings = pendingSettings.get(taskKey(a, t));
  const creationProject = fresh && m === "codex" ? projectPicker.selection() : null;
  busy.add(k);
  permissions();
  clearError();
  if (fresh) {
    $("empty").hidden = true;
    document.querySelector(".conversation").classList.remove("is-new");
    const preview = renderItem({
      type: "userMessage",
      content: [{ type: "text", text: prompt || "图片消息" }],
    });
    $("messages").replaceChildren(preview);
    $("activity").hidden = false;
  }
  try {
    if (m === "chat" && fresh) throw Error(chatEmpty);
    // Persist the complete draft before any message can leave the controller.
    // A fast failed/unknown reply followed by reload must not beat the debounce.
    await backupDrafts();
    const images = imagePayload(await Promise.all(files.map(fileData)), multiImageSupported),
      payload = {
        mode: m,
        prompt: prompt.trim() ? prompt : "请查看这些图片。",
        ...(creationProject ? { project: creationProject } : {}),
        ...(takenDrafts.get(taskKey(a, t))
          ? { recoveryId: takenDrafts.get(taskKey(a, t)).recoveryId }
          : {}),
        ...images,
        ...(steering ? { delivery: "steer", expectedTurnId } : sendSettings ? { settings: sendSettings } : {}),
      };
    const j = await journal(
      a,
      fresh ? "new" : t,
      fresh ? "create" : steering ? "steer" : enqueue ? "enqueue" : "send",
      payload,
    );
    const r = enqueue
      ? await queueUI.enqueue(prompt, images, j.id, payload.recoveryId, {
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
    const originKey = taskKey(a, t, m);
    const atOrigin = taskKey() === originKey;
    const savedFiles = takenDrafts.get(originKey)?.files ?? [];
    const sameImages = candidate => candidate.length === files.length && candidate.every((f, i) => f === files[i]);
    const unchanged = atOrigin ? $("prompt").value === prompt && sameImages(composerImages) : draft.get(originKey) === prompt && sameImages(savedFiles);
    if (unchanged) { takenDrafts.delete(originKey); draft.delete(originKey); }
    if (!steering) pendingSettings.delete(taskKey(a, t, m));
    if (atOrigin && unchanged) {
      setPromptValue("");
      setImages([]);
      renderAttachment();
      if (fresh) {
        await refresh(g);
        if (g === generation && v === viewEpoch)
          await selectThread(r.result.threadId);
      } else await read();
      if (enqueue) toast("已加入官方队列");
      if (steering) toast("已提交调整方向");
    } else
      toast("已发送到 " + (agents.find((x) => x.id === a)?.name ?? "原设备"));
    await backupDrafts();
  } catch (e) {
    if (g === generation && v === viewEpoch) {
      error(e);
      $("activity").hidden = true;
      if (fresh) {
        $("messages").replaceChildren();
        $("empty").hidden = false;
        document.querySelector(".conversation").classList.add("is-new");
      }
    } else toast("原设备的提交结果未知，请切回核对。");
  } finally {
    busy.delete(k);
    permissions();
  }
}
function resizePrompt() {
  const input = $("prompt");
  input.style.height = "";
  if (!input.value) {
    input.scrollTop = 0;
    return;
  }
  input.style.height = "auto";
  const maxHeight = Math.min(
    parseFloat(getComputedStyle(input).maxHeight) || 180,
    180,
  );
  input.style.height = Math.min(input.scrollHeight, maxHeight) + "px";
}
function setPromptValue(value) {
  $("prompt").value = value;
  resizePrompt();
}
$("prompt").oninput = () => {
  saveDraft();
  discardEmptyTakenDraft();
  scheduleDraftBackup();
  permissions();
  resizePrompt();
};
$("prompt").onkeydown = (e) => {
  if (e.key === "Enter" && !e.shiftKey && !e.isComposing && e.keyCode !== 229) {
    e.preventDefault();
    if (e.repeat) return;
    if (e.ctrlKey) void submitMessage({ steer: true });
    else $("form").requestSubmit();
  }
};
$("image").onchange = () => {
  const picked = [...$("image").files];
  try { appendImages(picked); }
  catch (e) { setImages(composerImages); error(e); }
};
$("prompt").addEventListener("paste", event => {
  const files = clipboardImages(event.clipboardData);
  if (!files.length) return;
  event.preventDefault();
  if ($("image").disabled) {
    toast(!status.connected ? "请等待目标设备连接后再粘贴图片" : selected === null
      ? "目标设备尚不支持带图新建，请更新目标电脑；原有草稿已保留"
      : "请等待会话连接并加载完成后再粘贴图片");
    return;
  }
  try { appendImages(files); } catch (e) { error(e); }
});
$("create").onclick = $("mobile-new").onclick = () => newConversation();
$("nav-back").onclick = () => navigateBy(-1).catch(error);
$("nav-forward").onclick = () => navigateBy(1).catch(error);

$("agent-form").onsubmit = async (e) => {
  e.preventDefault();
  agentRefresh++;
  $("save-agent").disabled = true;
  try {
    await backupDrafts();
    await deviceSettings.saveLocal();
    const d = await api("/api/agents", {
      id: editing,
      name: $("agent-name").value,
      host: $("agent-host").value,
      port: $("agent-port").value,
      key: $("agent-key").value.trim(),
    });
    agentRefresh++;
    agents = d.agents;
    $("agent-dialog").close();
    $("agent-key").value = "";
    renderAgents();
    if (!currentAgent()) await switchAgent(d.selectedId || agents[0]?.id);
    else if (editing === agentId) await switchAgent(agentId);
    toast("设备已保存");
  } catch (e) {
    $("agent-form-error").textContent = e.message;
  } finally {
    $("save-agent").disabled = false;
  }
};
$("remove-agent").onclick = async () => {
  agentRefresh++;
  try {
    await backupDrafts();
    const removed = editing,
      d = await api("/api/agents/remove", { id: removed });
    agentRefresh++;
    agents = d.agents;
    $("agent-dialog").close();
    if (agentId === removed) await switchAgent(d.selectedId || agents[0]?.id || "");
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
setInterval(() => sidebarReports.expire(), 1000);
setInterval(() => {
  if (!booting && !document.hidden && mode === "codex" && selected)
    draftDiscards.flush({ agent: agentId, id: selected, connected: !!status.connected });
}, 5000);
setInterval(() => {
  if (!document.hidden) updateQuotaCountdowns($("usage-details"));
}, 1000);
setInterval(() => {
  if (mode === 'codex' && selected && status.connected && !document.hidden)
    agentApi(agentId, '/threads/' + selected + '/follow', {}, { signal: taskReads.signal }).catch(() => {});
}, 30000);
// Chat has no Codex owner event stream. Poll only the visible task; existing
// read coalescing and generation checks discard old device/mode responses.
setInterval(() => {
  if (mode === "chat" && selected && status.connected && !document.hidden && !readInFlight) read();
}, 4000);
document.addEventListener("visibilitychange", () => {
  if (document.hidden) { backupDrafts().catch(error); return; }
  updateQuotaCountdowns($("usage-details"));
  wakeViewer();
  pollSidebar();
  if (Date.now() - usageFetchedAt > 90000) resetUsage("loading");
  refreshUsage();
});
function wakeViewer() {
  if (booting) return;
  if (streamAbort && Date.now() - streamLastSeen > 45000)
    streamAbort.abort(Error("唤醒后恢复查看连接"));
  if (!status.connected || !streamAbort) viewerRecovery?.request(true);
  else {
    pollSidebar();
    if (selected) {
      if (mode === 'codex') agentApi(agentId, '/threads/' + selected + '/follow', {}, { signal: taskReads.signal }).catch(() => {});
      read();
    }
  }
}
window.addEventListener("online", wakeViewer);
window.addEventListener("focus", wakeViewer);
window.addEventListener("pagehide", () => {
  releaseViewing();
  backupDrafts().catch(() => {});
  viewerRecovery?.stop();
  streamAbort?.abort();
  agentReads.abort();
  taskReads.abort();
  clearTimeout(readRetryTimer);
});
$("reconnect").onclick = () => {
  streamAbort?.abort();
  setConnection(false);
  viewerRecovery?.request(true);
};
$("refresh").onclick = () => Promise.all([refresh(), read()]).catch(error);
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
    g = generation,
    m = mode;
  try {
    await agentApi(a, "/threads/" + id + "/open", {});
    if (m === "codex") for (let attempt = 0; attempt < 20; attempt++) {
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
$("older").onclick = () => read(historyFailure?.kind === "gap" ? "gap" : true);
$("message-scroll").addEventListener("scroll", checkVisibleReport, { passive: true });
document.addEventListener("visibilitychange", checkVisibleReport);
window.addEventListener("focus", checkVisibleReport);
$("message-scroll").addEventListener(
  "scroll",
  () => {
    if (
      $("message-scroll").scrollTop < 160 &&
      cursor &&
      !historyFailure &&
      !readInFlight &&
      turns.length
    )
      read(true);
  },
  { passive: true },
);
function interruptTurnId() {
  if (status.interrupt?.supported === true) return taskData?.live?.activeTurnId ?? null;
  if (taskData?.live && Object.hasOwn(taskData.live, "activeTurnId"))
    return taskData.live.activeTurnId;
  // Older agents retain their Probe-only stop capability.
  return turns.find(t => t.status === "inProgress")?.id ?? null;
}
$("interrupt").onclick = async () => {
  const a = agentId,
    t = selected,
    g = generation,
    k = taskKey(),
    turnId = interruptTurnId();
  if (!turnId || $("interrupt").disabled || $("interrupt").hidden || busy.has(k)) return;
  busy.add(k);
  permissions();
  try {
    const j = await journal(a, t, "interrupt", { turn: turnId }),
      r = await agentApi(a, "/threads/" + t + "/interrupt", {
        expectedTurnId: turnId,
        requestId: j.id,
      });
    if (r.status !== "accepted")
      throw Error("停止请求的结果尚未确认，请刷新或在官方桌面核对；不会自动重复发送");
    j.clear();
    if (g === generation && a === agentId && t === selected) {
      toast("已请求停止，正在等待官方状态更新");
      await read();
    }
  } catch (e) {
    if (g === generation && a === agentId && t === selected) error(e);
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
      b.append(
        node(
          "span",
          "",
          f.size === null ? "大小未知" : (f.size / 1024).toFixed(0) + " KB",
        ),
      );
      b.onclick = async () => {
        try {
          await downloadFile(a, t, f);
        } catch (e) {
          error(e);
        }
      };
      $("files").append(b);
    }
    if (!r.files.length)
      $("files").textContent =
        "已加载的消息中没有可下载的文件；向上翻阅可加载更早附件。";
  } catch (e) {
    if (g === generation) error(e);
  }
}
async function downloadFile(a, t, file) {
  if (android) {
    await api('/api/downloads/start', {
      route: base(a) + '/threads/' + t + '/file?' + (file.id ? 'id=' + encodeURIComponent(file.id) : 'name=' + encodeURIComponent(file.name)),
      name: file.name.split(/[\\/]/).at(-1),
    });
    toast('正在读取原文件，随后选择保存位置');
    return;
  }
  const response = await fetch(
    base(a) +
      "/threads/" +
      t +
      "/file?" +
      (file.id
        ? "id=" + encodeURIComponent(file.id)
        : "name=" + encodeURIComponent(file.name)),
    { headers: { "X-Bridge-CSRF": csrf }, signal: AbortSignal.timeout(300000) },
  );
  if (!response.ok) throw Error("原文件无法下载，可能已被移动或删除");
  const url = URL.createObjectURL(await response.blob()),
    link = node("a");
  link.href = url;
  link.download = file.name.split(/[\\/]/).at(-1);
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
$("toggle-files").onclick = () => {
  $("file-tray").hidden = !$("file-tray").hidden;
  if (!$("file-tray").hidden && selected) files();
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
  files();
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
          const effort = model.efforts.includes(choice.effort) ? choice.effort : undefined;
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
    const tier = choice.serviceTier ?? t.current?.serviceTier;
    const active = ["priority", "fast"].includes(tier);
    speed.append(icon("bolt"));
    speed.setAttribute("aria-pressed", t.loaded && tier === undefined ? "mixed" : String(active));
    speed.title = !t.id
      ? "官方新建接口尚未提供首轮加速参数，创建后可切换"
      : !fast
        ? "此模型暂未提供加速档位"
        : [tier === undefined ? "当前加速状态未确认" : null, fast.name ?? "加速", fast.description].filter(Boolean).join(" · ");
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
  if (mode === "chat") return;
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
      if (choice.model && choice.effort === undefined && !t.models.find(m => m.id === choice.model)?.efforts.includes(next.effort))
        delete next.effort;
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
      t.choice = {
        ...t.current,
        model: t.current?.model ?? liveSettingsState?.latestModel,
        effort: t.current?.effort ?? liveSettingsState?.latestReasoningEffort,
      };
      if (!keepOpen && settingsTarget === t) closeSettingsMenu();
      toast("设置已提交，当前显示以官方返回为准");
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
  helpUpdates.refresh();
  $("remote-info").textContent = "读取中…";
  try {
    const r = await api("/api/remote-info");
    $("remote-info").textContent = accessSummary(r);
  } catch (e) {
    $("remote-info").textContent = e.message;
  }
};
$("help").onclick = () => $("remote-setup").click();
$("configure-local-access").onclick = () => {
  $("setup-dialog").close();
  editAgent("local");
};
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
modeUI();
$("orphan-drafts").onclick=openOrphanDrafts;
const connectionDiagnostics=new ConnectionDiagnostics({api,getAgent:currentAgent,getAgents:()=>agents,edit:editAgent,toast,
  retry:async id=>{await agentApi(id,'/connect',{});if(id===agentId)viewerRecovery?.request(true);},
  updates:async id=>{await agentApi(id,'/updates/check',{});toast('已请求目标检查更新');},
});
$("diagnose-connection").onclick=$("help-diagnose").onclick=()=>connectionDiagnostics.open();
$('connection').onclick=()=>connectionDiagnostics.open();$('connection').setAttribute('role','button');$('connection').tabIndex=0;
$('connection').onkeydown=e=>{if(['Enter',' '].includes(e.key)){e.preventDefault();connectionDiagnostics.open();}};
if (android) new DeviceConnections({ $, api });
let widgetDestination = null, widgetNavigation = 0;
window.remoteCodexOpenTask = async (destination) => {
  if ((!android && !window.chrome?.webview) || !destination || !/^[a-f0-9-]{36}$/.test(destination.thread ?? "") || !/^[a-f0-9-]{36}$/.test(destination.agent ?? "")) return;
  if (booting) { widgetDestination = destination; return; }
  const navigation = ++widgetNavigation;
  const data = await api("/api/agents");
  if (navigation !== widgetNavigation) return;
  if (!data.agents.some(a => a.id === destination.agent)) throw Error("目标设备已移除，请刷新设备列表");
  agents = data.agents;
  closeDrawer(false);
  await switchAgent(destination.agent, true, destination.thread, normalizeMode(destination.mode));
};
window.remoteCodexNotificationContext = () => !booting && selected && !document.hidden && !drawerOpen &&
  !document.querySelector('dialog[open]') ? { agent: agentId, thread: selected, mode } : null;
window.chrome?.webview?.postMessage(JSON.stringify({ type: 'notifications-ready', csrf }));
api("/api/agents")
  .then(async (d) => {
    storageNotice(d);
    agents = d.agents;
    const original = await readRecovery();
    recoveryLoaded = true;
    const protection = protectRecovery(original, agents), saved = protection.saved;
    draftBindings = new Map(saved?.deviceBindings ?? []);orphanedDrafts = saved?.orphanedDrafts ?? [];renderOrphanNotice();
    draftDiscards.restore(saved?.discardedRecoveries);
    projectPicker.restore(saved?.creationProjects);
    questionUI.restore(saved?.questions);
    mode = normalizeMode(saved?.mode ?? mode);
    for (const [key, id] of saved?.modeSelections ?? []) modeSelections.set(key, id);
    modeUI();
    await switchAgent(
      saved && agents.some((a) => a.id === saved.agent)
        ? saved.agent
        : d.selectedId,
    );
    const requested =
      saved?.thread || (!protection.blockedActive && new URL(location.href).searchParams.get("thread"));
    if (requested && /^[a-f0-9-]{36}$/.test(requested))
      await selectThread(requested, true, { preserveDrawer: true });
    if (saved) {
      draft = new Map(saved.drafts || []);
      pendingSettings = new Map(saved.settings || []);
      takenDrafts.clear();
      for (const [key, value] of saved.taken || []) takenDrafts.set(key, value);
      setPromptValue(saved.prompt || "");
      setImages(saved.files ?? (saved.file ? [saved.file] : []));
      renderAttachment();
      await backupDrafts();
    }
  })
  .catch(error)
  .finally(() => {
    booting = false;
    permissions();
    refreshSidebarReports();
    backupDrafts().catch(error);
    const params = new URL(location.href).searchParams;
    const destination = widgetDestination ?? (params.get("widgetThread") ? { agent: params.get("widgetAgent"), thread: params.get("widgetThread"), mode: params.get("widgetMode") } : null);
    widgetDestination = null;
    if (destination) window.remoteCodexOpenTask(destination).catch(error);
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
        !!composerImages[0] ||
        busy.size > 0 ||
        questionUI.hasDrafts() ||
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
  if (wasOpen) checkVisibleReport();
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

// Width changes can wrap the same draft differently without an input event.
let promptWidth = 0;
new ResizeObserver(([entry]) => {
  if (entry.contentRect.width === promptWidth) return;
  promptWidth = entry.contentRect.width;
  resizePrompt();
}).observe($("prompt"));
