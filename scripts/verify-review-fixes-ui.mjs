// Real UI and real streaming HTTP, with isolated task fixtures only.
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import assert from "node:assert/strict";
import { ROOT } from "../src/bridge.mjs";
const { chromium } = await import(
  process.env.REMOTE_BRIDGE_PLAYWRIGHT || "playwright-core"
);
const ids = [
  "77777777-7777-4777-8777-777777777777",
  "88888888-8888-4888-8888-888888888888",
];
const streams = new Map(),
  errors = [],
  checks = [],
  writes = [];
let active = 0,
  peak = 0,
  reads = 0,
  aborted = 0,
  delay = 2000,
  interval = 650;
let pendingSend = null;
const followRequests=[];
let selectionFailure = false,
  readFailure = false,
  revision = 0;
const status = () => ({
  connected: true,
  existingCodexWritable: true,
  viewerLeases: true,
  threads: {},
});
const server = http.createServer(async (req, res) => {
  const p = new URL(req.url, "http://fixture").pathname;
  if(p.endsWith('/messages')) {const chunks=[];for await(const chunk of req)chunks.push(chunk);writes.push(JSON.parse(Buffer.concat(chunks)));pendingSend=()=>{res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({status:'accepted',result:{threadId:ids[0]}}));};return;}
  const json = (data, code = 200) => {
    res.writeHead(code, { "content-type": "application/json" });
    res.end(JSON.stringify(data));
  };
  if (!p.startsWith("/api/")) {
    const file = p === "/" ? "index.html" : p.slice(1);
    if (!/^[\w.-]+$/.test(file)) return res.end();
    const types = {
      ".html": "text/html",
      ".js": "text/javascript",
      ".mjs": "text/javascript",
      ".css": "text/css",
      ".svg": "image/svg+xml",
    };
    res.setHeader(
      "content-type",
      types[path.extname(file)] || "application/octet-stream",
    );
    return res.end(
      fs
        .readFileSync(path.join(ROOT, "public", file))
        .toString()
        .replace("__BRIDGE_CSRF__", "fixture-only")
        .replace("__BRIDGE_VERSION__", "fixture"),
    );
  }
  if (p === "/api/agents")
    return json({
      selectedId: "local",
      agents: [
        { id: "local", kind: "local", name: "本机测试", host: "fixture" },
        {
          id: "laptop",
          kind: "remote",
          name: "笔记本测试",
          host: "100.70.8.9",
          port: 43128,
        },
      ],
    });
  if (p === "/api/agents/select")
    return selectionFailure
      ? json({ error: "fixture selection failed" }, 500)
      : json({});
  if (p.endsWith("/updates"))
    return json({ supported: false, currentVersion: "fixture" });
  if (p.endsWith("/activity")) return json({});
  const agent = /\/agents\/([^/]+)/.exec(p)?.[1];
  if (p.endsWith("/status") || p.endsWith("/connect")) return json(status());
  if (p.endsWith("/projects")) return json({ data: { projects: [] } });
  if (p.endsWith("/usage")) return json({ status: "available", weekly: [] });
  if (p.endsWith("/queue"))
    return json({
      confirmed: true,
      revision: "1",
      messages: [],
      recoveries: [],
    });
  if (p.endsWith("/follow")) { const chunks=[];for await(const chunk of req)chunks.push(chunk);followRequests.push({path:p,...JSON.parse(Buffer.concat(chunks))});return json({}); }
  if (p.endsWith("/events")) {
    res.writeHead(200, { "content-type": "text/event-stream" });
    res.write(
      `data: ${JSON.stringify({ kind: "resync-required", ...status() })}\n\n`,
    );
    streams.set(agent, res);
    const tick = () =>
      res.write(
        `data: ${JSON.stringify({ kind: "thread-state", threadId: ids[0], status: { type: "running", confirmed: true } })}\n\n`,
      );
    let timer = setInterval(()=>res.write(": keepalive\n\n"), 5000);
    req.on("close", () => {
      clearInterval(timer);
      if (streams.get(agent) === res) streams.delete(agent);
    });
    return;
  }
  if (p.endsWith("/threads") && req.method === "GET")
    return json({
      data: {
        threads: ids.map((id, i) => ({
          id,
          kind: "codex",
          title: agent + " fixture " + i,
          status: "idle",
        })),
      },
    });
  const id = ids.find((id) => p.endsWith("/threads/" + id));
  if (id && req.method === "GET") {
    const n = ++reads,
      rev = revision;
    if (agent === "laptop") {
      active++;
      peak = Math.max(peak, active);
    }
    let finished = false;
    const timer = setTimeout(
      () => {
        finished = true;
        if (readFailure)
          return json({ error: "fixture content unavailable" }, 502);
        json({
          source: "fixture",
          observedAt: String(n),
          data: {
            thread: {
              id,
              kind: "codex",
              title: agent + " fixture " + ids.indexOf(id),
              status: { type: "idle" },
            },
            page: { nextCursor: null },
            turns: [
              {
                id: "fixture-turn",
                status: "completed",
                items: [
                  {
                    id: "fixture-message",
                    type: "agentMessage",
                    text: `${agent} content ${ids.indexOf(id)} revision ${rev}`,
                  }, {id:'question-fixture',type:'agentMessage',delivery:'async',text:'Review fixture question',questions:[{title:'Review fixture question',options:[]}],
                  },
                ],
              },
            ],
          },
          live: { status: { type: "running", confirmed: true }, state: {} },
        });
      },
      agent === "laptop" ? delay : 30,
    );
    res.on("close", () => {
      clearTimeout(timer);
      if (agent === "laptop") {
        active--;
        if (!finished) aborted++;
      }
    });
    return;
  }
  if (req.method === "POST") writes.push(p);
  json({});
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const address = "http://127.0.0.1:" + server.address().port;
const browser = await chromium.launch({
  executablePath:
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  headless: true,
});
const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
page.on("pageerror", (e) => errors.push(e.message));
const device = async (name) => {
  await page.locator("#footer-agent").click();
  await page.locator("#agent-menu button").filter({ hasText: name }).click();
};
const thread = async (id) =>
  page.locator(`.thread-card[data-thread-id="${id}"]`).first().click();
const connected = () =>
  page.waitForFunction(
    () =>
      document.querySelector("#connection").textContent === "已连接官方桌面",
  );

try {
 await page.goto(address);await connected();await thread(ids[0]);await page.locator('#prompt:not(:disabled)').waitFor();
 await page.locator('#prompt').fill('SYNTHETIC_SENT_ONCE');await page.locator('#send').click();
 await page.waitForFunction(()=>document.getElementById('prompt').disabled);
 await thread(ids[1]);await page.locator('#prompt:not(:disabled)').waitFor();await thread(ids[0]);
 await page.waitForFunction(()=>document.getElementById('prompt').value==='SYNTHETIC_SENT_ONCE');
 assert.equal(await page.locator('#send').isDisabled(),true);
 assert.ok(pendingSend);pendingSend();await page.locator('#prompt:not(:disabled)').waitFor();
 assert.equal(await page.locator('#prompt').inputValue(),'');assert.equal(await page.locator('#send').isDisabled(),true);
 assert.equal(writes.filter(x=>x.requestId).length,1);
 checks.push('return before acknowledgement clears the sent draft without generating a duplicate');
 const question=page.locator('.question-input');await question.fill('SYNTHETIC_UNSENT_ANSWER');await question.focus();
 await question.evaluate(el=>{window.originalQuestion=el;el.setSelectionRange(3,7);el.dispatchEvent(new CompositionEvent('compositionstart',{data:'输入'}));});
 revision++;streams.get('local').write('data: '+JSON.stringify({kind:'thread-state',threadId:ids[0],status:{type:'idle',confirmed:true}})+'\n\n');
 await page.waitForFunction(()=>document.querySelector('#messages').textContent.includes('revision 1'));
 assert.equal(await question.evaluate(el=>el===window.originalQuestion&&el===document.activeElement&&el.selectionStart===3&&el.selectionEnd===7),true);
 await question.evaluate(el=>el.dispatchEvent(new CompositionEvent('compositionend',{data:'输入'})));
 checks.push('live refresh retains the same question DOM, focus, selection and composition target');
 await page.waitForFunction(async()=>{const {readRecovery}=await import('/update-recovery.mjs');return JSON.stringify(await readRecovery()).includes('SYNTHETIC_UNSENT_ANSWER')});
 await page.reload();await question.waitFor();assert.equal(await question.inputValue(),'SYNTHETIC_UNSENT_ANSWER');
 await page.reload();await question.waitFor();assert.equal(await question.inputValue(),'SYNTHETIC_UNSENT_ANSWER');
 await thread(ids[1]);await question.waitFor();assert.equal(await question.inputValue(),'');
 await thread(ids[0]);await question.waitFor();assert.equal(await question.inputValue(),'SYNTHETIC_UNSENT_ANSWER');
 checks.push('question answers autosave, survive two reloads and remain scoped to the task');
 readFailure=true;revision++;
 streams.get('local').write('data: '+JSON.stringify({kind:'thread-state',threadId:ids[0],status:{type:'idle',confirmed:true}})+'\n\n');
 await page.waitForFunction(()=>document.getElementById('task-state').textContent.includes('内容读取失败'));
 assert.equal(await page.locator('#prompt').isDisabled(),true);
 const before=reads;readFailure=false;
 await page.waitForFunction(()=>!document.getElementById('prompt').disabled,{},{timeout:12000});assert.ok(reads>before);
 checks.push('idle task recovers from a transient content failure without a new owner event');
 const released=followRequests.filter(x=>x.following===false);
 assert.ok(released.length>=3);assert.ok(released.every(x=>typeof x.viewerId==='string'));
 checks.push('navigation explicitly releases each old viewer lease');
 assert.deepEqual(errors,[]);
 const result={result:'passed',checks,officialTaskWrites:0,fixtureTaskWrites:writes.filter(x=>x.requestId).length};
 fs.writeFileSync(path.join(ROOT,'evidence/review-fixes-ui.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}finally{await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
