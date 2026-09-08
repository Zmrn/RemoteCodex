// Inspect installed UI and the saved laptop. Never submit messages or save
// selection preferences; no screenshots or private message bodies are persisted.
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
const { chromium } = await import(
  process.env.REMOTE_BRIDGE_PLAYWRIGHT || "playwright-core"
);
const [agent, id, expectedReply, control] = process.argv.slice(2);
for (const value of [agent, id, control])
  assert.match(value ?? "", /^[a-f0-9-]{36}$/);
assert.match(expectedReply ?? "", /^[\w-]+$/);
const runtime = JSON.parse(
  fs.readFileSync(
    path.join(process.env.LOCALAPPDATA, "RemoteCodex/data/server.json"),
  ),
);
const html = await (await fetch(runtime.address)).text();
const headers = {
  "X-Bridge-CSRF": html.match(/name="bridge-csrf"\s+content="([^"]+)"/)[1],
};
const prefix = runtime.address + "/api/agents/" + agent + "/bridge";
const api = async (route) => {
  const response = await fetch(prefix + route, {
    headers,
    signal: AbortSignal.timeout(75000),
  });
  assert.equal(response.status, 200);
  return response.json();
};
const devices = await (
  await fetch(runtime.address + "/api/agents", { headers })
).json();
assert.ok(devices.agents.some((a) => a.id === agent));
const before = await api("/status");
const browser = await chromium.launch({
  executablePath:
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  headless: true,
});
const page = await browser.newPage({ viewport: { width: 1440, height: 960 } }),
  errors = [],
  blocked = [];
page.on("pageerror", (e) => errors.push(e.message));
await page.route(runtime.address + "/api/**", (route) => {
  const req = route.request(),
    pathname = new URL(req.url()).pathname;
  if (pathname === "/api/agents")
    return route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ ...devices, selectedId: agent }),
    });
  if (pathname === "/api/agents/select")
    return route.fulfill({ contentType: "application/json", body: "{}" });
  if (
    req.method() === "POST" &&
    !/\/(follow|connect|activity)$/.test(pathname)
  ) {
    blocked.push(pathname);
    return route.abort();
  }
  return route.continue();
});
const waitItem = (item) =>
  page.waitForFunction(
    (item) =>
      document.querySelector('[data-item-id="' + CSS.escape(item) + '"]'),
    item,
    { timeout: 75000 },
  );
const select = async (task) => {
  await page
    .locator('.thread-card[data-thread-id="' + task + '"]')
    .first()
    .click();
  await page.waitForFunction(
    () => document.querySelectorAll("#messages .message").length > 0,
    {},
    { timeout: 75000 },
  );
};
try {
  await page.goto(runtime.address);
  await select(id);
  await waitItem(expectedReply);
  let olderPages = 0,
    followup = false;
  for (; olderPages < 12; olderPages++) {
    followup = await page
      .locator("#messages")
      .evaluate((e) => /怎么停了[？?]/.test(e.textContent));
    if (followup) break;
    await page.locator("#older").click();
    await page.waitForFunction(
      () => !document.querySelector("#older").disabled,
    );
  }
  assert.equal(followup, true);
  const ids = await page
    .locator("#messages .message[data-item-id]")
    .evaluateAll((es) => es.map((e) => e.dataset.itemId));
  assert.equal(new Set(ids).size, ids.length);
  await select(control);
  const head = await api(
    "/threads/" + control + "?view=conversation&paging=items-v1",
  );
  const last = head.data.turns[0].items
    .filter((i) => i.type === "agentMessage" && i.text)
    .at(-1);
  assert.ok(last);
  await waitItem(last.id);
  assert.equal(
    await page
      .locator("#metadata")
      .textContent()
      .then((t) => t.includes(control)),
    true,
  );
  await select(id);
  await waitItem(expectedReply);
  const after = await api("/status");
  assert.equal(after.officialPid, before.officialPid);
  assert.deepEqual(errors, []);
  assert.deepEqual(blocked, []);
  const result = {
    result: "passed",
    localVersion: runtime.version,
    remoteVersion: (await api("/updates")).currentVersion,
    taskId: id,
    controlTaskId: control,
    expectedReply,
    controlReplyId: last.id,
    screenshotFollowupFound: followup,
    olderPages,
    duplicateMessages: 0,
    switchBackLatestFound: true,
    officialPid: after.officialPid,
    officialUnchanged: true,
    taskWrites: 0,
    errors,
    blocked,
  };
  fs.writeFileSync(
    "evidence/owner-history-ui.json",
    JSON.stringify(result, null, 2),
  );
  console.log(JSON.stringify(result));
} finally {
  await browser.close();
}
