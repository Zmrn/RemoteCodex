(() => {
  localStorage.setItem("remote-codex-mode", "codex");
  localStorage.setItem("remote-codex-window-id", "create-image-fixture-" + crypto.randomUUID());
  const original = fetch.bind(window), id = "77777777-7777-4777-8777-777777777777";
  const f = window.createImageFixture = { supported: true, imageCreation: true, fail: true, requests: [], checks: [] };
  const json = (v, status = 200) => Promise.resolve(new Response(JSON.stringify(v), { status, headers: { "Content-Type": "application/json" } }));
  window.fetch = (url, options = {}) => {
    const p = new URL(String(url), location.origin).pathname;
    if (!p.startsWith("/api/")) return original(url, options);
    if (p.endsWith("/events")) return Promise.resolve(new Response(new ReadableStream({ start(c) { options.signal?.addEventListener("abort", () => { try { c.close(); } catch {} }); } }), { headers: { "Content-Type": "text/event-stream" } }));
    if (p === "/api/agents") return json({ selectedId: "local", agents: [{ id: "local", kind: "local", name: "新建图片测试", host: "fixture" }] });
    if (p.endsWith("/status") || p.endsWith("/connect")) return json({ connected: true, existingCodexWritable: f.supported,
      multiImageInput: true, imageCreation: { supported: f.imageCreation }, desktopCompatibility: { writeSupported: f.supported } });
    if (p.endsWith("/projects")) return json({ data: { projects: [] } });
    if (p.endsWith("/threads") && options.method === "POST") {
      f.requests.push(JSON.parse(options.body));
      return f.fail ? json({ error: "测试：目标创建失败，图片和草稿应保留" }, 500) : json({ status: "accepted", result: { threadId: id } });
    }
    if (p.endsWith("/threads")) return json({ data: { threads: [] } });
    if (p.endsWith("/threads/" + id)) return json({ data: { thread: { id, kind: "codex", title: "已创建图片会话", status: { type: "idle" } }, turns: [] } });
    return json({});
  };
  const el = id => document.getElementById(id), wait = async fn => {
    const end = Date.now() + 15000; while (Date.now() < end) { if (fn()) return; await new Promise(r => setTimeout(r, 50)); }
    throw Error("Create fixture timeout: " + fn.toString() + " " + el("error")?.textContent);
  };
  const check = (value, label) => { if (!value) throw Error(label); f.checks.push(label); };
  const file = new File([new Uint8Array([137,80,78,71,13,10,26,10])], "fixture.png", { type: "image/png" });
  f.run = async () => {
    await wait(() => !el("prompt").disabled);
    const paste = () => { const e = new Event("paste", { bubbles: true, cancelable: true }); Object.defineProperty(e, "clipboardData", { value: { files: [file], items: [] } }); el("prompt").dispatchEvent(e); };
    paste(); paste();
    check(document.querySelectorAll(".attachment-chip").length === 2, "two pasted images append in a new conversation");
    check(!el("send").disabled, "image-only new conversation can submit");
    el("prompt").value = "新建带两张图片"; el("prompt").dispatchEvent(new Event("input", { bubbles: true }));
    el("send").click();
    await wait(() => f.requests.length === 1 && !el("send").disabled);
    check(f.requests[0].imageDataUrls.length === 2 && f.requests[0].prompt === "新建带两张图片", "new conversation request includes text and both images");
    check(el("prompt").value === "新建带两张图片" && document.querySelectorAll(".attachment-chip").length === 2, "creation failure preserves full draft and attachments");
    f.supported = false; el("refresh").click();
    await wait(() => el("send").disabled);
    check(!el("prompt").disabled && !el("image").disabled, "unsupported target blocks writes while draft remains editable");
    check(f.requests.length === 1, "unsupported version does not dispatch a create");
    f.supported = true; f.imageCreation = false; el("refresh").click();
    await wait(() => el("writable").textContent.includes("带图新建"));
    check(el("send").disabled, "older target never silently drops images");
    f.imageCreation = true; f.fail = false; el("refresh").click();
    await wait(() => !el("send").disabled);
    el("send").click();
    await wait(() => el("title").textContent === "已创建图片会话" && !el("prompt").value);
    check(document.querySelectorAll(".attachment-chip").length === 0, "confirmed send clears attachments and enters the created official ID");
    check(f.requests[1].requestId === f.requests[0].requestId, "retry uses the same durable create request ID");
    return { passed: true, checks: f.checks };
  };
})();
