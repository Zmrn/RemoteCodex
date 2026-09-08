// Runs the production interface against isolated fixtures, never official tasks.
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { startServer } from "../src/server.mjs";
import { ROOT } from "../src/bridge.mjs";
const { chromium } = await import(process.env.REMOTE_BRIDGE_PLAYWRIGHT || "playwright-core");
const dir = fs.mkdtempSync(path.join(ROOT,"work/chat-ui-"));
fs.writeFileSync(path.join(dir,"update-settings.json"),'{"automatic":false}');
const {server,address}=await startServer({port:0,bridge:{dataDir:dir,on(){},off(){},connect:async()=>{},disconnect(){}}});
const browser=await chromium.launch({executablePath:"C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",headless:true});
const page=await browser.newPage({viewport:{width:1440,height:960}});
const errors=[],calls=[],events=[];
const cid="11111111-1111-4111-8111-111111111111", xid="22222222-2222-4222-8222-222222222222";
let runtime="idle",connected=true,capable=true,reply="Chat fixture reply",delay=0;
const history=[{id:"chat-turn",status:"completed",startedAt:1,items:[{id:"chat-msg",type:"agentMessage",text:reply}]}];
page.on("pageerror",e=>errors.push(e.message));
await page.route(address+"/api/**",async route=>{
 const req=route.request(),p=new URL(req.url()).pathname;
 calls.push({path:p,method:req.method(),body:req.postDataJSON()});
 const json=data=>route.fulfill({contentType:"application/json",body:JSON.stringify(data)}).catch(()=>{});
 if(p==="/api/agents")return json({selectedId:"local",agents:[{id:"local",kind:"local",host:"fixture",name:"测试电脑"},{id:"laptop",kind:"remote",host:"100.64.0.2",port:43128,name:"测试笔记本"}]});
 if(p.endsWith("/events")){await new Promise(r=>events.push(r));return route.abort().catch(()=>{});}
 if(p.endsWith("/updates"))return json({supported:false,automatic:false});
 if(p.endsWith("/status")||p.endsWith("/connect"))return json({connected,existingCodexWritable:true,chat:{sendText:capable}});
 if(p.endsWith("/projects"))return json({data:{projects:[{projectId:"local-project",kind:"local",label:"Codex project"}]}});
 if(p.endsWith("/usage"))return json({status:"unknown",weekly:[]});
 if(p.endsWith("/models"))return json({models:[{id:"codex-fixture",efforts:["low"],description:"Codex fixture"}]});
 if(p.endsWith("/threads"))return json({data:{threads:[{id:cid,kind:"chatgpt",title:"Chat fixture",status:runtime},{id:xid,kind:"codex",title:"Codex fixture",status:"idle"}]}});
 if(p.endsWith("/messages")){
   const body=req.postDataJSON();reply=body.prompt;history[0].items.push({id:"response-"+history[0].items.length,type:"agentMessage",text:reply});
   return json({status:"accepted",result:{threadId:cid}});
 }
 if(p.endsWith("/threads/"+cid)){
   const result={source:"official-desktop-chat-history + renderer-status-poll (fixture)",observedAt:new Date().toISOString(),data:{thread:{id:cid,kind:"chatgpt",title:"Chat fixture",status:{type:runtime}},turns:structuredClone(history)}};
   if(delay)await new Promise(r=>setTimeout(r,delay)); return json(result);
 }
 if(p.endsWith("/threads/"+xid))return json({data:{thread:{id:xid,kind:"codex",title:"Codex fixture",status:{type:"idle"}},turns:[{id:"codex-turn",status:"completed",items:[{id:"codex-msg",type:"agentMessage",text:"Codex fixture reply"}]}]}});
 if(p.endsWith("/queue"))return json({confirmed:true,messages:[],recoveries:[]});
 return json({});
});
const choose=async mode=>{await page.locator("#mode-picker").click();await page.locator('[data-mode="'+mode+'"]').click();await page.waitForFunction(m=>document.body.dataset.mode===m&&document.querySelector('#connection').textContent==='已连接官方桌面',mode);};
const waitText=async text=>page.waitForFunction(t=>document.querySelector('#messages').textContent.includes(t),text);
try{
 await page.goto(address);
 await page.locator('[data-thread-id="'+xid+'"]').waitFor();
 assert.equal(await page.locator('[data-thread-id="'+cid+'"]').count(),0);
 await page.locator('#prompt').fill('Codex new draft');
 await choose('chat');
 await page.locator('[data-thread-id="'+cid+'"]').waitFor();
 assert.equal(await page.locator('[data-thread-id="'+xid+'"]').count(),0);
 assert.equal(await page.locator('#prompt').isDisabled(),true);
 await page.locator('#create').click();
 assert.ok((await page.locator('#empty-description').textContent()).includes('官方桌面新建'));
 assert.ok(!calls.some(c=>c.method==='POST'&&c.path.endsWith('/threads')));
 await page.locator('[data-thread-id="'+cid+'"]').click();await waitText('Chat fixture reply');
 assert.equal(await page.locator('#model-display').textContent(),'官方 Chat 模型');
 assert.equal(await page.locator('#model-display').isDisabled(),true);
 assert.equal(await page.locator('#permission-display').isVisible(),false);
 assert.equal(await page.locator('#image').isDisabled(),true);
 assert.ok(!(await page.locator('.turn-divider').innerText()).includes('已完成'));
 await page.locator('#prompt').fill('Chat unsent draft');
 await choose('codex');assert.equal(await page.locator('#prompt').inputValue(),'Codex new draft');
 await choose('chat');await waitText('Chat fixture reply');assert.equal(await page.locator('#prompt').inputValue(),'Chat unsent draft');
 await page.locator('#send').click();await waitText('Chat unsent draft');
 const sent=calls.filter(c=>c.path.endsWith('/messages'));
 assert.equal(sent.length,1);assert.equal(sent[0].body.mode,'chat');assert.ok(sent[0].path.includes(cid));assert.ok(!sent[0].body.settings);
 assert.equal(await page.locator('#prompt').inputValue(),'');
 reply='Official-side fixture reply';history[0].items.push({id:'outside',type:'agentMessage',text:reply});
 await waitText(reply); // No click: four-second Chat polling must discover it.
 runtime='active';await page.locator('#refresh').click();await page.waitForFunction(()=>!document.querySelector('#activity').hidden);
 await page.locator('#prompt').fill('Running Chat draft');assert.equal(await page.locator('#send').isDisabled(),true);
 assert.ok(await page.locator('[data-thread-id="'+cid+'"] .thread-spinner').count());
 runtime='idle';capable=false;await page.locator('#refresh').click();await page.waitForFunction(()=>document.querySelector('#prompt').disabled);
 capable=true;await page.locator('#refresh').click();await page.waitForFunction(()=>!document.querySelector('#prompt').disabled);
 await page.locator('#open').click();
 assert.ok(!calls.some(c=>c.path.includes('/threads/'+cid+'/follow')||c.path.includes('/threads/'+cid+'/queue')));
 delay=600;await page.locator('#refresh').click();await choose('codex');await page.locator('[data-thread-id="'+xid+'"]').click();await waitText('Codex fixture reply');
 await page.waitForTimeout(800);assert.ok(!(await page.locator('#messages').innerText()).includes('Chat fixture reply'));delay=0;
 await choose('chat');await waitText('Chat unsent draft');
 await page.screenshot({path:path.join(dir,'desktop-chat.png')});
 await page.locator('#prompt').fill('Saved Chat draft');
 await page.evaluate(()=>window.remoteCodexSaveDrafts());await page.reload();await waitText('Chat unsent draft');
 assert.equal(await page.locator('#mode-name').textContent(),'Chat');assert.equal(await page.locator('#prompt').inputValue(),'Saved Chat draft');
 // Switch devices while preserving mode; task drafts on distinct hosts isolate.
 await page.locator('#footer-agent').click();await page.locator('#agents button').filter({hasText:'测试笔记本'}).click();
 await page.locator('[data-thread-id="'+cid+'"]').click();await waitText('Chat unsent draft');
 assert.equal(await page.locator('#prompt').inputValue(),'');
 await page.setViewportSize({width:390,height:844});
 await page.waitForFunction(()=>document.body.classList.contains('mobile-layout') && !document.body.classList.contains('drawer-open') && document.querySelector('#sidebar').inert);
 await page.locator('#sidebar').waitFor({state:'hidden'});
 assert.equal(await page.locator('#sidebar').isVisible(),false); // portrait drawer starts hidden
 await page.locator('#mobile-menu').click();await page.locator('#mode-picker').click();
 const box=await page.locator('#mode-menu').boundingBox();assert.ok(box.x>=0&&box.x+box.width<=390);
 await page.screenshot({path:path.join(dir,'mobile-chat.png')});
 await page.locator('[data-mode="codex"]').click();await page.waitForFunction(()=>document.body.dataset.mode==='codex');
 assert.deepEqual(errors,[]);
 fs.writeFileSync(path.join(dir,'result.json'),JSON.stringify({passed:true,checks:['separate lists','draft isolation','Chat text route','polling','active queue blocked','late read isolation','old agent capabilities','update recovery','device switching','mobile dropdown'],errors},null,2));
 console.log('Chat mode UI checks passed');
}finally{for(const release of events)release();await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
