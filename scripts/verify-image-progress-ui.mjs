// Real streamed HTTP response + production shared renderer, synthetic data only.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { startServer } from '../src/server.mjs';
import { ROOT } from '../src/bridge.mjs';
const {chromium}=await import(process.env.REMOTE_BRIDGE_PLAYWRIGHT||'playwright-core');
fs.mkdirSync(path.join(ROOT,'work'),{recursive:true});
const dir=fs.mkdtempSync(path.join(ROOT,'work/image-progress-ui-'));
fs.writeFileSync(path.join(dir,'update-settings.json'),'{"automatic":false}');
const app=await startServer({port:0,bridge:{dataDir:dir,on(){},off(){},async connect(){},disconnect(){}}});
const browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
const original=app.server.listeners('request')[0];app.server.removeListener('request',original);
const bytes=Buffer.concat([fs.readFileSync(path.join(ROOT,'fixtures/multi-image-a.png')),Buffer.alloc(512*1024)]);
const id='77777777-7777-4777-8777-777777777777',checks=[],errors=[];
let active;
app.server.on('request',(req,res)=>{
 if(!new URL(req.url,'http://fixture').pathname.endsWith('/threads/'+id+'/media'))return original(req,res);
 assert.equal(req.headers['x-bridge-csrf'],app.secret);
 active.requests.push(res);
 res.on('error',()=>{});
 if(active.failure){res.writeHead(400,{'content-type':'application/json'});return res.end(JSON.stringify({error:'找不到原图，文件可能已移动或删除'}));}
 const current=active.source??bytes, etag='"sha256-'+createHash('sha256').update(current).digest('hex')+'"';
 const start=active.resumable&&req.headers['if-range']===etag ? Number(/^bytes=(\d+)-$/.exec(req.headers.range??'')?.[1]??0):0;
 res.imageRequestHeaders={...req.headers};res.imageBytes=current;res.imageNext=start+Math.floor((current.length-start)/2);
 res.writeHead(start?206:200,{'content-type':'image/png',...(active.known?{'content-length':current.length-start}:{}),
   ...(active.resumable?{etag,'accept-ranges':'bytes'}:{}),...(start?{'content-range':'bytes '+start+'-'+(current.length-1)+'/'+current.length}:{})});
 res.write(current.subarray(start,res.imageNext));
});
try{
 for(const width of [1300,390]){
  active={known:true,failure:true,requests:[]};let tick=0,ref='first';
  const page=await browser.newPage({viewport:{width,height:1000}}),events=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.route(app.address+'/api/**',route=>{
   const p=new URL(route.request().url()).pathname;
   const json=data=>route.fulfill({contentType:'application/json',body:JSON.stringify(data)}).catch(()=>{});
   if(p.endsWith('/media'))return route.continue();
   if(p.endsWith('/events'))return new Promise(r=>events.push(r)).then(()=>route.abort().catch(()=>{}));
   if(p==='/api/agents')return json({selectedId:'local',agents:[{id:'local',kind:'local',name:'测试电脑'}]});
   if(p.endsWith('/status')||p.endsWith('/connect'))return json({connected:true,existingCodexWritable:true});
   if(p.endsWith('/threads'))return json({data:{threads:[{id,kind:'codex',title:'图片下载',status:'idle'}]}});
   if(p.endsWith('/threads/'+id))return json({data:{thread:{id,kind:'codex',status:{type:'idle'}},turns:[{id:'turn',items:[{id:'picture',type:'agentMessage',text:'下载示例 '+tick,bridgeDisplay:{text:'下载示例 '+tick,images:[{id:ref,name:'原图.png'}]}}]}]},live:{state:{}}});
   if(p.endsWith('/queue'))return json({confirmed:true,messages:[],recoveries:[]});
   if(p.endsWith('/projects'))return json({data:{projects:[]}});
   if(p.endsWith('/models'))return json({models:[]});
   if(p.endsWith('/usage'))return json({status:'unknown',weekly:[]});
   return json({});
  });
  const box=page.locator('.message-image'),state=box.locator('.image-load-state');
  const refresh=async()=>{tick++;await page.locator('#refresh').evaluate(b=>b.click());await page.waitForFunction(t=>document.querySelector('[data-item-id="picture"]')?.textContent.includes('下载示例 '+t),tick);};
  const finish=()=>{const r=active.requests.at(-1);r.end(r.imageBytes.subarray(r.imageNext));};
  try{
   await page.goto(app.address+'/?thread='+id);
   await state.filter({hasText:'找不到原图'}).waitFor();assert.equal(active.requests.length,1);
   active.failure=false;await state.getByRole('button',{name:'重试'}).click();
   await page.waitForFunction(()=>document.querySelector('.image-load-state progress')?.value>40);
   assert.equal(active.requests.length,2);assert.match(await state.textContent(),/49%|50%/);
   assert.equal(await box.locator('img').evaluate(i=>getComputedStyle(i).opacity),'0');
   assert.equal(await state.getByRole('button',{name:'重试'}).isVisible(),false);
   await page.screenshot({path:path.join(dir,'progress-'+width+'.png')});
   await refresh();assert.equal(active.requests.length,2);finish();
   await page.waitForFunction(()=>document.querySelector('.message-image')?.imageStatus==='ready');
   assert.equal(await box.locator('img').evaluate(i=>i.naturalWidth>0),true);
   await refresh();assert.equal(active.requests.length,2);
   checks.push(width+'px: actual server error shown; retry makes one new request; byte progress and total visible; pending/cached refresh stable');
   active.known=false;ref='unknown';await refresh();
   await state.filter({hasText:'已下载'}).waitFor();
   assert.equal(await state.locator('progress').getAttribute('value'),null);
   assert.ok(!(await state.textContent()).includes('%'));finish();
   await page.waitForFunction(()=>document.querySelector('.message-image')?.imageStatus==='ready');
   checks.push(width+'px: missing length reports received bytes without inventing a percentage');
   active.known=true;ref='interrupted';await refresh();
   await page.waitForFunction(()=>document.querySelector('.image-load-state progress')?.value>40);
   active.requests.at(-1).destroy();await box.locator('[data-state="error"]').waitFor();
   await state.getByRole('button',{name:'重试'}).click();
   await page.waitForFunction(()=>document.querySelector('.image-load-state progress')?.value>40);
   finish();await page.waitForFunction(()=>document.querySelector('.message-image')?.imageStatus==='ready');
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
   checks.push(width+'px: truncated connection discards partial bytes; retry downloads anew and decodes successfully; responsive layout fits');
   active.resumable=true;ref='resume';await refresh();
   await page.waitForFunction(()=>document.querySelector('.image-load-state progress')?.value>40);
   const first=active.requests.at(-1);first.destroy();
   await state.filter({hasText:'已保留'}).waitFor();
   const count=active.requests.length;await refresh();assert.equal(active.requests.length,count);
   await page.screenshot({path:path.join(dir,'retained-'+width+'.png')});
   await state.getByRole('button',{name:'重试'}).click();
   await page.waitForFunction(()=>document.querySelector('.image-load-state progress')?.value>65);
   assert.equal(active.requests.at(-1).imageRequestHeaders.range,'bytes='+Math.floor(bytes.length/2)+'-');
   assert.equal(active.requests.length,count+1);
   await page.screenshot({path:path.join(dir,'resumed-'+width+'.png')});
   finish();await page.waitForFunction(()=>document.querySelector('.message-image')?.imageStatus==='ready');
   const original=await box.locator('img').evaluate(async i=>Array.from(new Uint8Array(await (await fetch(i.src)).arrayBuffer())));
   assert.deepEqual(Buffer.from(original),bytes);
   checks.push(width+'px: failure retains received bytes; refresh never restarts it; retry resumes correct offset and final original is byte-identical');
   ref='changed-source';await refresh();
   await page.waitForFunction(()=>document.querySelector('.image-load-state progress')?.value>40);
   active.requests.at(-1).destroy();await state.filter({hasText:'已保留'}).waitFor();
   active.source=Buffer.from(bytes);active.source[active.source.length-1]^=1;
   await state.getByRole('button',{name:'重试'}).click();
   await page.waitForFunction(()=>document.querySelector('.image-load-state progress')?.value>40);
   assert.equal(active.requests.at(-1).imageRequestHeaders.range,'bytes='+Math.floor(bytes.length/2)+'-');
   assert.equal(active.requests.at(-1).imageNext,Math.floor(bytes.length/2),'changed ETag must restart the whole response');
   finish();await page.waitForFunction(()=>document.querySelector('.message-image')?.imageStatus==='ready');
   const changed=await box.locator('img').evaluate(async i=>Array.from(new Uint8Array(await (await fetch(i.src)).arrayBuffer())));
   assert.deepEqual(Buffer.from(changed),active.source);
   checks.push(width+'px: changed original replaces retained prefix instead of joining different images');
   if(width===390&&process.argv.includes('--slow-transfer')){
     ref='slow-active';await refresh();await page.waitForFunction(()=>document.querySelector('.image-load-state progress')?.value>40);
     const r=active.requests.at(-1),started=Date.now();
     while(Date.now()-started<78000){await new Promise(resolve=>setTimeout(resolve,1000));r.write(r.imageBytes.subarray(r.imageNext,r.imageNext+1));r.imageNext++;}
     assert.equal(await box.evaluate(b=>b.imageStatus),'loading');
     finish();await page.waitForFunction(()=>document.querySelector('.message-image')?.imageStatus==='ready');
     checks.push('390px: real HTTP transfer receives continuously beyond 75 seconds and completes without total-duration abort');
   }
  }catch(e){await page.screenshot({path:path.join(dir,'failure-'+width+'.png')});console.log(JSON.stringify({width,requests:active.requests.length,errors,state:await state.allTextContents(),body:await page.locator('#error').textContent()}));throw e;}
  finally{active.requests.forEach(r=>r.destroy());events.forEach(r=>r());await page.close();}
 }
 assert.deepEqual(errors,[]);
 const result={result:'PASS',checks,errors,officialTaskWrites:0,apkExecuted:false};
 fs.writeFileSync(path.join(dir,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify({...result,evidence:dir}));
}finally{await browser.close();app.server.closeAllConnections();await new Promise(r=>app.server.close(r));}
