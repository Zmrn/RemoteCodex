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
const downloads=[];
let selectionFailure = false,
  readFailure = false,
  revision = 0;
const status = () => ({
  connected: true,
  existingCodexWritable: true,
  threads: {},
});
const server = http.createServer(async (req, res) => {
  const p = new URL(req.url, "http://fixture").pathname;
  if(p.endsWith('/messages')) {const chunks=[];for await(const chunk of req)chunks.push(chunk);writes.push(JSON.parse(Buffer.concat(chunks)));pendingSend=()=>{res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({status:'accepted',result:{threadId:ids[0]}}));};return;}
  if(p==='/api/downloads/image'||p==='/api/downloads/start') { const chunks=[];for await(const chunk of req)chunks.push(chunk);const bytes=Buffer.concat(chunks);downloads.push(p.endsWith('/image')?{kind:'binary',bytes}: {kind:'route',payload:JSON.parse(bytes)});res.writeHead(200,{'content-type':'application/json'});res.end('{"accepted":true}');return; }
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
        .replace("__BRIDGE_CSRF__", "fixture-only").replace("<head>", '<head><meta name="bridge-platform" content="android">')
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
  if (p.endsWith("/follow")) return json({});
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
 await page.goto(address);await connected();
 const png=Buffer.alloc(7*1024*1024);fs.readFileSync(path.join(ROOT,'fixtures/multi-image-a.png')).copy(png);
 await page.route(address+'/synthetic-large.png',route=>route.fulfill({contentType:'image/png',body:png}));
 await page.evaluate(async()=>{
   const blob=await(await fetch('/synthetic-large.png')).blob();window.imageBlob=URL.createObjectURL(blob);
   const a=document.createElement('a');a.download='synthetic-large.png';a.href=window.imageBlob;a.id='large-download';document.body.append(a);a.click();
 });
 await page.waitForFunction(()=>document.getElementById('toast').textContent.includes('保存位置'));
 assert.equal(downloads.length,1);assert.equal(downloads[0].kind,'binary');assert.deepEqual(downloads[0].bytes,png);
 const route='/api/agents/11111111-1111-4111-8111-111111111111/bridge/threads/'+ids[0]+'/media?id=synthetic-image-id';
 await page.evaluate(async route=>{
   const {zoomableImage}=await import('/image-viewer.mjs');const img=document.createElement('img');img.src=window.imageBlob;img.dataset.downloadRoute=route;document.body.append(img);zoomableImage(img,'original.png');img.click();
 },route);
 await page.locator('#image-viewer[open]').waitFor();await page.locator('.image-viewer-download').click();
 await page.waitForTimeout(200);
 assert.equal(downloads.length,2);assert.deepEqual(downloads[1],{kind:'route',payload:{route,name:'original.png'}});
 assert.deepEqual(errors,[]);
 const report={result:'passed',source:'shared Android UI in isolated browser; native saving tested separately',checks:['7 MiB blob reaches binary download endpoint byte-for-byte','zoomed conversation image keeps its originating authenticated media route','no 6 MiB rejection or missing attachment workaround']};
 fs.writeFileSync(path.join(ROOT,'evidence/review-image-download-ui.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}finally{await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
