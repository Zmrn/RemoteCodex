// Shared production page, synthetic API/media only; never operates an APK/task.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {startServer} from '../src/server.mjs';
import {ROOT} from '../src/bridge.mjs';
const {chromium}=await import(process.env.REMOTE_BRIDGE_PLAYWRIGHT||'playwright-core');
fs.mkdirSync(path.join(ROOT,'work'),{recursive:true});
const dir=fs.mkdtempSync(path.join(ROOT,'work/image-stability-ui-'));
fs.writeFileSync(path.join(dir,'update-settings.json'),'{"automatic":false}');
const app=await startServer({port:0,bridge:{dataDir:dir,on(){},off(){},async connect(){},disconnect(){}}});
const browser=await chromium.launch({executablePath:process.env.REMOTE_BRIDGE_BROWSER||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
const id='aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee', bytes=fs.readFileSync(path.join(ROOT,'fixtures/multi-image-a.png')),checks=[],errors=[];
try {
 for(const width of [1300,390]) {
  const page=await browser.newPage({viewport:{width,height:1100}});
  await page.addInitScript(()=>{
    window.fixtureRevoked=[];
    const revoke=URL.revokeObjectURL.bind(URL);
    URL.revokeObjectURL=url=>{window.fixtureRevoked.push(url);revoke(url);};
    const fetch=window.fetch.bind(window),streams=new Set();
    window.fixtureEvent=event=>{for(const stream of streams)stream.enqueue(new TextEncoder().encode('data: '+JSON.stringify(event)+'\n\n'));};
    window.fetch=(url,options)=>{
      if(!String(url).endsWith('/events'))return fetch(url,options);
      return Promise.resolve(new Response(new ReadableStream({start(controller){streams.add(controller);
        options.signal.addEventListener('abort',()=>{streams.delete(controller);controller.error(new DOMException('Aborted','AbortError'));});
      }}),{headers:{'content-type':'text/event-stream'}}));
    };
  });
  let tick=0, revision=0, mediaId='media-1', contentKey='content-1', userText='Screenshot', removed=false, hold=false, failed=false, mediaRequests=0, webRequests=0, readRequests=0;
  const pending=[];const releasePending=()=>pending.splice(0).forEach(r=>r());
  const events=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('https://fixture.example/image.png',route=>{webRequests++;return route.fulfill({contentType:'image/png',body:bytes});});
  await page.route(app.address+'/api/**',async route=>{
   const p=new URL(route.request().url()).pathname;
   const json=data=>route.fulfill({contentType:'application/json',body:JSON.stringify(data)}).catch(()=>{});
   if(p==='/api/agents')return json({selectedId:'local',agents:[{id:'local',kind:'local',name:'Fixture'}]});
   if(p.endsWith('/events')){await new Promise(r=>events.push(r));return route.abort().catch(()=>{});}
   if(p.endsWith('/status')||p.endsWith('/connect'))return json({connected:true,existingCodexWritable:true,multiImageInput:true});
   if(p.endsWith('/threads'))return json({data:{threads:[{id,kind:'codex',title:'Fixture',status:'idle'}]}});
   if(p.endsWith('/threads/'+id)){
    readRequests++;
    return json({data:{thread:{id,kind:'codex',status:{type:'idle'}},history:{source:'official-rollout',revision:'revision-'+revision},
     turns:[{id:'turn',status:'completed',items:[
      ...(!removed?[{id:'picture',type:'userMessage',content:[{type:'text',text:userText}],bridgeDisplay:{text:userText,images:[{id:mediaId,name:'fixture.png',contentKey}]}}]:[]),
      {id:'reply',type:'agentMessage',text:'Update '+tick+'\n\n![web](https://fixture.example/image.png)'}]}]},live:{state:{}}});
   }
   if(p.endsWith('/media')){mediaRequests++;if(hold)await new Promise(r=>pending.push(r));return route.fulfill({status:failed?503:200,contentType:'image/png',body:bytes}).catch(()=>{});}
   if(p.endsWith('/queue'))return json({confirmed:true,messages:[],recoveries:[]});
   if(p.endsWith('/models'))return json({models:[]});
   if(p.endsWith('/projects'))return json({data:{projects:[]}});
   if(p.endsWith('/usage'))return json({status:'unknown',weekly:[]});
   return json({});
  });
  const refresh=async()=>{tick++;await page.locator('#refresh').evaluate(e=>e.click());await page.waitForFunction(t=>document.querySelector('[data-item-id="reply"]')?.textContent.includes('Update '+t),tick);};
  try {
   await page.goto(app.address+'/?thread='+id);await page.locator('[data-item-id="reply"]').waitFor();
   const image=page.locator('.message-image img');
   await image.waitFor();await image.scrollIntoViewIfNeeded();
   await page.waitForFunction(()=>document.querySelector('.message-image')?.imageStatus==='ready');
   await page.locator('.remote-message-image img').scrollIntoViewIfNeeded();
   await page.waitForFunction(()=>document.querySelector('.remote-message-image img')?.naturalWidth>0);
   await image.scrollIntoViewIfNeeded();
   await page.evaluate(()=>{
    window.fixtureImage=document.querySelector('.message-image img');window.fixtureWebImage=document.querySelector('.remote-message-image img');
    window.fixtureSamples=[];window.fixtureSampling=true;
    const sample=()=>{if(!window.fixtureSampling)return;const box=document.querySelector('.message-image');
      window.fixtureSamples.push({ready:box?.imageStatus==='ready',same:box?.querySelector('img')===window.fixtureImage,height:box?.getBoundingClientRect().height});requestAnimationFrame(sample);};sample();
   });
   const baseline=await page.locator('.message-image').evaluate(e=>e.getBoundingClientRect().height);
   for(let i=0;i<8;i++)await refresh();
   userText='Screenshot updated caption';await refresh();
   mediaId='media-refreshed';revision++;await refresh();
   const sample=await page.evaluate(()=>{window.fixtureSampling=false;return {samples:window.fixtureSamples,
    sameWeb:document.querySelector('.remote-message-image img')===window.fixtureWebImage,
    route:document.querySelector('.message-image img').dataset.downloadRoute};});
   assert.ok(sample.samples.length>0);assert.ok(sample.samples.every(s=>s.ready&&s.same&&Math.abs(s.height-baseline)<1),JSON.stringify(sample.samples));
   assert.equal(sample.sameWeb,true);assert.match(sample.route,/media-refreshed/);
   assert.equal(await page.evaluate(()=>window.fixtureRevoked.includes(window.fixtureImage.src)),false);
   assert.equal(mediaRequests,1);assert.equal(webRequests,1);
   checks.push(width+'px: repeated status/body refresh, changed caption and renewed media reference keep decoded nodes, height and download target');
   const reconnect=async()=>{
     const before=readRequests;
     await page.evaluate(()=>window.fixtureEvent({kind:'connection-interrupted'}));
     await page.waitForFunction(()=>document.querySelector('#connection').textContent.includes('已连接'));
     await page.waitForFunction(()=>!document.querySelector('#older').disabled);
     assert.ok(readRequests>before);
   };
   await reconnect();
   assert.equal(await page.evaluate(()=>document.querySelector('.message-image img')===window.fixtureImage),true);
   assert.equal(mediaRequests,1);
   // A genuinely different source must load anew. Repeated refresh during that
   // pending request keeps the same node and request, then the image settles.
   hold=true;mediaId='media-new';contentKey='content-2';revision++;await refresh();
   await page.waitForFunction(()=>document.querySelector('.message-image')?.imageStatus==='loading');
   await page.evaluate(()=>window.pendingImage=document.querySelector('.message-image img'));
   for(let i=0;i<3;i++)await refresh();
   assert.equal(mediaRequests,2);assert.equal(await page.evaluate(()=>document.querySelector('.message-image img')===window.pendingImage),true);
   // Disconnect aborts this request. Reconnection must create a usable new
   // preview even when the official item and media ID are unchanged.
   await reconnect();
   await page.waitForFunction(()=>document.querySelector('.message-image')?.imageStatus==='loading');
   assert.equal(await page.evaluate(()=>document.querySelector('.message-image img')===window.pendingImage),false);
   hold=false;releasePending();await page.waitForFunction(()=>document.querySelector('.message-image')?.imageStatus==='ready');
   assert.equal(await page.evaluate(()=>document.querySelector('.message-image img')===window.fixtureImage),false);
   assert.equal(await page.evaluate(()=>window.fixtureRevoked.includes(window.fixtureImage.src)),true);
   await page.evaluate(()=>window.lastImageUrl=document.querySelector('.message-image img').src);
   removed=true;revision++;await refresh();assert.equal(await page.locator('[data-item-id="picture"]').count(),0);
   await page.waitForFunction(()=>window.fixtureRevoked.includes(window.lastImageUrl));
   assert.ok(readRequests>=14);checks.push(width+'px: changed content loads once, pending refresh coalesces, official removal removes the image');
   removed=false;failed=true;mediaId='media-failure';contentKey='content-3';revision++;await refresh();
   await page.waitForFunction(()=>document.querySelector('.message-image')?.imageStatus==='error');
   const requestsAtFailure=mediaRequests;
   for(let i=0;i<3;i++)await refresh();
   assert.equal(mediaRequests,requestsAtFailure);
   failed=false;await page.locator('.message-image .image-load-state button').click();
   await page.waitForFunction(()=>document.querySelector('.message-image')?.imageStatus==='ready');
   assert.equal(mediaRequests,requestsAtFailure+1);
   checks.push(width+'px: reconnect keeps ready images and restarts cancelled downloads; failed images only retry on user action; removed URLs released');
  } catch(error) {
   await page.screenshot({path:path.join(dir,'failure-'+width+'.png')});
   console.log(JSON.stringify({width,mediaRequests,webRequests,readRequests,error:error.message,errors,ui:await page.locator('#error').textContent()}));throw error;
  } finally {releasePending();events.forEach(r=>r());await page.close();}
 }
 assert.deepEqual(errors,[]);
 const result={result:'PASS',checks,errors,officialTaskWrites:0,apkExecuted:false};
 fs.writeFileSync(path.join(dir,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify({...result,evidence:dir}));
} finally {await browser.close();app.server.closeAllConnections();await new Promise(resolve=>app.server.close(resolve));}
