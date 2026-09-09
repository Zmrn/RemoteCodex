// Synthetic DOM fixture shared by headless Windows UI and Android instrumentation.
// No official task writes; image completion is explicitly controlled.
window.runQueuePreviewProbe = async function () {
  const { QueueUI } = await import(location.origin + "/queue-ui.mjs");
  const assert = (value, message) => { if (!value) throw Error(message); };
  const until = async (fn) => {
    for (let i = 0; i < 200; i++) { if (fn()) return; await new Promise(r => setTimeout(r, 10)); }
    throw Error("Fixture condition timeout");
  };
  const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==";
  const blob = new Blob([Uint8Array.from(atob(png.split(",")[1]), c => c.charCodeAt(0))], { type: "image/png" });
  const original = document.getElementById("message-queue");
  original.id = "queue-original";
  const root = document.createElement("div"); root.id = "message-queue"; document.body.append(root);
  let context = { key: "a:probe", agent: "a", id: "probe", connected: true, writable: true, active: true };
  const make = (id, refs = [id]) => ({ id, text: "fixture " + id, editable: true, imageRefs: refs.map(id => ({ id, name: "fixture.png" })) });
  let snapshot = { revision: "1", confirmed: true, messages: [make("one"), make("two"), make("three")], recoveries: [] };
  const jobs = [], calls = [], restored = [], revoked = [];
  const revoke = URL.revokeObjectURL.bind(URL);
  URL.revokeObjectURL = url => { revoked.push(url); revoke(url); };
  const ui = new QueueUI({
    getContext: () => ({ ...context }), journal: async () => ({ id: "probe-request", clear() {} }),
    onChange() {}, onError(e) { throw e; }, onToast() {},
    restoreDraft: async (draft, recoveryId, c) => restored.push({ draft, recoveryId, key: c.key }),
    api: async (agent, route, body) => {
      calls.push({ agent, route, action: body?.action });
      if (route.includes("recoveryId=")) return { draft: { text: "recovered", imageDataUrls: [png, png] } };
      if (!body) return structuredClone(snapshot);
      const message = snapshot.messages.find(m => m.id === body.messageId);
      snapshot = { ...snapshot, revision: String(Number(snapshot.revision) + 1), messages: snapshot.messages.filter(m => m !== message) };
      return { status: "accepted", result: body.action === "take"
        ? { disposition: "draft", draft: { text: message.text, imageDataUrls: [png, png] }, recoveryId: "taken" }
        : { disposition: body.action === "steer" ? "steered" : "removed" } };
    },
    loadImage: (c, ref, signal) => new Promise((resolve, reject) => {
      const job = { key: c.key, id: ref.id, resolve: () => resolve(blob), reject: () => reject(Error("fixture failure")), signal };
      jobs.push(job); signal.addEventListener("abort", () => reject(Error("aborted")), { once: true });
    }),
  });
  try {
    await ui.refresh();
    assert(root.querySelectorAll(".queued-message").length === 3, "text before images");
    assert(root.querySelectorAll(".queue-image-slot").length === 3, "all placeholders present");
    assert(!root.querySelector(".queue-steer").disabled, "steer independent of preview");
    await until(() => jobs.length === 2);
    assert(!root.querySelector("img"), "no image bytes completed");
    jobs[1].resolve();
    await until(() => jobs.length === 3 && root.querySelectorAll("img").length === 1);
    assert(root.querySelector('[data-message-id="two"] img'), "second image can finish before first");
    await ui.refresh(); ui.render();
    assert(jobs.length === 3, "same revision reuses in-flight and completed previews");
    jobs[0].reject();
    await until(() => root.querySelector(".queue-image-retry"));
    root.querySelector(".queue-image-retry").click();
    await until(() => jobs.length === 4);
    await ui.act("steer", snapshot.messages[0]);
    assert(jobs[3].signal.aborted, "steer cancels outstanding preview, does not await it");
    await ui.act("take", snapshot.messages.find(m => m.id === "three"));
    assert(jobs[2].signal.aborted, "take cancels preview");
    assert(restored[0].draft.imageDataUrls.length === 2, "take restores full original images");
    snapshot = { revision: "9", confirmed: true, messages: [make("late")], recoveries: [{ state: "draft", recoveryId: "saved", draft: make("recovery") }] };
    await ui.refresh();
    await until(() => jobs.some(j => j.id === "late"));
    assert(revoked.length > 0, "removed completed preview releases blob");
    await ui.restoreRecovery(snapshot.recoveries[0], context);
    assert(restored[1].draft.imageDataUrls.length === 2, "recovery loads full draft on demand");
    assert(calls.some(c => c.route.includes("recoveryId=saved")), "recovery fetched only on edit");
    context = { ...context, key: "b:probe", agent: "b" }; ui.reset();
    assert(jobs.find(j => j.id === "late").signal.aborted, "device switch aborts previews");
    snapshot = { revision: "10", confirmed: true, messages: [make("late")], recoveries: [] };
    await ui.refresh(); await until(() => jobs.filter(j => j.id === "late").length === 2);
    assert(jobs.at(-1).key === "b:probe", "same media ID isolated by device");
    ui.reset(true);
    assert(root.textContent.includes("未知") && !root.querySelector(".queued-message"), "disconnect displays unknown");
    context = { ...context, key: "legacy:probe" }; ui.reset();
    snapshot = { revision: "11", confirmed: true, messages: [{ id: "legacy", text: "legacy", editable: true, imageDataUrl: png }], recoveries: [] };
    await ui.refresh();
    assert(root.querySelector("img")?.src === png, "legacy inline image compatibility");
    return { passed: true, checks: ["text-before-images", "placeholders", "two-parallel", "out-of-order", "reuse-on-refresh", "retry", "steer-with-pending-images", "take-original-images", "durable-recovery", "device-isolation", "abort-and-revoke", "disconnect-unknown", "legacy"] };
  } finally {
    ui.reset(); root.remove(); original.id = "message-queue"; URL.revokeObjectURL = revoke;
  }
};
