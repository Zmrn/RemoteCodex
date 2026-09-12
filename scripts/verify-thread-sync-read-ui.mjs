// Real shared UI + HTTP + read-only official-index projection + rollout parser.
// All official endpoints, account data and task records are isolated fixtures.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {Bridge,ROOT} from '../src/bridge.mjs';
import {startServer} from '../src/server.mjs';
import {markOfficialReportRead} from '../src/official-report-read.mjs';
import {OFFICIAL,TOOLS} from '../src/official-protocol.mjs';
import {PYTHON} from '../src/runtime.mjs';
import {fixtureEvidence} from '../test/fixtures/interface-evidence.mjs';
const {chromium}=await import(process.env.REMOTE_BRIDGE_PLAYWRIGHT||'playwright-core');
fs.mkdirSync(path.join(ROOT,'work'),{recursive:true});
const dir=fs.mkdtempSync(path.join(ROOT,'work/thread-sync-read-ui-')),home=path.join(dir,'official');fs.mkdirSync(home);
fs.writeFileSync(path.join(dir,'update-settings.json'),'{"automatic":false}');
const id='99999999-9999-4999-8999-999999999999',child='88888888-8888-4888-8888-888888888888',pid='77777777-7777-4777-8777-777777777777',turn='66666666-6666-4666-8666-666666666666',owner='fixture-owner';
const text='任务已创建。\n\n::created-thread{threadId="'+child+'"}';
const reply={id:'report',type:'agentMessage',text};
const raw=[{type:'session_meta',payload:{id}},
 {type:'event_msg',payload:{type:'task_started',turn_id:turn}},
 {type:'event_msg',timestamp:'2026-09-12T05:00:00Z',payload:{type:'item_completed',thread_id:id,turn_id:turn,item:{type:'AgentMessage',id:'report',content:[{type:'Text',text}]}}}];
// Put the latest reply on an older transport page, behind long command history.
for(let n=0;n<65;n++)raw.push({type:'event_msg',payload:{type:'item_completed',thread_id:id,turn_id:turn,item:{type:'CommandExecution',id:'command-'+n,command:['fixture'],aggregated_output:'Recorded output',status:'completed'}}});
const sessions=path.join(home,'sessions','2026','09','12');fs.mkdirSync(sessions,{recursive:true});
fs.writeFileSync(path.join(sessions,'rollout-2026-09-12T05-00-00-'+id+'.jsonl'),raw.map(r=>JSON.stringify(r)+'\n').join(''));
fs.writeFileSync(path.join(home,'.codex-global-state.json'),JSON.stringify({'thread-project-assignments':{[child]:{projectKind:'local',projectId:pid}}}));
execFileSync(PYTHON,['-c','import sqlite3,sys;d=sqlite3.connect(sys.argv[1]);d.executescript(sys.stdin.read());d.close()',path.join(home,'state_5.sqlite')],{
 windowsHide:true,input:`CREATE TABLE threads(id TEXT,name TEXT,title TEXT,preview TEXT,cwd TEXT,updated_at INTEGER,source TEXT,is_pinned INTEGER,archived INTEGER);
 INSERT INTO threads VALUES('${child}','Official new review task','','','C:/fixture',10,'vscode',0,0);`});
const bridge=new Bridge(dir),checks=[],errors=[];let unread=true,sends=0,historyReads=0;
bridge.connected=true;
const parent={id,kind:'codex',hostId:'local',projectId:pid,title:'Parent fixture',status:'idle',cwd:'C:/fixture',updatedAt:1};
const childRow={...parent,id:child,title:'Official new review task'};
const state=target=>({id:target,hasUnreadTurn:target===id&&unread,threadRuntimeStatus:{type:'idle'},turns:[{turnId:turn,turnStartedAtMs:1000,status:'completed',items:target===id?[reply]:[{id:'child-reply',type:'agentMessage',text:'CHILD_CONTENT'}]}]});
bridge.desktop={identity:{officialPid:1},catalog:[],owner:async()=>({handledByClientId:owner}),
 call:async(method,args)=>{
  if(method===TOOLS.listThreads)return{threads:[parent],pinnedThreads:[]};
  if(method===TOOLS.readThread){historyReads++;if(args.threadId===id)throw Error('native pipe message exceeds frame limit');return{thread:{...childRow,status:{type:'idle'}},turns:[{id:turn,startedAt:1,status:'completed',items:state(child).turns[0].items}],page:{nextCursor:null}};}
  throw Error('Unexpected fixture tool '+method);
 },ipc:{broadcast(method,p){assert.equal(method,OFFICIAL.ipc.readStateChanged.method);assert.equal(p.conversationId,id);sends++;unread=false;}}};
