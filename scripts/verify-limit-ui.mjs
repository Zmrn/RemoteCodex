// Shared production UI against an isolated Limit controller fixture.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { startServer } from "../src/server.mjs";
import { LimitedBridge } from "../src/limited-bridge.mjs";
const { chromium } = await import(process.env.REMOTE_BRIDGE_PLAYWRIGHT || "playwright-core");
const dir=fs.mkdtempSync(path.join(os.tmpdir(),"limit-ui-"));
fs.writeFileSync(path.join(dir,"update-settings.json"),'{"automatic":false}');
const device="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", thread="bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const local=await startServer({port:0,edition:"limit",bridge:new LimitedBridge(dir),
  agents:{list:()=>({selectedId:device,agents:[{id:device,kind:"remote",host:"100.64.1.2",port:43128,name:"目标电脑",hasKey:true}]}),preserve:async()=>{},get:id=>({id})},
  access:{status:()=>({}),close:()=>{}}});
const browser=await chromium.launch({headless:true,executablePath:process.env.REMOTE_BRIDGE_BROWSER || "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"});
const page=await browser.newPage({viewport:{width:1280,height:850}});
const installEvents=async page=>page.addInitScript(()=>{
  const original=window.fetch.bind(window),streams=new Set();
  window.fixtureEvent=event=>{for(const stream of streams)stream.enqueue(new TextEncoder().encode("data: "+JSON.stringify(event)+"\n\n"));};
  window.fixtureStreamCount=()=>streams.size;
  window.fetch=(url,options)=>{
    if(!String(url).endsWith("/events"))return original(url,options);
    return Promise.resolve(new Response(new ReadableStream({start(controller){
      streams.add(controller);
      options.signal.addEventListener("abort",()=>{streams.delete(controller);controller.error(new DOMException("Aborted","AbortError"));});
    }}),{headers:{"content-type":"text/event-stream"}}));
  };
});
await installEvents(page);
const calls=[],errors=[];let created=false,reply=false,reads=0;
page.on("pageerror",e=>errors.push(e.message));
const handleApi=async route=>{
  const request=route.request(),pathname=new URL(request.url()).pathname;
  calls.push({pathname,method:request.method(),body:request.method()==="POST"?request.postDataJSON():null});
  const json=value=>route.fulfill({contentType:"application/json",body:JSON.stringify(value)}).catch(()=>{});
  if(pathname==="/api/agents")return json({selectedId:device,agents:[{id:device,kind:"remote",host:"100.64.1.2",port:43128,name:"目标电脑",hasKey:true}]});
  if(pathname.endsWith("/events")){return route.abort().catch(()=>{});}
  if(pathname.endsWith("/status")||pathname.endsWith("/connect"))return json({connected:true,threads:{},capabilities:{create:{supported:true},list:{supported:true},read:{supported:true},usage:{supported:true}},existingCodexWritable:true,multiImageInput:true,projectCreation:{local:false},imageCreation:{supported:true}});
  if(pathname.endsWith("/threads")&&request.method()==="POST"){created=true;return json({status:"accepted",result:{threadId:thread}});}
  if(pathname.endsWith("/threads"))return json({data:{threads:created?[{id:thread,kind:"codex",title:"受限会话",status:"idle"}]:[],pinnedThreads:[]}});
  if(pathname.endsWith("/models"))return json({models:[]});
  if(pathname.endsWith("/usage"))return json({status:"unknown",weekly:[]});
  if(pathname.endsWith("/updates"))return json({supported:false,currentVersion:"0.10.46"});
  if(pathname.endsWith("/queue"))return json({confirmed:true,messages:[],recoveries:[]});
  if(pathname.endsWith("/threads/"+thread)){
    reads++;
    return json({data:{thread:{id:thread,kind:"codex",title:"受限会话",status:{type:"idle"}},turns:reply?[{id:"turn",status:"completed",items:[{id:"reply",type:"agentMessage",text:"受限版实时回复已显示"}]}]:[]}});
  }
  return json({});
};
await page.route(local.address+"/api/**",handleApi);
try{
  await page.goto(local.address);
  await page.waitForFunction(()=>document.querySelector("#connection")?.textContent?.includes("已连接"));
  assert.equal(await page.locator("#mode-picker").isVisible(),false);
  assert.equal(await page.locator("#project-display").isVisible(),false);
  assert.equal(await page.locator("#project-filter").isVisible(),false);
  assert.equal(await page.locator(".setup-local").isVisible(),false);
  assert.ok(!calls.some(c=>c.pathname.endsWith("/projects")));
  await page.locator("#prompt").fill("新建我自己的无项目会话");
  await page.locator("#send").click();
  await page.waitForFunction(()=>!!document.querySelector('.thread-card[data-thread-id="bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"]'));
  await page.waitForFunction(()=>document.querySelector("#title")?.textContent?.includes("受限会话")&&window.fixtureStreamCount()>0);
  assert.equal(await page.locator('[data-item-id="reply"]').count(),0);
  const writes=calls.filter(c=>c.method==="POST"&&c.pathname.endsWith("/threads"));
  assert.equal(writes.length,1);
  assert.ok(writes[0].body.project==null);
  const before=reads;
  reply=true;
  await page.evaluate(id=>window.fixtureEvent({kind:"thread-state",threadId:id,status:{type:"idle",confirmed:true}}),thread);
  await page.locator('[data-item-id="reply"]').waitFor();
  assert.ok(reads>before,"Owned stream event must refresh the open conversation");
  assert.match(await page.locator('[data-item-id="reply"]').textContent(),/受限版实时回复已显示/);
  const mobileContext=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
  const mobile=await mobileContext.newPage();
  mobile.on("pageerror",e=>errors.push(e.message));
  await mobile.addInitScript(()=>{
    window.limitUiUnhandled=[];
    window.addEventListener("unhandledrejection",event=>window.limitUiUnhandled.push(String(event.reason)));
  });
  await mobile.route(local.address+"/api/**",route=>new URL(route.request().url()).pathname==="/api/agents"
    ? route.fulfill({contentType:"application/json",body:JSON.stringify({selectedId:null,agents:[]})})
    : handleApi(route));
  await mobile.goto(local.address);
  await mobile.waitForFunction(()=>document.querySelector("#connection")?.textContent?.includes("尚未添加设备"));
  await mobile.locator("#mobile-menu").click();
  const refreshed=mobile.waitForResponse(response=>new URL(response.url()).pathname==="/api/agents");
  await mobile.locator("#footer-agent").click();
  await refreshed;
  await mobile.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  assert.equal(await mobile.locator("#agent-menu").isVisible(),true,"Empty device refresh must keep the add menu open");
  await mobile.locator("#add-agent").click();
  await mobile.locator("#agent-dialog").waitFor({state:"visible"});
  await mobile.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  assert.equal(await mobile.locator("#agent-dialog").evaluate(el=>el.open),true,"Add device dialog must remain open on mobile");
  assert.deepEqual(await mobile.evaluate(()=>window.limitUiUnhandled),[]);
  const mobileReply=await mobileContext.newPage();
  await installEvents(mobileReply);
  mobileReply.on("pageerror",e=>errors.push(e.message));
  await mobileReply.route(local.address+"/api/**",handleApi);
  reply=false;
  await mobileReply.goto(local.address+"/?thread="+thread);
  await mobileReply.waitForFunction(()=>document.querySelector("#title")?.textContent?.includes("受限会话")&&window.fixtureStreamCount()>0);
  assert.equal(await mobileReply.locator('[data-item-id="reply"]').count(),0);
  reply=true;
  await mobileReply.evaluate(id=>window.fixtureEvent({kind:"thread-state",threadId:id,status:{type:"idle",confirmed:true}}),thread);
  await mobileReply.locator('[data-item-id="reply"]').waitFor();
  assert.match(await mobileReply.locator('[data-item-id="reply"]').textContent(),/受限版实时回复已显示/);
  await mobileContext.close();
  assert.equal(errors.length,0,errors.join("\n"));
  console.log("Limit UI: remote-only, projectless, Codex-only, first-device dialog, create and live replies on desktop/mobile passed");
}finally{
  await browser.close();
  local.server.closeAllConnections();await new Promise(resolve=>local.server.close(resolve));
  fs.rmSync(dir,{recursive:true,force:true});
}
