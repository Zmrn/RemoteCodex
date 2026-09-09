(() => {
  localStorage.setItem("remote-codex-mode", "codex");
  localStorage.setItem("remote-codex-window-id", "history-fixture-" + crypto.randomUUID());
  const original = fetch.bind(window), id = "77777777-7777-4777-8777-777777777777", other = "66666666-6666-4666-8666-666666666666";
  const f = window.historyReadFixture = { phase: "old", fail: true, gapCalls: 0, checks: [] };
  const json = (v, status = 200) => Promise.resolve(new Response(JSON.stringify(v), { status, headers: { "Content-Type": "application/json" } }));
  const item = (name, time) => ({ id: name, startedAt: time, status: "completed", items: [{ id: name + "-message", type: "agentMessage", text: name }] });
  window.fetch = (url, options = {}) => {
    const u = new URL(String(url), location.origin), p = u.pathname;
    if (!p.startsWith("/api/")) return original(url, options);
    if (p.endsWith("/events")) return Promise.resolve(new Response(new ReadableStream({ start(c) { options.signal?.addEventListener("abort", () => { try { c.close(); } catch {} }); } }), { headers: { "Content-Type": "text/event-stream" } }));
    if (p === "/api/agents") return json({ selectedId: "local", agents: [{ id: "local", kind: "local", name: "History fixture" }] });
    if (p.endsWith("/status") || p.endsWith("/connect")) return json({ connected: true, existingCodexWritable: true });
    if (p.endsWith("/projects")) return json({ data: { projects: [] } });
    if (p.endsWith("/threads")) return json({ data: { threads: [id, other].map(t => ({ id: t, kind: "codex", title: t === id ? "Gap fixture" : "Healthy fixture", status: "idle" })) } });
    if (p.endsWith("/threads/" + id) || p.endsWith("/threads/" + other)) {
      const healthy = p.endsWith(other), before = u.searchParams.get("before"), gap = before === "gap:0";
      if (before) {
        if (!gap) throw Error("Unexpected history cursor");
        f.gapCalls++;
        if (f.fail) return json({ error: "官方暂时无法读取这段历史，可能内容过大。请稍后重试。" }, 400);
      }
      return json({ readNotice: !healthy && f.phase === "new" ? "已先显示可读内容" : null,
        data: { thread: { id: healthy ? other : id, kind: "codex", title: healthy ? "Healthy fixture" : "Gap fixture", status: { type: "idle" } },
          turns: [item(healthy ? "HEALTHY" : gap || f.phase === "old" ? "PREVIOUS_READABLE" : "LATEST_READABLE", gap || f.phase === "old" ? 1 : 2)],
          page: { pagination: "items-v1", nextCursor: !healthy && !gap && f.phase === "new" ? "gap:0" : null } } });
    }
    if (p.endsWith("/queue")) return json({ confirmed: true, revision: "1", messages: [], recoveries: [] });
    if (options.method === "POST" && !/\/(follow|connect|activity|select)$/.test(p)) throw Error("Unexpected task mutation in read fixture");
    return json({});
  };
  const el = id => document.getElementById(id), wait = async fn => {
    const end = Date.now() + 15000;
    while (Date.now() < end) { if (fn()) return; await new Promise(r => setTimeout(r, 50)); }
    throw Error("History fixture timeout: " + fn.toString());
  };
  const check = (value, label) => { if (!value) throw Error(label); f.checks.push(label); };
  f.run = async () => {
    await wait(() => document.querySelector(`[data-thread-id="${id}"]`));
    document.querySelector(`[data-thread-id="${id}"]`).click();
    await wait(() => el("messages").textContent.includes("PREVIOUS_READABLE") && !el("prompt").disabled);
    el("prompt").value = "KEEP_HISTORY_DRAFT"; el("prompt").dispatchEvent(new Event("input", { bubbles: true }));
    check(el("older").hidden, "initial readable history has no older cursor");
    f.phase = "new"; el("refresh").click();
    await wait(() => el("older").textContent.includes("重试") && !el("older").disabled);
    check(el("messages").textContent.includes("LATEST_READABLE") && el("messages").textContent.includes("PREVIOUS_READABLE"), "failed gap keeps both readable ends");
    check(!el("history-notice").hidden && !el("older").hidden, "gap failure exposes notice and retry even without older cursor");
    const calls = f.gapCalls;
    el("refresh").click();
    await wait(() => !el("older").disabled);
    await new Promise(r => setTimeout(r, 1200));
    check(f.gapCalls === calls && !el("older").hidden, "head refresh retains failed gap and does not loop retries");
    f.fail = false; el("older").click();
    await wait(() => f.gapCalls === calls + 1 && !el("older").disabled && !el("older").textContent.includes("重试"));
    check(document.querySelectorAll("#messages [data-item-id]").length === 2, "manual gap retry uses exact cursor without duplicate messages");
    check(el("prompt").value === "KEEP_HISTORY_DRAFT", "gap failure and recovery retain draft");
    document.querySelector(`[data-thread-id="${other}"]`).click();
    await wait(() => el("title").textContent === "Healthy fixture");
    check(el("history-notice").hidden, "switching task clears history warning");
    check(document.documentElement.scrollWidth <= innerWidth, "history notice stays within viewport");
    return { passed: true, checks: f.checks };
  };
})();