fixtureEvidence(bridge.desktop);
bridge.officialStorage={desktop:bridge.desktop,identity:bridge.desktop.identity,home};
bridge.projects=async()=>({data:{projects:[{projectId:pid,label:'Official project',path:'C:/fixture',type:'local'}]}});
bridge.models=async()=>({models:[]});bridge.usage=async()=>({status:'unavailable',weekly:[]});
bridge.connect=async()=>bridge.desktop.identity;
bridge.follow=async target=>{bridge.live.set(target,{owner,state:state(target)});return{handledByClientId:owner};};
bridge.queue.read=()=>({confirmed:true,revision:'1',messages:[],recoveries:[]});
bridge.disconnect=()=>{bridge.connected=false;};
bridge.taskReports.stateFactory=()=>({supported:()=>true,connect:async()=>{},close(){},read:async target=>({running:false,unread:target===id&&unread,runtimeKnown:true,readStateKnown:true,unknown:false,stateSource:'official-owner-snapshot'})});
const reader={supported:()=>true,context:async()=>({identity:{kind:'chatgpt',accountId:'fixture',userId:'fixture'},executionHostKey:'local'}),marked:async()=>unread};
bridge.markOfficialReportRead=(target,token)=>markOfficialReportRead(bridge,target,token,{reader,sleep:async()=>{},attempts:1,snapshotAttempts:1});
const app=await startServer({port:0,bridge});
const browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
try{
 for(const width of [1300,390]){
  unread=true;sends=historyReads=0;
  const context=await browser.newContext({viewport:{width,height:860}}),page=await context.newPage();
  page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>{window.fixtureFocus=false;Object.defineProperty(document,'hasFocus',{value:()=>window.fixtureFocus});});
  await page.goto(app.address+'/?thread='+id);
  try { await page.waitForFunction(()=>document.querySelector('#messages')?.children.length>0); }
  catch(e) { fs.writeFileSync(path.join(dir,'failure-body.txt'),await page.locator('body').innerText()); await page.screenshot({path:path.join(dir,'failure.png')}); console.error(dir,errors);throw e; }
  await page.waitForFunction(child=>!!document.querySelector('[data-thread-id="'+child+'"]'),child);
  assert.equal(await page.locator('[data-thread-id="'+child+'"] strong').first().textContent(),childRow.title);
  await page.locator('[data-thread-id="'+id+'"] .thread-dot.unread').waitFor({state:'attached'});
  for(let i=0;i<8 && !await page.locator('[data-item-id="report"]').count();i++){
   if(!await page.locator('#older').isVisible()) break;
   const previous=await page.locator('#messages').innerHTML();
   await Promise.all([page.waitForResponse(r=>r.request().method()==='GET' && r.url().includes('/threads/'+id+'?') && new URL(r.url()).searchParams.has('before')),page.locator('#older').click()]);
   await page.waitForFunction(previous=>document.querySelector('#messages').innerHTML!==previous,previous);
  }
  if(!await page.locator('[data-item-id="report"]').count()){
    const first=await bridge.readPage(id),second=await bridge.readPage(id,first.data.page.nextCursor);
    const project=r=>({receipt:r.reportReceipt,current:r.currentReportToken,turns:r.data.turns.map(t=>({id:t.id,partial:t.bridgePartial,ids:t.bridgeItemIds,items:t.items.map(i=>({id:i.id,type:i.type,text:i.text}))}))});
    fs.writeFileSync(path.join(dir,'missing-report.json'),JSON.stringify({first:project(first),second:project(second),body:await page.locator('body').innerText()},null,2));console.error(dir);throw Error('Latest reply missing from paged fixture');
  }
  await page.locator('.created-thread-link').waitFor();
  // A head refresh must not discard the latest receipt obtained on an older page.
  const [refreshed]=await Promise.all([page.waitForResponse(r=>r.request().method()==='GET' && r.url().includes('/threads/'+id+'?') && !new URL(r.url()).searchParams.has('before')),
    page.locator('#refresh').evaluate(b=>b.click())]);
  const head=await refreshed.json();assert.equal(head.reportReceipt,null);assert.ok(head.currentReportToken);
  await page.evaluate(()=>new Promise(requestAnimationFrame));
  await page.evaluate(()=>{const s=document.querySelector('#message-scroll'),b=document.querySelector('[data-item-id="report"] .message-body');s.scrollTop+=b.getBoundingClientRect().bottom-s.getBoundingClientRect().top-180;window.fixtureFocus=true;window.dispatchEvent(new Event('focus'));s.dispatchEvent(new Event('scroll'));});
  await page.waitForFunction(id=>document.querySelector('[data-thread-id="'+id+'"]')?.title.includes('官方已读状态'),id,{timeout:15000});
  assert.equal(sends,1);assert.ok(historyReads<=2,'read receipt must not read oversized whole history again');
  await page.screenshot({path:path.join(dir,'sync-'+width+'.png'),fullPage:true});
  const href=page.locator('.created-thread-link');
  await href.click();await page.locator('[data-item-id="child-reply"]').waitFor();
  assert.match(await page.locator('#messages').textContent(),/CHILD_CONTENT/);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  checks.push(width+': official index supplements missing project task; paged latest reply clears via fresh owner without whole history; created-thread link opens exact task');
  await context.close();
 }
 // A directive inside code remains literal, with no navigation handler.
 const p=await browser.newPage();await p.goto(app.address);
 const literal=await p.evaluate(async()=>{const {markdown}=await import('/markdown.mjs');return markdown('```\n::created-thread{threadId="88888888-8888-4888-8888-888888888888"}\n```',{openThread(){}}).querySelectorAll('.created-thread-link').length;});
 assert.equal(literal,0);await p.close();checks.push('code examples remain inert');
 assert.deepEqual(errors,[]);assert.ok(!fs.existsSync(path.join(dir,'task-receipts.json')));
 const result={result:'PASS',checks,errors,officialTaskWrites:0,apkExecuted:false,directory:dir};
 fs.writeFileSync(path.join(dir,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}finally{await browser.close();app.server.closeAllConnections();await new Promise(r=>app.server.close(r));}
