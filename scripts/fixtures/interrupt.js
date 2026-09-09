// Production UI fixture: every API request is intercepted; never reaches a real device.
(() => {
  // Isolate this run from the emulator's previously saved Chat mode/drafts.
  localStorage.setItem("remote-codex-mode", "codex");
  localStorage.setItem("remote-codex-window-id", "interrupt-fixture-" + crypto.randomUUID());
  const id = "77777777-7777-4777-8777-777777777777", other = "88888888-8888-4888-8888-888888888888";
  const original = window.fetch.bind(window), streams = new Set();
  const fixture = window.interruptFixture = { id, other, active: true, ready: true, supported: true, connected: true, calls: [], checks: [] };
  const response = data => Promise.resolve(new Response(JSON.stringify(data), { headers: { "Content-Type": "application/json" } }));
  window.fetch = (url, options = {}) => {
    const p = new URL(String(url), location.origin).pathname;
    if (!p.startsWith("/api/")) return original(url, options);
    if (p.endsWith("/events")) return Promise.resolve(new Response(new ReadableStream({
      start(c) { streams.add(c); options.signal?.addEventListener("abort", () => { streams.delete(c); try { c.close(); } catch {} }); }
    }), { headers: { "Content-Type": "text/event-stream" } }));
    if (p === "/api/agents") return response({ selectedId: "local", agents: [{ id: "local", kind: "local", name: "停止测试设备" }] });
    if (p.endsWith("/status") || p.endsWith("/connect")) return response({
      connected: fixture.connected, existingCodexWritable: true, interrupt: { supported: fixture.supported },
      testThreads: {}, testExcludedThreadIds: [id],
    });
    if (p.endsWith("/projects")) return response({ data: { projects: [] } });
    if (p.endsWith("/threads")) return response({ data: { threads: [
      { id, title: "普通运行中会话", kind: "codex", status: fixture.active ? "active" : "idle" },
      { id: other, title: "另一个会话", kind: "codex", status: "idle" },
    ] } });
    if (p.endsWith("/interrupt")) {
      fixture.calls.push({ path: p, body: JSON.parse(options.body) });
      return new Promise(resolve => { fixture.release = result => resolve(new Response(JSON.stringify(result), { headers: { "Content-Type": "application/json" } })); });
    }
    if (p.endsWith("/queue")) return response({ messages: [], recoveries: [], confirmed: true });
    if (p.endsWith("/threads/" + id) || p.endsWith("/threads/" + other)) {
      const target = p.endsWith(id) ? id : other, active = target === id && fixture.active;
      return response({ data: { thread: { id: target, title: target === id ? "普通运行中会话" : "另一个会话", kind: "codex", status: { type: active ? "active" : "idle" } }, turns: [] },
        live: { activeTurnId: active && fixture.ready ? "current-turn" : null,
          status: { type: active ? "running" : "interrupted", confirmed: true } } });
    }
    return response({});
  };
  fixture.emit = event => { for (const c of streams) c.enqueue(new TextEncoder().encode("data: " + JSON.stringify(event) + "\n\n")); };
  const wait = async fn => {
    const end = Date.now() + 20000;
    while (Date.now() < end) { if (fn()) return; await new Promise(r => setTimeout(r, 50)); }
    throw Error("Interrupt fixture timed out: " + fn.toString() + "; checks=" + fixture.checks.join(",") +
      "; UI=" + document.getElementById("error")?.textContent + "; stop=" +
      JSON.stringify({ hidden: document.getElementById("interrupt")?.hidden, disabled: document.getElementById("interrupt")?.disabled, reason: document.getElementById("writable")?.textContent }));
  };
  const el = id => document.getElementById(id);
  const check = (value, label) => { if (!value) throw Error(label); fixture.checks.push(label); };
  fixture.run = async () => {
    await wait(() => document.querySelector('[data-thread-id="' + id + '"]'));
    const card = document.querySelector('[data-thread-id="' + id + '"]');
    if (!card.classList.contains("selected")) card.click();
    await wait(() => !el("interrupt").hidden && !el("interrupt").disabled);
    check(!el("interrupt").hidden, "ordinary task stop works without Probe registration, including user-operated development tasks");
    check(el("send").hidden, "empty running composer shows square stop");
    const text = el("prompt"); text.value = "保留这条草稿"; text.dispatchEvent(new Event("input", { bubbles: true }));
    check(!el("interrupt").hidden && !el("send").hidden, "stop remains accessible beside queue send when a draft exists");
    fixture.ready = false; el("refresh").click();
    await wait(() => el("interrupt").disabled);
    check(!el("interrupt").hidden, "missing live turn disables stop visibly despite active history");
    fixture.ready = true; el("refresh").click();
    await wait(() => !el("interrupt").disabled);
    el("interrupt").click(); el("interrupt").click();
    await wait(() => fixture.calls.length === 1 && fixture.release);
    check(el("interrupt").disabled && fixture.calls[0].body.expectedTurnId === "current-turn", "pending stop submits exactly once with live turn, despite empty history page");
    fixture.release({ status: "accepted" });
    await wait(() => !el("interrupt").disabled);
    check(!el("interrupt").hidden && text.value === "保留这条草稿", "ack does not fabricate stopped state or clear draft");
    fixture.active = false; fixture.emit({ kind: "thread-state", threadId: id, status: { type: "interrupted", confirmed: true } });
    await wait(() => el("interrupt").hidden);
    check(!el("send").hidden, "owner interrupted event returns composer to send");
    fixture.active = true; fixture.emit({ kind: "thread-state", threadId: id, status: { type: "running", confirmed: true } });
    await wait(() => !el("interrupt").hidden);
    fixture.emit({ kind: "connection-interrupted" });
    await wait(() => el("interrupt").hidden);
    check(fixture.calls.length === 1, "disconnect never resends a stop");
    return { passed: true, checks: fixture.checks };
  };
})();
