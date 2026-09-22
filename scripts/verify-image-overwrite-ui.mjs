// Real local file metadata, media bytes/HTTP and shared UI; no official tasks/APK.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {startServer} from '../src/server.mjs';
import {ROOT} from '../src/bridge.mjs';
import {MessageMedia} from '../src/message-media.mjs';
import {mediaResponse} from '../src/media-response.mjs';
import {compactConversation} from '../src/conversation-pages.mjs';
const {chromium}=await import(process.env.REMOTE_BRIDGE_PLAYWRIGHT||'playwright-core');
fs.mkdirSync(path.join(ROOT,'work'),{recursive:true});
const dir=fs.mkdtempSync(path.join(ROOT,'work/image-overwrite-ui-'));
fs.writeFileSync(path.join(dir,'update-settings.json'),'{"automatic":false}');
const media=new MessageMedia();
const app=await startServer({port:0,bridge:{dataDir:dir,media,on(){},off(){},async connect(){},disconnect(){}}});
const original=app.server.listeners('request')[0];app.server.removeListener('request',original);
const id='77777777-7777-4777-8777-777777777777',checks=[],errors=[];
let active;
app.server.on('request',(req,res)=>{
 const url=new URL(req.url,app.address);
 if(!url.pathname.endsWith('/threads/'+id+'/media'))return original(req,res);
 assert.equal(req.headers['x-bridge-csrf'],app.secret);
 active.requests.push({range:req.headers.range??null});
 try{
  const file=media.read(id,url.searchParams.get('id'));
  if(active.hold){active.hold=false;active.pending.push(()=>mediaResponse(req,res,file));}
  else mediaResponse(req,res,file);
 }catch(e){res.writeHead(400,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify({error:e.message}));}
});
const browser=await chromium.launch({executablePath:process.env.REMOTE_BRIDGE_BROWSER||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
const originalA=fs.readFileSync(path.join(ROOT,'fixtures/multi-image-a.png')),originalB=fs.readFileSync(path.join(ROOT,'fixtures/multi-image-b.png'));
const size=Math.max(originalA.length,originalB.length),a=Buffer.concat([originalA,Buffer.alloc(size-originalA.length)]),b=Buffer.concat([originalB,Buffer.alloc(size-originalB.length)]);
try{
 for(const width of [1300,390]){
  active={requests:[],pending:[],hold:false};let tick=0,second=false;
  const file=path.join(dir,'预览-'+width+'.png');fs.writeFileSync(file,a);fs.utimesSync(file,1700000000,1700000000);
  const page=await browser.newPage({viewport:{width,height:1000}}),events=[];
  page.on('pageerror',e=>errors.push(e.message));
  if(process.env.REMOTE_BRIDGE_PREVIOUS_UI)await page.route(app.address+'/app.js',r=>r.fulfill({contentType:'text/javascript',body:fs.readFileSync(process.env.REMOTE_BRIDGE_PREVIOUS_UI)}));
  await page.route(app.address+'/api/**',route=>{
   const p=new URL(route.request().url()).pathname;
   const json=data=>route.fulfill({contentType:'application/json',body:JSON.stringify(data)});
   if(p.endsWith('/media'))return route.continue();
   if(p==='/api/agents')return json({selectedId:'local',agents:[{id:'local',kind:'local',name:'图片覆盖验证'}]});
   if(p.endsWith('/events'))return new Promise(r=>events.push(()=>{route.abort().catch(()=>{});r();}));
   if(p.endsWith('/status')||p.endsWith('/connect'))return json({connected:true,existingCodexWritable:true,multiImageInput:true});
   if(p.endsWith('/threads'))return json({data:{threads:[{id,kind:'codex',title:'同一路径预览更新',status:'idle'}]}});
   if(p.endsWith('/threads/'+id)){
    const items=[{id:'preview',type:'agentMessage',text:`图片已更新 · ${tick}\n\n![预览](<${file}>)`}];
    if(second)items.push({id:'second',type:'agentMessage',text:`第二次发送同一路径\n\n![预览](<${file}>)`});
    // Model a filesystem whose timestamps/identity collide. Only decorate's
    // synchronous metadata query is fixed; actual HTTP media still reads disk.
    const stat=fs.statSync;let data;
    try{
     if(active.frozenStat)fs.statSync=(name,options)=>name===file&&options?.bigint?active.frozenStat:stat(name,options);
     data=compactConversation(media.decorate(id,{thread:{id,kind:'codex',status:{type:'idle'}},turns:[{id:'turn',status:'completed',items}]},{externalImages:true}));
    }finally{fs.statSync=stat;}
    return json({data,live:{state:{}}});
   }
   if(p.endsWith('/queue'))return json({confirmed:true,messages:[],recoveries:[]});
   if(p.endsWith('/models'))return json({models:[]});
   if(p.endsWith('/projects'))return json({data:{projects:[]}});
   if(p.endsWith('/usage'))return json({status:'unknown',weekly:[]});
   return json({});
  });
  const box=page.locator('[data-item-id="preview"] .message-image'),image=box.locator('img');
  const refresh=async()=>{tick++;await page.locator('#refresh').evaluate(e=>e.click());await page.waitForFunction(t=>document.querySelector('[data-item-id="preview"]')?.textContent.includes('图片已更新 · '+t),tick);};
  const bytes=async locator=>Buffer.from(await locator.evaluate(async i=>Array.from(new Uint8Array(await(await fetch(i.src)).arrayBuffer()))));
  const ready=async()=>{await image.scrollIntoViewIfNeeded();await page.waitForFunction(()=>document.querySelector('[data-item-id="preview"] .message-image')?.imageStatus==='ready');};
  const overwrite=(source,restoreTime=false)=>{const stat=fs.statSync(file),mtime=fs.statSync(file,{bigint:true}).mtimeNs;fs.writeFileSync(file,source);if(restoreTime){fs.utimesSync(file,stat.atime,stat.mtime);assert.equal(fs.statSync(file,{bigint:true}).mtimeNs,mtime);}};
  try{
   await page.goto(app.address+'/?thread='+id);await ready();assert.deepEqual(await bytes(image),a);
   await page.evaluate(()=>window.previousImage=document.querySelector('.message-image img'));
   for(let i=0;i<3;i++)await refresh();
   assert.equal(active.requests.length,1);assert.equal(await image.evaluate(i=>i===window.previousImage),true);
   const firstRef=media.add(id,file);overwrite(b,true);assert.equal(media.add(id,file).id,firstRef.id);
   assert.notEqual(media.add(id,file).contentKey,firstRef.contentKey);
   await refresh();await ready();assert.deepEqual(await bytes(image),b);assert.equal(active.requests.length,2);
   checks.push(width+': same ID/path and same length with restored mtime replaces cached bytes; unchanged refresh preserves decoded node');

   second=true;await refresh();await page.locator('[data-item-id="second"] .message-image img').scrollIntoViewIfNeeded();
   await page.waitForFunction(()=>[...document.querySelectorAll('.message-image')].every(b=>b.imageStatus==='ready'));
   assert.deepEqual(await bytes(page.locator('[data-item-id="second"] .message-image img')),b);assert.equal(active.requests.length,3);
   await image.click();await page.waitForFunction(()=>{const i=document.querySelector('#image-viewer img');return i?.src.startsWith('blob:')&&i.naturalWidth>0&&!i.classList.contains('image-pending');});
   assert.deepEqual(await bytes(page.locator('#image-viewer img')),b);
   assert.deepEqual(Buffer.from(await page.locator('#image-viewer .image-viewer-download').evaluate(async e=>Array.from(new Uint8Array(await(await fetch(e.href)).arrayBuffer())))),b);
   await page.locator('#image-viewer .icon-button').click();await page.waitForFunction(()=>!document.querySelector('#image-viewer').open);
   await page.screenshot({path:path.join(dir,'updated-'+width+'.png')});
   checks.push(width+': a new official message revalidates the same path; enlarged view and original download all show new bytes');

   second=false;overwrite(a);active.hold=true;await refresh();
   await page.waitForFunction(()=>document.querySelector('.message-image')?.imageStatus==='loading');
   await page.waitForFunction(()=>document.querySelector('.message-image img')?.classList.contains('image-pending'));
   assert.equal(active.pending.length,1);overwrite(b);await refresh();await ready();assert.deepEqual(await bytes(image),b);
   const late=page.waitForResponse(r=>new URL(r.url()).pathname.endsWith('/media'));
   active.pending.splice(0).forEach(send=>send());await(await late).finished();
   await refresh();await ready();assert.deepEqual(await bytes(image),b);
   assert.ok(active.requests.every(r=>r.range===null));
   checks.push(width+': overwrite during an older pending download starts the new revision; late old response cannot replace it or reuse its partial bytes');

   const replacement=file+'.tmp';fs.writeFileSync(replacement,a);fs.renameSync(replacement,file);
   await refresh();await ready();assert.deepEqual(await bytes(image),a);
   fs.unlinkSync(file);await refresh();await box.locator('[data-state="error"]').waitFor();
   const count=active.requests.length;await refresh();assert.equal(active.requests.length,count);
   fs.writeFileSync(file,b);await refresh();await ready();assert.deepEqual(await bytes(image),b);
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
   checks.push(width+': atomic replacement refreshes; deletion shows an error without retry loops; recreated image loads current bytes');

   active.frozenStat=fs.statSync(file,{bigint:true});
   const beforeCollision=active.requests.length;overwrite(a);second=true;await refresh();
   const collisionImage=page.locator('[data-item-id="second"] .message-image img');await collisionImage.scrollIntoViewIfNeeded();
   await page.waitForFunction(()=>document.querySelector('[data-item-id="second"] .message-image')?.imageStatus==='ready');
   assert.deepEqual(await bytes(collisionImage),a);assert.deepEqual(await bytes(image),b);
   assert.equal(active.requests.length,beforeCollision+1);
   checks.push(width+': with all metadata fixed to the old value, a newly emitted preview reads overwritten bytes instead of another message cache');
  }catch(e){await page.screenshot({path:path.join(dir,'failure-'+width+'.png')});throw e;}
  finally{active.pending.splice(0).forEach(send=>send());events.forEach(stop=>stop());await page.close();}
 }
 assert.deepEqual(errors,[]);
 const report={result:'PASS',checks,errors,officialTaskWrites:0,apkExecuted:false};
 fs.writeFileSync(path.join(dir,'result.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({...report,evidence:dir}));
}finally{await browser.close();app.server.closeAllConnections();await new Promise(r=>app.server.close(r));}
