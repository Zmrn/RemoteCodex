// Shared desktop/Android page and production media HTTP; no APK or official writes.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {startServer} from '../src/server.mjs';
import {ROOT} from '../src/bridge.mjs';
import {MessageMedia} from '../src/message-media.mjs';
import {animatedGif} from '../test/fixtures/gif.mjs';
const {chromium}=await import(process.env.REMOTE_BRIDGE_PLAYWRIGHT||'playwright-core');
fs.mkdirSync(path.join(ROOT,'work'),{recursive:true});
const dir=fs.mkdtempSync(path.join(ROOT,'work/gif-ui-'));
fs.writeFileSync(path.join(dir,'update-settings.json'),'{"automatic":false}');
const file=process.env.REMOTE_BRIDGE_GIF_FILE||path.join(dir,'animation.gif');
if(!process.env.REMOTE_BRIDGE_GIF_FILE)fs.writeFileSync(file,animatedGif());
const bytes=fs.readFileSync(file), hash=b=>createHash('sha256').update(b).digest('hex');
const media=new MessageMedia(),id='aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const data=media.decorate(id,{thread:{id,kind:'codex',status:{type:'idle'}},turns:[{id:'turn',status:'completed',items:[{id:'picture',type:'agentMessage',text:`GIF preview\n![Animation preview](<${file}>)`}]}]});
const app=await startServer({port:0,bridge:{dataDir:dir,media,on(){},off(){},async connect(){},disconnect(){}}});
const home=await fetch(app.address),homeHtml=await home.text(),homeHeaders=Object.fromEntries(home.headers);
delete homeHeaders['transfer-encoding'];delete homeHeaders['content-length'];
const browser=await chromium.launch({executablePath:process.env.REMOTE_BRIDGE_BROWSER||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
const errors=[],checks=[];
async function animated(locator) {
 const first=hash(await locator.screenshot({animations:'allow'}));
 const end=Date.now()+12000;
 while(Date.now()<end){await new Promise(r=>setTimeout(r,90));if(hash(await locator.screenshot({animations:'allow'}))!==first)return;}
 throw Error('GIF pixels did not animate within 12 seconds');
}
try {
 for(const width of [1300,390]) {
  const page=await browser.newPage({viewport:{width,height:1000},acceptDownloads:true});
  page.on('pageerror',e=>errors.push(e.message));
  let hold=true,failed=false,tick=0,reads=0;const pending=[],downloads=[];
  const release=()=>pending.splice(0).forEach(r=>r());
  await page.addInitScript(()=>{
   const fetch=window.fetch.bind(window);
   window.fetch=(url,options)=>String(url).endsWith('/events')?Promise.resolve(new Response(new ReadableStream({start(c){options.signal.addEventListener('abort',()=>c.close());}}),{headers:{'content-type':'text/event-stream'}})):fetch(url,options);
  });
  if(width===390)await page.route(url=>url.origin===app.address&&url.pathname==='/',route=>route.fulfill({headers:homeHeaders,body:homeHtml.replace('<head>','<head><meta name="bridge-platform" content="android">')}));
  await page.route(app.address+'/api/**',async route=>{
   const p=new URL(route.request().url()).pathname;
   const json=data=>route.fulfill({contentType:'application/json',body:JSON.stringify(data)});
   if(p.endsWith('/media')){reads++;if(hold)await new Promise(r=>pending.push(r));return failed?route.fulfill({status:503,body:'unavailable'}):route.continue();}
   if(p==='/api/downloads/image'){downloads.push({bytes:route.request().postDataBuffer()});return json({accepted:true});}
   if(p==='/api/downloads/start'){downloads.push({route:route.request().postDataJSON().route});return json({accepted:true});}
   if(p==='/api/agents')return json({selectedId:'local',agents:[{id:'local',kind:'local',name:'Fixture'}]});
   if(p.endsWith('/status')||p.endsWith('/connect'))return json({connected:true,existingCodexWritable:true});
   if(p.endsWith('/threads'))return json({data:{threads:[{id,kind:'codex',title:'GIF preview',status:'idle'}]}});
   if(p.endsWith('/threads/'+id))return json({data:{...data,turns:[{...data.turns[0],items:[...data.turns[0].items,{id:'revision',type:'agentMessage',text:'Revision '+tick}]}]},live:{state:{}}});
   if(p.endsWith('/queue'))return json({confirmed:true,messages:[],recoveries:[]});
   if(p.endsWith('/projects'))return json({data:{projects:[]}});
   if(p.endsWith('/models'))return json({models:[]});
   if(p.endsWith('/usage'))return json({status:'unknown',weekly:[]});
   return json({});
  });
  try {
   await page.goto(app.address+'/?thread='+id);
   const image=page.locator('.message-image img');await image.waitFor({state:'attached'});
   await page.locator('.message-image').scrollIntoViewIfNeeded();
   await page.waitForFunction(()=>document.querySelector('.message-image')?.imageStatus==='loading');
   assert.equal(await image.evaluate(img=>getComputedStyle(img).opacity),'0');
   assert.equal(await page.locator('.message-image .image-load-state[data-state="loading"]').isVisible(),true);
   failed=true;hold=false;release();await page.waitForFunction(()=>document.querySelector('.message-image')?.imageStatus==='error');
   failed=false;await page.locator('.message-image .image-load-state button').click();
   await page.waitForFunction(()=>document.querySelector('.message-image')?.imageStatus==='ready');
   await animated(image);
   await page.evaluate(()=>window.gifNode=document.querySelector('.message-image img'));
   const loadedReads=reads;
   for(let i=0;i<3;i++){tick++;await page.locator('#refresh').evaluate(e=>e.click());await page.waitForFunction(t=>document.querySelector('[data-item-id="revision"]')?.textContent.includes('Revision '+t),tick);}
   assert.equal(await page.evaluate(()=>window.gifNode===document.querySelector('.message-image img')),true);assert.equal(reads,loadedReads);
   await image.screenshot({path:path.join(dir,'message-'+width+'.png'),animations:'allow'});
   await image.click();await page.locator('#image-viewer[open]').waitFor();
   const preview=page.locator('.image-viewer-canvas img');await page.waitForFunction(()=>document.querySelector('.image-viewer-canvas img')?.naturalWidth>0&&!document.querySelector('.image-viewer-size')?.disabled);
   await animated(preview);await page.screenshot({path:path.join(dir,'preview-'+width+'.png'),animations:'allow'});
   const savedHash=await preview.evaluate(async img=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',await(await fetch(img.src)).arrayBuffer()))).map(x=>x.toString(16).padStart(2,'0')).join(''));
   assert.equal(savedHash,hash(bytes));
   assert.equal(await page.locator('.image-viewer-download').getAttribute('download'),path.basename(file));
   if(width===1300){const waiting=page.waitForEvent('download');await page.locator('.image-viewer-download').click();const download=await waiting;assert.equal(hash(fs.readFileSync(await download.path())),hash(bytes));assert.equal(download.suggestedFilename(),path.basename(file));}
   else {
    await page.locator('.image-viewer-download').click();
    await page.waitForFunction(()=>document.getElementById('toast').textContent.includes('保存位置'));
    assert.equal(downloads.length,1);assert.match(downloads[0].route,/\/media\?id=/);
    // Exercise the independent blob fallback above the old 25 MiB limit.
    const large=Buffer.alloc(Math.max(bytes.length,26*1024*1024));bytes.copy(large);
    await page.route(app.address+'/large-gif',route=>route.fulfill({contentType:'image/gif',body:large}));
    const completed=page.waitForResponse(r=>r.url().includes('/api/downloads/image')&&r.status()===200);
    await page.evaluate(async()=>{const a=document.createElement('a');a.download='large.gif';a.href=URL.createObjectURL(await(await fetch('/large-gif')).blob());document.body.append(a);a.click();a.remove();});
    await completed;
    assert.equal(downloads.length,2);assert.equal(hash(downloads[1].bytes),hash(large));
   }
   checks.push(width+'px: GIF animates in message and zoom; refresh preserves node; loading/failure/retry; original download bytes match');
  }catch(error){console.log(JSON.stringify({width,error:error.message,errors,state:await page.evaluate(()=>({open:document.querySelector('#image-viewer')?.open,src:document.querySelector('.image-viewer-canvas img')?.getAttribute('src'),download:document.querySelector('.image-viewer-download')?.href,error:document.querySelector('#error')?.textContent}))}));await page.screenshot({path:path.join(dir,'failure-'+width+'.png')});throw error;}finally{release();await page.close();}
 }
 assert.deepEqual(errors,[]);
 const result={result:'PASS',checks,bytes:bytes.length,sha256:hash(bytes),source:process.env.REMOTE_BRIDGE_GIF_FILE?'user original read-only, isolated page':'synthetic animation',errors,officialTaskWrites:0,apkExecuted:false};
 fs.writeFileSync(path.join(dir,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify({...result,evidence:dir}));
}finally{await browser.close();app.server.closeAllConnections();await new Promise(r=>app.server.close(r));}
