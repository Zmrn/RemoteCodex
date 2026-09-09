// Real browser UI, isolated loopback fixtures: never writes to an official task.
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { startServer } from "../src/server.mjs";
import { ROOT } from "../src/bridge.mjs";
const { chromium }=await import(process.env.REMOTE_BRIDGE_PLAYWRIGHT || "playwright-core");
const dir=fs.mkdtempSync(path.join(ROOT,"work/multi-ui-"));
fs.writeFileSync(path.join(dir,"update-settings.json"),'{"automatic":false}');
const {server,address}=await startServer({port:0,bridge:{dataDir:dir,on(){},off(){},connect:async()=>{},disconnect(){}}});
const browser=await chromium.launch({executablePath:"C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",headless:true});
const page=await browser.newPage({viewport:{width:390,height:844}}),errors=[],writes=[],events=[];
const id="77777777-7777-4777-8777-777777777777",other="88888888-8888-4888-8888-888888888888";
const bytes=fs.readFileSync(path.join(ROOT,"fixtures/vision-probe.png"));
let active=false,multi=true,queue=[],ack=null;
page.on("pageerror",e=>errors.push(e.message));
await page.route(address+"/api/**",async route=>{
  const req=route.request(),p=new URL(req.url()).pathname,send=x=>route.fulfill({contentType:"application/json",body:JSON.stringify(x)});
  if(p==="/api/agents")return send({selectedId:"local",agents:[{id:"local",name:"Fixture",kind:"local"},{id:other,name:"Second",kind:"remote",host:"100.64.0.2",port:43128}]});
  if(p.endsWith("/events")){await new Promise(r=>events.push(r));return route.abort().catch(()=>{});}
  if(p.endsWith("/status")||p.endsWith("/connect"))return send({connected:true,existingCodexWritable:true,multiImageInput:multi});
  if(p.endsWith("/threads"))return send({data:{threads:[id,other].map((id,i)=>({id,title:"Image fixture "+i,kind:"codex",status:active?"active":"idle"}))}});
  if(p.endsWith("/messages")){writes.push(req.postDataJSON());if(ack)await new Promise(r=>ack=r);return send({status:"accepted"});}
  if(p.endsWith("/queue")){
    if(req.method()==="POST"){
      const b=req.postDataJSON();writes.push(b);
      if(b.action==="enqueue"){queue.push({id:b.requestId,text:b.prompt,editable:true,imageDataUrls:b.imageDataUrls??[b.imageDataUrl].filter(Boolean)});return send({status:"accepted",result:{disposition:"queued"}});}
      if(b.action==="take"){const draft=queue.shift();return send({status:"accepted",result:{disposition:"draft",draft,recoveryId:"fixture-recovery"}});}
    }
    return send({messages:queue,revision:JSON.stringify(queue),confirmed:true,recoveries:[]});
  }
  if(/\/threads\/[a-f0-9-]{36}$/.test(p))return send({data:{thread:{id:p.split("/").at(-1),kind:"codex",status:{type:active?"active":"idle"}},turns:[]},live:{status:{type:active?"running":"idle",confirmed:true}}});
  if(p.endsWith("/projects"))return send({data:{projects:[]}});
  if(p.endsWith("/models"))return send({models:[]});
  if(p.endsWith("/files"))return send({files:[]});
  return send({});
});
const count=()=>page.locator("#attachment img").count();
const names=()=>page.locator("#image").evaluate(e=>[...e.files].map(f=>f.name));
const pick=async(ns)=>page.locator("#image").setInputFiles(ns.map(name=>({name,mimeType:"image/png",buffer:bytes})));
const task=async(id)=>{await page.locator(`.thread-card[data-thread-id="${id}"]`).first().evaluate(e=>e.click());await page.waitForFunction(()=>!document.querySelector("#image").disabled);};
async function paste(ns){await page.locator("#prompt").evaluate((e,{ns,data})=>{const dt=new DataTransfer();for(const n of ns)dt.items.add(new File([Uint8Array.from(atob(data),c=>c.charCodeAt(0))],n,{type:"image/png"}));e.dispatchEvent(new ClipboardEvent("paste",{clipboardData:dt,bubbles:true,cancelable:true}));},{ns,data:bytes.toString("base64")});}
try{
  await page.goto(address);await task(id);
  await pick(["one.png","two.png"]);await pick(["three.png"]);await paste(["four.png","five.png"]);
  assert.deepEqual(await names(),["one.png","two.png","three.png","four.png","five.png"]);
  await page.locator('#attachment button[aria-label="移除图片 2"]').click();
  assert.deepEqual(await names(),["one.png","three.png","four.png","five.png"]);
  await page.locator("#image").setInputFiles({name:"bad.gif",mimeType:"image/gif",buffer:bytes});assert.equal(await count(),4);
  await pick(Array.from({length:17},(_,i)=>`extra-${i}.png`));assert.equal(await count(),4);
  await page.locator("#prompt").fill("preserve all images");
  await task(other);assert.equal(await count(),0);await task(id);assert.equal(await count(),4);
  await page.evaluate(()=>window.remoteCodexSaveDrafts());await page.reload();await page.waitForFunction(()=>document.querySelectorAll("#attachment img").length===4);
  assert.deepEqual(await names(),["one.png","three.png","four.png","five.png"]);
  assert.equal(await page.locator("#prompt").inputValue(),"preserve all images");
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await page.screenshot({path:path.join(ROOT,"evidence/multi-images-mobile.png")});
  await page.setViewportSize({width:1200,height:850});
  multi=false;await page.locator("#refresh").click();await page.locator("#send").click();
  await page.waitForFunction(()=>document.querySelector("#error").textContent.includes("0.10.4"));assert.equal(writes.length,0);assert.equal(await count(),4);
  multi=true;active=true;await page.locator("#refresh").click();await page.waitForFunction(()=>document.querySelector("#send").title.includes("队列"));await page.locator("#send").click();
  await page.waitForFunction(()=>document.querySelector("#prompt").value==="");assert.equal(writes[0].imageDataUrls.length,4);assert.equal(writes[0].action,"enqueue");
  await page.locator(".queue-more summary").click();await page.locator(".queue-edit").click();await page.waitForFunction(()=>document.querySelectorAll("#attachment img").length===4);
  active=false;await page.locator("#refresh").click();await page.waitForFunction(()=>document.querySelector("#send").title==="发送消息");
  ack=true;await page.locator("#send").click();await page.waitForFunction(()=>document.querySelector("#send").disabled);
  await task(other);await page.locator(`.thread-card[data-thread-id="${id}"]`).first().evaluate(e=>e.click());
  while(typeof ack!=="function")await new Promise(r=>setTimeout(r,20));ack();ack=null;
  await page.waitForFunction(()=>document.querySelector("#prompt").value===""&&document.querySelectorAll("#attachment img").length===0);
  assert.equal(writes.at(-1).imageDataUrls.length,4);
  await pick(["final-a.png","final-b.png"]);await page.setViewportSize({width:844,height:390});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  assert.deepEqual(errors,[]);
  const report={result:"passed",checks:["multiple picker batches append","clipboard files/items are not duplicated","remove middle retains order","invalid or over-limit batch preserves prior files","task switching and IndexedDB reload preserve all images","portrait and landscape strip remains within viewport","old target rejects multi before dispatch","official queue contract restores all images to draft","native message payload includes all images","late send acknowledgement clears sent draft after returning to original task"],source:"isolated browser/API fixtures"};
  fs.writeFileSync(path.join(ROOT,"evidence/multi-images-ui.json"),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}finally{if(typeof ack==="function")ack();for(const r of events)r();await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
