export const normalizeMode = (mode) => mode === "chat" ? "chat" : "codex";
export const matchesMode = (thread, mode) => thread?.kind === (mode === "chat" ? "chatgpt" : "codex");

// Preserve existing Codex recovery keys and stable task IDs. Only the empty
// composer needs a separate key because Chat and Codex share no draft task.
export const modeTaskKey = (agent, thread, mode) =>
  thread == null && mode === "chat" ? agent + ":chat:null" : agent + ":" + thread;

export function modeCatalog(data, mode, testThreads = {}) {
  const rows = [...(data.pinnedThreads ?? []), ...(data.threads ?? [])];
  const result = [...new Map(rows.filter(t => matchesMode(t, mode)).map(t => [t.id, t])).values()];
  if (mode !== "chat") for (const [id, t] of Object.entries(testThreads)) {
    if (!result.some(row => row.id === id)) result.unshift({
      id, title: t.title, kind: "codex", status: "unknown",
      updatedAt: Date.parse(t.createdAt) / 1000,
      ...(t.projectId ? { projectId: t.projectId } : {}),
    });
  }
  return result;
}

export const chatNotice = "官方 ChatGPT 列表暂未区分普通 Chat 与 Work；这里只读取官方返回的会话。新建、模型切换和图片请在官方桌面操作。";
export const chatEmpty = "从左侧选择已有 ChatGPT 会话。普通 Chat 新建尚无已验证的桌面接口，请先在官方桌面新建后刷新列表。";

export function chatComposer(status, thread) {
  const connected = !!status.connected;
  const writable = status.chat?.sendText === true && thread?.kind === "chatgpt";
  const idle = thread?.status?.type === "idle";
  return {
    writable,
    canSend: connected && writable && idle,
    reason: !connected ? "连接中断 · 状态未知"
      : !thread ? chatEmpty
      : !writable ? "目标设备尚未开放 Chat 文字续写，请更新目标设备"
      : !idle ? "等待官方 Chat 回复结束；Chat 暂不支持队列与中断"
      : "试验性 Chat 文字续写 · 沿用官方模型 · 状态定时查询",
  };
}
