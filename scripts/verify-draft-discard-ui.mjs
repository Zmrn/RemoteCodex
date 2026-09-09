// Production UI, persistence and queue cleanup; all official operations are fixtures.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { Bridge, ROOT } from '../src/bridge.mjs';
import { OfficialQueue, composeQueuedMessage } from '../src/queue.mjs';
import { startServer } from '../src/server.mjs';
const {chromium}=await import(process.env.REMOTE_BRIDGE_PLAYWRIGHT || 'playwright-core');
const dir=fs.mkdtempSync(path.join(ROOT,'work/draft-discard-ui-'));
fs.writeFileSync(path.join(dir,'update-settings.json'),'{"automatic":false}');
const id='77777777-7777-4777-8777-777777777777', second='88888888-8888-4888-8888-888888888888';
const png='data:image/png;base64,'+fs.readFileSync(path.join(ROOT,'fixtures/vision-probe.png')).toString('base64');
const b=new Bridge(dir), owner='fixture-owner', actions=[];
b.connect=async()=>{b.connected=true;};b.connected=true;b.disconnect=()=>{};
b.owners=new Map([[id,owner]]);b.watching.add(id);
b.follow=async()=>({handledByClientId:owner});
b.codexThread=async()=>({thread:{id,kind:'codex',cwd:'C:/Fixture',status:{type:'active'}}});
const file=path.join(dir,'official-fixture.json');
fs.writeFileSync(file,JSON.stringify({'queued-follow-ups':{[id]:[composeQueuedMessage('take-me','取回后删除的文字','C:/Fixture',[png,png]),composeQueuedMessage('keep-me','保留的官方排队消息','C:/Fixture')]}}));
const q=b.queue=new OfficialQueue(b,file);
b.desktop={identity:{appToolsPipe:{image:'OpenAI.Codex_26.903.8094.0_x64__fixture'}},ipc:{request:async(method,params)=>{
  actions.push(method);assert.equal(method,'thread-follower-set-queued-follow-ups-state');
  q.frame({type:'broadcast',method:'thread-queued-followups-changed',sourceClientId:owner,params:{conversationId:id,messages:params.state[id]}});
  return {handledByClientId:owner,result:{ok:true}};
}}};
const addBackup=(key,threadId=id)=>{b.db.queueRecoveries??={};b.db.queueRecoveries[key]={threadId,state:'draft',message:composeQueuedMessage(key,'遗留恢复记录 '+key,'C:/Fixture')};b.save();};
const {server,address}=await startServer({port:0,bridge:b});
const browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
const page=await browser.newPage({viewport:{width:390,height:844}}),errors=[],events=[],clears=[];
let failure=null,stale=null;
page.on('pageerror',e=>errors.push(e.message));
await page.route(address+'/api/**',async route=>{
  const req=route.request(),p=new URL(req.url()).pathname,u=new URL(req.url()),other=p.includes('/other/');
  const json=(data,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(data)}).catch(()=>{});
  if(p==='/api/agents')return json({selectedId:'local',agents:[{id:'local',kind:'local',name:'测试电脑'},{id:'other',kind:'remote',name:'另一台电脑',host:'100.64.0.2',port:43128}]});
  if(p.endsWith('/events')){await new Promise(r=>events.push(r));return route.abort().catch(()=>{});}
  if(p.endsWith('/status')||p.endsWith('/connect'))return json({connected:true,existingCodexWritable:true,multiImageInput:true,interrupt:{supported:true}});
  if(p.endsWith('/projects'))return json({data:{projects:[]}});
  if(p.endsWith('/threads'))return json({data:{threads:[{id,kind:'codex',title:'草稿清理测试',status:'active'},{id:second,kind:'codex',title:'另一个任务',status:'active'}]}});
  if(p.endsWith('/threads/'+id)||p.endsWith('/threads/'+second))return json({data:{thread:{id:p.endsWith(second)?second:id,kind:'codex',title:'草稿清理测试',status:{type:'active'},cwd:'C:/Fixture'},turns:[]}});
  if(p.endsWith('/queue')){
    const task=p.includes('/threads/'+second+'/')?second:id;
    if(req.method()==='POST'){
      const body=req.postDataJSON();
      if(body.action==='ack-recovery'){
        clears.push({agent:other?'other':'local',task,recoveryId:body.recoveryId});
        assert.equal(other,false);
        if(failure==='offline')return json({error:'fixture offline'},503);
      }
      const result=await q.mutate(task,body.requestId,body);
      if(body.action==='ack-recovery' && failure==='lost'){failure=null;return route.abort();}
      return json(result);
    }
    if(other)return json({revision:'other',messages:[],recoveries:[{recoveryId:'offline',state:'draft',draft:{text:'另一台设备保留的同ID草稿',editable:true}}]});
    if(u.searchParams.has('recoveryId'))return json(q.recovery(task,u.searchParams.get('recoveryId')));
    return json(stale ?? q.read(task,true,true));
  }
  if(p.endsWith('/media'))return route.continue();
  return json({});
});
const saved=()=>page.evaluate(async()=>{const r=await import('/update-recovery.mjs');return r.readRecovery();});
const waitSaved=async predicate=>{const until=Date.now()+30000;while(Date.now()<until){if(predicate(await saved()))return;await new Promise(r=>setTimeout(r,100));}throw Error('Persisted recovery condition timed out');};
const chooseThread=async thread=>{if(!await page.locator('#sidebar').isVisible())await page.locator('#mobile-menu').click();await page.locator(`[data-thread-id="${thread}"]`).click();};
const refresh=async()=>{if(!await page.locator('#sidebar').isVisible())await page.locator('#mobile-menu').click();await page.locator('#refresh').click();if(await page.locator('#drawer-close').isVisible())await page.locator('#drawer-close').click();};
const absent=()=>page.waitForFunction(()=>document.querySelectorAll('.queue-recovery').length===0);
try{
  await page.goto(address+'/?thread='+id);
  await page.locator('[data-message-id="take-me"] .queue-more summary').click();
  await page.locator('[data-message-id="take-me"] .queue-edit').click();
  await page.waitForFunction(()=>document.querySelector('#prompt').value==='取回后删除的文字'&&document.querySelectorAll('#attachment img').length===2);
  const recoveryId=Object.keys(b.db.queueRecoveries)[0];assert.ok(recoveryId);
  await chooseThread(second);assert.ok(b.db.queueRecoveries[recoveryId]);
  await chooseThread(id);assert.equal(await page.locator('#prompt').inputValue(),'取回后删除的文字');
  await page.locator('#prompt').fill('');assert.ok(b.db.queueRecoveries[recoveryId]);
  await page.locator('[aria-label="移除图片 1"]').click();assert.ok(b.db.queueRecoveries[recoveryId]);
  await page.locator('[aria-label="移除图片 1"]').click();
  await waitSaved(s=>s?.discardedRecoveries?.some(r=>r.recoveryId===recoveryId&&r.cleared));
  assert.ok(!b.db.queueRecoveries[recoveryId]);assert.deepEqual(q.read(id).messages.map(m=>m.id),['keep-me']);
  await page.reload();await page.locator('[data-message-id="keep-me"]').waitFor();await absent();
  assert.equal(await page.locator('#prompt').inputValue(),'');assert.equal(await page.locator('#attachment img').count(),0);
  addBackup('text-only');await refresh();await page.locator('[data-recovery-id="text-only"] button').first().click();
  await page.waitForFunction(()=>document.querySelector('#prompt').value==='遗留恢复记录 text-only');
  await page.locator('#prompt').fill('');await absent();
  await waitSaved(s=>s?.discardedRecoveries?.some(r=>r.recoveryId==='text-only'&&r.cleared));
  assert.ok(!b.db.queueRecoveries['text-only']);
  addBackup('legacy');await refresh();await page.locator('[data-recovery-id="legacy"]').waitFor();
  await page.locator('#prompt').fill('刚输入的新草稿');
  await page.locator('[data-recovery-id="legacy"] .queue-discard').click();await absent();
  assert.equal(await page.locator('#prompt').inputValue(),'刚输入的新草稿');
  addBackup('offline');failure='offline';await refresh();await page.locator('[data-recovery-id="offline"]').waitFor();
  stale=q.read(id,true,true);
  await page.locator('[data-recovery-id="offline"] .queue-discard').click();await absent();
  await waitSaved(s=>s?.discardedRecoveries?.some(r=>r.recoveryId==='offline'));
  assert.ok(b.db.queueRecoveries.offline);
  await page.reload();await page.locator('[data-message-id="keep-me"]').waitFor();await absent();
  failure=null;stale=null;
  await waitSaved(s=>s?.discardedRecoveries?.some(r=>r.recoveryId==='offline'&&r.cleared));
  assert.ok(!b.db.queueRecoveries.offline);await absent();
  addBackup('lost');await refresh();await page.locator('[data-recovery-id="lost"]').waitFor();
  failure='lost';await page.locator('[data-recovery-id="lost"] .queue-discard').click();await absent();
  await page.reload();await waitSaved(s=>s?.discardedRecoveries?.some(r=>r.recoveryId==='lost'&&r.cleared));
  assert.ok(!new Bridge(dir).db.queueRecoveries.lost);
  if(!await page.locator('#sidebar').isVisible())await page.locator('#mobile-menu').click();
  await page.locator('#footer-agent').click();await page.locator('#agents button').filter({hasText:'另一台电脑'}).click();await chooseThread(id);
  await page.locator('[data-recovery-id="offline"]').waitFor();assert.equal(clears.some(r=>r.agent==='other'),false);
  for(const [width,height] of [[390,844],[844,390],[320,568]]){
    await page.setViewportSize({width,height});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    await page.screenshot({path:path.join(dir,`draft-${width}.png`)});
  }
  assert.equal(actions.length,1,'only fixture take writes official queue; all discards are local');
  assert.deepEqual(errors,[]);
  const report={passed:true,checks:['take retains all original images','navigation keeps recovery','text clear with images retains recovery','last image clear removes backup','reload retains deletion','text-only clear removes backup','legacy delete preserves current draft','offline intent persists','stale GET cannot resurrect','lost acknowledgement retries only local cleanup','same ID on other device remains','restart disk and IDB checked','mobile portrait landscape bounds'],officialFixtureWrites:actions.length,realOfficialWrites:0,errors};
  fs.writeFileSync(path.join(dir,'result.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({...report,dir},null,2));
}catch(e){console.log(JSON.stringify({errors,clears,remaining:Object.keys(b.db.queueRecoveries??{}),discarded:(await saved())?.discardedRecoveries,body:(await page.locator('body').innerText()).slice(-4000)}));throw e;}
finally{events.forEach(r=>r());await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
