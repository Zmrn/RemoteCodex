// Read-only official Chat -> current production renderer. Keep private text in
// memory only; evidence contains counts and owner identity, never message text.
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { Desktop } from "../src/desktop.mjs";
import { startServer } from "../src/server.mjs";
import { ROOT } from "../src/bridge.mjs";
const id = process.argv[2];
assert.match(id ?? "", /^[a-f0-9-]{36}$/, "Supply the exact Chat thread ID to read");
const { chromium } = await import(process.env.REMOTE_BRIDGE_PLAYWRIGHT || "playwright-core");
const dir = fs.mkdtempSync(path.join(ROOT, "work/citations-read-"));
fs.writeFileSync(path.join(dir, "update-settings.json"), '{"automatic":false}');
const desktop = new Desktop();
let browser, server;
try {
  const identity = await desktop.connect();
  const data = await desktop.call("read_thread", {threadId:id,turnLimit:10,includeOutputs:true,maxOutputCharsPerItem:20000});
  assert.equal(data.thread.id, id);
  const messages = data.turns.flatMap(t => t.items).filter(i => i.type === "agentMessage" && /\ue200cite/.test(i.text));
  assert.ok(messages.length, "Selected task must contain citations");
  const hosting = await startServer({port:0,bridge:{dataDir:dir,on(){},off(){},async connect(){},disconnect(){}}});
  server = hosting.server;
  browser = await chromium.launch({executablePath:"C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",headless:true});
  const page = await browser.newPage(), errors=[];
  page.on("pageerror", e => errors.push(e.message));
  // No app.js initialization or agent calls; only serve the real renderer.
  await page.route(hosting.address + "/", route => route.fulfill({contentType:"text/html",body:'<html><head><link rel="stylesheet" href="/style.css"></head><body></body></html>'}));
  await page.goto(hosting.address);
  const rendering = await page.evaluate(async messages => {
    const {markdown, copyMarkdown} = await import("/ui.mjs");
    let references=0, unrendered=0, copiedMarkers=0;
    for (const message of messages) {
      const rendered = markdown(message.text); document.body.append(rendered);
      references += rendered.querySelectorAll(".citation-ref").length;
      const check = rendered.cloneNode(true); check.querySelectorAll("code").forEach(n => n.remove());
      unrendered += (check.textContent.match(/\ue200cite/g) ?? []).length;
      copiedMarkers += (copyMarkdown(message.text).match(/\ue200cite/g) ?? []).length;
    }
    document.querySelector(".citation-ref").click();
    return {references,unrendered,copiedMarkers,explanationOpens:document.querySelector(".citation-notice").open};
  }, messages);
  assert.ok(rendering.references > 0); assert.equal(rendering.unrendered,0);
  assert.equal(rendering.copiedMarkers,0); assert.ok(rendering.explanationOpens); assert.deepEqual(errors,[]);
  const result={observedAt:new Date().toISOString(),officialPid:identity.officialPid,threadId:id,assistantMessages:messages.length,
    fields:[...new Set(messages.flatMap(Object.keys))],attachments:data.attachments?.length??0,...rendering,mutations:0,pageErrors:errors};
  fs.writeFileSync(path.join(dir,"result.json"),JSON.stringify(result,null,2));
  console.log(JSON.stringify(result,null,2));
} finally { desktop.close(); await browser?.close(); if(server){server.closeAllConnections();await new Promise(r=>server.close(r));} }
