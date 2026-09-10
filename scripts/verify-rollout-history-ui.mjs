// Production Bridge/HTTP/shared UI; only synthetic files and an official-tool substitute.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { Bridge, ROOT } from '../src/bridge.mjs';
import { startServer } from '../src/server.mjs';
import { fixtureEvidence } from '../test/fixtures/interface-evidence.mjs';
const {chromium}=await import(process.env.REMOTE_BRIDGE_PLAYWRIGHT||'playwright-core');
const dir=fs.mkdtempSync(path.join(ROOT,'work/rollout-ui-')), home=path.join(dir,'official');
fs.mkdirSync(path.join(home,'sessions'),{recursive:true});
fs.writeFileSync(path.join(dir,'update-settings.json'),'{"automatic":false}');
const id='11111111-2222-4333-8444-555555555555',turn='aaaaaaaa-2222-4333-8444-555555555555';
const thread={id,kind:'codex',hostId:'local',title:'大历史测试',status:'idle'};
const file=path.join(home,'sessions','rollout-2026-09-10T12-00-00-'+id+'.jsonl');
const picture=fs.readFileSync(path.join(ROOT,'fixtures/multi-image-a.png')).toString('base64');
const event=payload=>({type:'event_msg',timestamp:'2026-09-10T12:00:00Z',payload});
const message=n=>event({type:'item_completed',thread_id:id,turn_id:turn,item:{type:'AgentMessage',id:'msg-'+n,content:[{type:'Text',text:'VISIBLE_REPLY_'+n}]}});
const initial=[{type:'session_meta',payload:{id}},...Array.from({length:90},(_,n)=>message(n)),event({type:'item_completed',thread_id:id,turn_id:turn,item:{id:'picture',type:'Extension',kind:'image_gen.generation',result:picture}})].map(x=>JSON.stringify(x)+'\n').join('');
fs.writeFileSync(file,initial);
const bridge=new Bridge(dir), calls=[], errors=[], writes=[], checks=[];
const desktop=fixtureEvidence({identity:{officialPid:1},close(){},call:async(tool,args)=>{
 calls.push({tool,args}); if(tool==='list_threads')return {threads:[thread]};
 if(tool==='read_thread')throw Error('Codex app tool request failed'); throw Error('Unexpected fixture tool');
}});
bridge.desktop=desktop; bridge.connected=true; bridge.officialStorage={desktop,identity:desktop.identity,home};
bridge.connect=async()=>desktop.identity; bridge.follow=async()=>({});
bridge.projects=async()=>({data:{projects:[]}});bridge.models=async()=>({models:[]});bridge.usage=async()=>({status:'unavailable',weekly:[]});
bridge.queue.read=async()=>({confirmed:true,revision:'1',messages:[],recoveries:[]});
bridge.taskReports.summary=async()=>({threads:[],complete:false});
const app=await startServer({port:0,bridge});
const browser=await chromium.launch({headless:true,executablePath:process.env.REMOTE_BRIDGE_BROWSER||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});
try {
 for(const width of [1300,390]) {
  fs.writeFileSync(file,initial); let imageRequests=0;
  const context=await browser.newContext({viewport:{width,height:900}}),page=await context.newPage();
  page.on('pageerror',e=>errors.push(e.message));
  await page.route(app.address+'/api/**',async route=>{
   const req=route.request(),url=new URL(req.url());
   if(req.method()==='POST'&&/\/(messages|read-receipt|interrupt|settings|queue|questions|approvals|title)$/.test(url.pathname)) {writes.push(url.pathname);return route.abort();}
   if(url.pathname.endsWith('/media')&&++imageRequests===1)return route.fulfill({status:503,body:'fixture image failure'});
   return route.continue();
  });
  await page.goto(app.address+'/?thread='+id);
  await page.locator('[data-item-id="msg-89"]').waitFor();
  assert.match(await page.locator('#history-notice').textContent(),/官方原始历史分段/);
  await page.locator('#prompt').fill('KEEP_DRAFT');
  await page.locator('.image-load-state[data-state="error"] button').click();
  await page.waitForFunction(()=>[...document.querySelectorAll('#messages img')].some(i=>i.naturalWidth>0));
  checks.push(width+'px: oversized tool failure recovers text and separate image loading/retry');
  await page.locator('#older').click();
  await page.locator('[data-item-id="msg-20"]').waitFor();
  const before=await page.locator('#messages [data-item-id]').count();
  await page.locator('#refresh').evaluate(e=>e.click());
  await page.waitForFunction(()=>!document.querySelector('#older').disabled);
  assert.equal(await page.locator('#messages [data-item-id]').count(),before);
  assert.equal(await page.locator('[data-item-id="msg-89"]').count(),1);
  checks.push(width+'px: older pages merge with exact IDs/order; refresh retains loaded content');
  fs.appendFileSync(file,'{"type":"event_msg","payload":broken}\n');
  await page.locator('#refresh').evaluate(e=>e.click());
  await page.waitForFunction(()=>document.querySelector('#task-state').textContent.includes('刷新失败，已保留'));
  assert.equal(await page.locator('#messages [data-item-id]').count(),before);
  assert.equal(await page.locator('#prompt').inputValue(),'KEEP_DRAFT');
  fs.writeFileSync(file,[{type:'session_meta',payload:{id}},message(999)].map(x=>JSON.stringify(x)+'\n').join(''));
  await page.locator('#refresh').evaluate(e=>e.click());
  await page.locator('[data-item-id="msg-999"]').waitFor();
  assert.equal(await page.locator('[data-item-id="msg-89"]').count(),0);
  assert.equal(await page.locator('#prompt').inputValue(),'KEEP_DRAFT');
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  checks.push(width+'px: failed refresh keeps text/draft; official revision replaces stale content');
  await context.close();
 }
 assert.deepEqual(errors,[]);assert.deepEqual(writes,[]);
 const result={result:'PASS',checks,errors,officialTaskWrites:0,readReceiptWrites:0,apkExecuted:false};
 fs.writeFileSync(path.join(dir,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify({...result,evidence:dir}));
} finally {await browser.close();bridge.disconnect();app.server.closeAllConnections();await new Promise(r=>app.server.close(r));}
