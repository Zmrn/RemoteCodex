import { pendingApprovals } from './approvals.mjs';
const bad = new Set(["__proto__", "constructor", "prototype"]);
// The merged page already carries messages. The UI needs live settings and
// pending questions, not another copy of every turn and tool output.
export function conversationView(result) {
  if (!result.live?.state) return result;
  const state = result.live.state;
  return {
    ...result,
    live: {
      ...result.live,
      activeTurnId: activeTurnId(state),
      state: { approvals: pendingApprovals(state), commandApprovals: pendingApprovals(state, 'command'), ...Object.fromEntries(
        [
          "latestThreadSettings",
          "latestModel",
          "latestReasoningEffort",
          "threadRuntimeStatus",
          "requests",
        ]
          .filter((key) => Object.hasOwn(state, key))
          .map((key) => [key, state[key]]),
      ) },
    },
  };
}
export function mergeLiveTurnItems(
  data,
  state,
  { includeNewTurns = true } = {},
) {
  if (!Array.isArray(data.turns) || !state) return data;
  if (state.id && data.thread?.id && state.id !== data.thread.id) return data;
  const live = new Map(
    Object.values(state.turnHistory?.history?.entitiesByKey ?? {})
      .filter((t) => t.turnId)
      .map((t) => [t.turnId, t]),
  );
  const liveFields = (t) => ({
    id: t.turnId,
    ...(typeof t.status === "string" ? { status: t.status } : {}),
    ...(Number.isFinite(t.turnStartedAtMs)
      ? { startedAt: t.turnStartedAtMs / 1000 }
      : {}),
    ...(Object.hasOwn(t, "error") ? { error: t.error } : {}),
  });
  const turns = data.turns.map((t) => {
    const current = live.get(t.id);
    if (!current) return t;
    return {
      ...t,
      ...liveFields(current),
      // An owner turn contains its current item array, including removals.
      // Only a missing array falls back to the official history tool.
      items: Array.isArray(current.items) ? current.items : (t.items ?? []),
      itemsSource: Array.isArray(current.items) ? "official-desktop-IPC-live" : "official-tool-read",
    };
  });
  // The official history tool can lag behind its own running conversation
  // owner by whole turns. Merge that owner's newer turns into the head before
  // paging. Older cursor reads must remain older pages, never reinsert the head.
  if (includeNewTurns) {
    const ids = new Set(turns.map((t) => t.id));
    const times = turns.map((t) => t.startedAt).filter(Number.isFinite);
    const boundary = times.length ? Math.min(...times) : -Infinity;
    for (const t of live.values()) {
      if (ids.has(t.turnId)) continue;
      if (
        !Number.isFinite(t.turnStartedAtMs) ||
        t.turnStartedAtMs / 1000 < boundary
      )
        continue;
      turns.push({
        ...liveFields(t),
        items: t.items ?? [],
        itemsSource: "official-desktop-IPC-live",
      });
    }
  }
  return {
    ...data,
    turns: turns.sort((a, b) => (b.startedAt ?? 0) - (a.startedAt ?? 0)),
  };
}
export function applyPatches(state, patches) {
  let result = structuredClone(state);
  for (const p of patches) {
    if (!Array.isArray(p.path) || p.path.some((k) => bad.has(String(k))))
      throw Error("Invalid patch path");
    if (p.path.length === 0) {
      if (p.op !== "replace") throw Error("Invalid root patch");
      result = structuredClone(p.value);
      continue;
    }
    let target = result;
    for (const k of p.path.slice(0, -1)) {
      if (target == null || !Object.hasOwn(target, k))
        throw Error("Patch parent missing");
      target = target[k];
    }
    const key = p.path.at(-1);
    if (p.op === "remove") {
      if (Array.isArray(target)) target.splice(Number(key), 1);
      else delete target[key];
    } else if (p.op === "add" || p.op === "replace") {
      if (Array.isArray(target) && p.op === "add")
        target.splice(Number(key), 0, structuredClone(p.value));
      else target[key] = structuredClone(p.value);
    } else throw Error("Unknown patch operation");
  }
  return result;
}
export function liveTurns(state) {
  const h = state?.turnHistory?.history;
  if (h?.entitiesByKey) {
    return Object.values(h.entitiesByKey)
      .filter((t) => t && typeof t === "object" && "status" in t)
      .sort((a, b) => (a.turnStartedAtMs ?? 0) - (b.turnStartedAtMs ?? 0));
  }
  return state?.turns ?? [];
}
// Only the owner's current runtime and latest turn identify what a stop may target.
// Historical inProgress records alone must never stop a newer turn.
export function activeTurnId(state) {
  if (state?.threadRuntimeStatus?.type !== "active") return null;
  const turn = liveTurns(state).at(-1);
  return turn?.status === "inProgress" && typeof turn.turnId === "string"
    ? turn.turnId : null;
}
export function runtimeStatus(state, connected = true) {
  if (!connected) return { type: "connection-interrupted", confirmed: false };
  if (!state) return { type: "unknown", confirmed: false };
  const runtime = state.threadRuntimeStatus;
  // Old history cannot confirm current state when the owner has not loaded it.
  if (!["active", "idle"].includes(runtime?.type))
    return { type: "unknown", confirmed: false };
  if (runtime.type === "idle") return { type: "idle", confirmed: true };
  if (runtime.activeFlags?.includes("waitingOnApproval"))
    return { type: "waiting-approval", confirmed: true };
  if (runtime.activeFlags?.includes("waitingOnUserInput"))
    return { type: "waiting-user-input", confirmed: true };
  if (runtime?.type === "active")
    return {
      type: "running",
      confirmed: true,
      activeFlags: runtime.activeFlags ?? [],
    };
  return { type: "unknown", confirmed: false };
}
