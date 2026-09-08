const bad = new Set(["__proto__", "constructor", "prototype"]);
export function mergeLiveTurnItems(data, state) {
  if (!Array.isArray(data.turns) || !state) return data;
  const live = new Map(
    Object.values(state.turnHistory?.history?.entitiesByKey ?? {})
      .filter((t) => t.turnId)
      .map((t) => [t.turnId, t]),
  );
  return {
    ...data,
    turns: data.turns.map((t) => {
      const items = live.get(t.id)?.items;
      if (!items?.length) return t;
      const merged = new Map((t.items ?? []).map((item) => [item.id, item]));
      for (const item of items) merged.set(item.id, item);
      return {
        ...t,
        items: [...merged.values()],
        itemsSource: "official-desktop-IPC-live + tool-read",
      };
    }),
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
export function runtimeStatus(state, connected = true) {
  if (!connected) return { type: "connection-interrupted", confirmed: false };
  if (!state) return { type: "unknown", confirmed: false };
  const last = liveTurns(state).at(-1),
    pending = state.requests ?? [],
    runtime = state.threadRuntimeStatus;
  // Old history cannot confirm current state when the owner has not loaded it.
  if (!["active", "idle"].includes(runtime?.type))
    return { type: "unknown", confirmed: false };
  const requestTypes = pending.map((r) => r.method ?? r.type ?? "unknown");
  if (
    runtime?.activeFlags?.includes("waitingOnApproval") ||
    pending.some((r) =>
      /Approval|approval|permissions|elicitation/.test(r.method ?? ""),
    )
  )
    return { type: "waiting-approval", confirmed: true, requestTypes };
  if (runtime?.activeFlags?.includes("waitingOnUserInput") || pending.length)
    return { type: "waiting-user-input", confirmed: true, requestTypes };
  if (runtime?.type === "active")
    return {
      type: "running",
      confirmed: true,
      activeFlags: runtime.activeFlags ?? [],
    };
  if (last?.status === "inProgress" && runtime?.type !== "idle")
    return { type: "running", confirmed: true };
  if (last?.status === "completed")
    return { type: "completed", confirmed: true };
  if (last?.status === "interrupted")
    return { type: "interrupted", confirmed: true };
  if (last?.status === "failed" || last?.error)
    return { type: "error", confirmed: true };
  if (runtime?.type === "idle") return { type: "idle", confirmed: true };
  return { type: "unknown", confirmed: false };
}
