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
const calls=[],errors=[];let created=false;
page.on("pageerror",e=>errors.push(e.message));
await page.route(local.address+"/api/**",async route=>{
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
  if(pathname.endsWith("/threads/"+thread))return json({data:{thread:{id:thread,kind:"codex",title:"受限会话",status:{type:"idle"}},turns:[]}});
  return json({});
});
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
  const writes=calls.filter(c=>c.method==="POST"&&c.pathname.endsWith("/threads"));
  assert.equal(writes.length,1);
  assert.ok(writes[0].body.project==null);
  assert.equal(errors.length,0,errors.join("\n"));
  console.log("Limit UI: remote-only, projectless, Codex-only and one create passed");
}finally{
  await browser.close();
  local.server.closeAllConnections();await new Promise(resolve=>local.server.close(resolve));
  fs.rmSync(dir,{recursive:true,force:true});
}
