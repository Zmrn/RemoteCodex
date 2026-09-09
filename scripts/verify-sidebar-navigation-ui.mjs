// Production UI with isolated HTTP fixtures; no official task or device writes.
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';
import { ROOT } from '../src/bridge.mjs';
const { chromium } = await import(process.env.REMOTE_BRIDGE_PLAYWRIGHT || 'playwright-core');
const agents=['11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222'];
const codex='33333333-3333-4333-8333-333333333333',chat='44444444-4444-4444-8444-444444444444';
const checks=[],errors=[],receipts=[],writes=[],streams=new Set();let failAgent='',connectDelay=0,readDelay=0,revision=1;
const server=http.createServer(async(req,res)=>{
  const url=new URL(req.url,'http://fixture'),p=url.pathname;
  const json=(value,code=200)=>{if(res.destroyed)return;res.writeHead(code,{'content-type':'application/json'});res.end(JSON.stringify(value));};
  if(!p.startsWith('/api/')){
    const file=p==='/'?'index.html':p.slice(1);if(!/^[\w.-]+$/.test(file)){res.writeHead(404);return res.end();}
    const target=path.join(ROOT,'public',file);if(!fs.existsSync(target)){res.writeHead(404);return res.end();}
    res.setHeader('content-type',({'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.svg':'image/svg+xml'})[path.extname(file)]||'application/octet-stream');
    return res.end(fs.readFileSync(target,'utf8').replace('__BRIDGE_CSRF__','fixture-only').replace('__BRIDGE_VERSION__','fixture').replace('<head>','<head><meta name="bridge-platform" content="android">'));
  }
  let body='';for await(const part of req)body+=part;
  if(p==='/api/agents')return json({selectedId:agents[0],agents:agents.map((id,i)=>({id,kind:'remote',name:'Fixture device '+i,host:'100.70.0.'+(i+1),port:43128,hasKey:true}))});
  if(p==='/api/agents/select')return json({selectedId:JSON.parse(body).id});
  if(p==='/api/device-connections')return json({enabled:true,running:true,devices:2,connected:2});
  if(p.endsWith('/updates'))return json({supported:false});
  if(p==='/api/updates/activity')return json({});
  const agent=/\/agents\/([^/]+)/.exec(p)?.[1];
  if(p.endsWith('/status')||p.endsWith('/connect')){
    if(connectDelay)await new Promise(r=>setTimeout(r,connectDelay));
    if(agent===failAgent)return json({error:'fixture offline'},503);
    return json({connected:true,existingCodexWritable:true,chat:{sendText:true},taskSummary:{readReceipts:true}});
  }
  if(p.endsWith('/events')){res.writeHead(200,{'content-type':'text/event-stream'});res.write(': fixture\n\n');streams.add(res);res.on('close',()=>streams.delete(res));return;}
  if(p.endsWith('/projects'))return json({data:{projects:[]}});
  if(p.endsWith('/usage'))return json({status:'unknown',weekly:[]});
  if(p.endsWith('/models'))return json({models:[]});
  if(p.endsWith('/queue'))return json({confirmed:true,messages:[],recoveries:[]});
  if(p.endsWith('/follow'))return json({});
  if(p.endsWith('/read-receipt')){receipts.push({agent,body:JSON.parse(body)});return json({accepted:true});}
  if(p.endsWith('/threads'))return json({data:{threads:[{id:codex,kind:'codex',title:'Codex fixture',status:'idle'},{id:chat,kind:'chatgpt',title:'Chat fixture',status:'idle'}]}});
  const id=[codex,chat].find(id=>p.endsWith('/threads/'+id));
  if(id){const version=revision;if(readDelay)await new Promise(r=>setTimeout(r,readDelay));return json({reportReceipt:{token:String(version).padStart(64,'0'),itemId:'reply'},data:{thread:{id,kind:id===chat?'chatgpt':'codex',title:id===chat?'Chat fixture':'Codex fixture',status:{type:'idle'}},turns:[{id:'turn',startedAt:version,status:'completed',items:[{id:'reply',type:'agentMessage',text:'Fixture reply '+version}]}],page:{nextCursor:null}}});}
  if(req.method==='POST'&&!p.includes('/drafts'))writes.push(p);
  return json({});
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const address='http://127.0.0.1:'+server.address().port;
const browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
const page=await browser.newPage({viewport:{width:390,height:844}});page.on('pageerror',e=>errors.push(e.message));
await page.addInitScript(()=>Object.defineProperty(document,'hasFocus',{value:()=>true}));
const choose=async mode=>{await page.locator('#mode-picker').click();await page.locator(`[data-mode="${mode}"]`).click();await page.waitForFunction(m=>document.body.dataset.mode===m,mode);};
const switchDevice=async index=>{await page.locator('#footer-agent').click();await page.locator(`[data-agent-id="${agents[index]}"]`).click();};
const loaded=()=>page.waitForFunction(()=>document.querySelector('#connection').textContent==='已连接官方桌面'&&document.querySelectorAll('.thread-card').length>0);
const taskLoaded=id=>page.waitForFunction(id=>document.querySelector(`[data-thread-id="${id}"].selected`)&&document.querySelector('#messages').textContent.includes('Fixture reply'),id);
async function drawer(open){
  assert.equal(await page.locator('body').evaluate(e=>e.classList.contains('drawer-open')),open);
  assert.equal(await page.locator('#sidebar').evaluate(e=>e.inert),!open);
  assert.equal(await page.locator('.conversation').evaluate(e=>e.inert),open);
  assert.equal(await page.locator('#mobile-menu').getAttribute('aria-expanded'),String(open));
}
try{
  await page.goto(address);await loaded();await drawer(false);
  await page.locator('#mobile-menu').click();await choose('chat');await loaded();await drawer(true);
  assert.equal(await page.locator('#mode-menu').evaluate(e=>e.matches(':popover-open')),false);
  checks.push('mobile mode switch without previous task preserves open drawer and dismisses only its menu');
  await page.locator(`[data-thread-id="${chat}"]`).click();await taskLoaded(chat);await drawer(false);await page.locator('#prompt').fill('Chat draft');
  await page.locator('#mobile-menu').click();await choose('codex');await loaded();await drawer(true);
  await page.locator(`[data-thread-id="${codex}"]`).click();await taskLoaded(codex);await drawer(false);await page.locator('#prompt').fill('Codex draft');
  revision=2;const before=receipts.length;
  await page.locator('#mobile-menu').click();await choose('chat');await taskLoaded(chat);await page.waitForTimeout(1000);await drawer(true);
  assert.equal(await page.locator('#prompt').inputValue(),'Chat draft');assert.equal(receipts.length,before,'obscured restored reply must not be acknowledged');
  checks.push('restoring a task during mode switch retains drawer and its draft without acknowledging obscured content');
  await page.locator('#drawer-close').click();await drawer(false);
  const receiptDeadline=Date.now()+5000;while(receipts.length===before&&Date.now()<receiptDeadline)await new Promise(r=>setTimeout(r,50));assert.equal(receipts.length,before+1);
  await page.locator('#mobile-menu').click();await choose('codex');await taskLoaded(codex);await drawer(true);assert.equal(await page.locator('#prompt').inputValue(),'Codex draft');
  await switchDevice(1);await loaded();await drawer(true);assert.equal(await page.locator('#agent-menu').isVisible(),false);
  checks.push('device switching keeps sidebar available and closes only the device menu');
  await page.locator(`[data-thread-id="${codex}"]`).click();await taskLoaded(codex);await drawer(false);assert.equal(await page.locator('#prompt').inputValue(),'');
  await page.locator('#prompt').fill('Second device draft');await page.locator('#mobile-menu').click();await switchDevice(0);await loaded();await drawer(true);
  failAgent=agents[1];await switchDevice(1);await page.waitForFunction(()=>document.querySelector('#error').textContent.includes('fixture offline'));await drawer(true);
  failAgent='';await page.locator('#refresh').click();await loaded();await drawer(true);checks.push('device failure and reconnect preserve drawer and allow another choice');
  await page.locator(`[data-thread-id="${codex}"]`).click();await taskLoaded(codex);await page.locator('#mobile-menu').click();
  await choose('chat');await loaded();readDelay=900;await choose('codex');await page.locator('#drawer-close').click();await taskLoaded(codex);await drawer(false);readDelay=0;
  assert.equal(await page.locator('#prompt').inputValue(),'Second device draft');checks.push('late task restoration respects a manual sidebar close');
  await page.locator('#mobile-menu').click();connectDelay=900;await switchDevice(0);await page.locator('#drawer-close').click();await loaded();await drawer(false);connectDelay=0;
  checks.push('late device connection never reopens a manually closed drawer');
  await page.locator('#mobile-menu').click();await page.locator('#drawer-backdrop').click({position:{x:385,y:400}});await drawer(false);
  await page.locator('#mobile-menu').click();await page.keyboard.press('Escape');await drawer(false);
  await page.locator('#mobile-menu').click();await page.locator('#create').click();await drawer(false);checks.push('task/new-chat selection and explicit close/backdrop/Escape still dismiss the drawer');
  await page.locator('#mobile-menu').click();await page.evaluate(d=>window.remoteCodexOpenTask(d),{agent:agents[0],thread:codex,mode:'codex'});await taskLoaded(codex);await drawer(false);
  checks.push('widget deep link still opens the task and dismisses the sidebar');
  await page.setViewportSize({width:844,height:390});await page.waitForFunction(()=>!document.body.classList.contains('mobile-layout'));await choose('chat');await loaded();assert.equal(await page.locator('#sidebar').isVisible(),true);
  await switchDevice(1);await loaded();assert.equal(await page.locator('#sidebar').isVisible(),true);checks.push('landscape desktop layout remains visible across modes and devices');
  await page.setViewportSize({width:390,height:844});await page.waitForFunction(()=>document.body.classList.contains('mobile-layout'));await page.locator('#mobile-menu').click();await choose('codex');await loaded();await drawer(true);
  fs.mkdirSync(path.join(ROOT,'evidence'),{recursive:true});await page.screenshot({path:path.join(ROOT,'evidence/sidebar-navigation.png')});
  assert.deepEqual(errors,[]);assert.deepEqual(writes,[]);
  const report={result:'PASS',checks,errors,officialTaskWrites:0,apkBehaviorTested:false};fs.writeFileSync(path.join(ROOT,'evidence/sidebar-navigation.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}finally{await browser.close();for(const s of streams)s.destroy();server.closeAllConnections();await new Promise(r=>server.close(r));}
