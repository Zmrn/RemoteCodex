// Shared production UI with synthetic devices; no official task writes or APK execution.
import fs from 'node:fs';import path from 'node:path';import http from 'node:http';import assert from 'node:assert/strict';
import {ROOT} from '../src/bridge.mjs';
const {chromium}=await import(process.env.REMOTE_BRIDGE_PLAYWRIGHT||'playwright-core');
const dir=fs.mkdtempSync(path.join(ROOT,'work/diagnostics-ui-'));
const A='11111111-1111-4111-8111-111111111111',B='22222222-2222-4222-8222-222222222222',C='33333333-3333-4333-8333-333333333333';
const agents=[{id:B,kind:'remote',name:'设备 B',host:'100.70.0.2',port:43128,hasKey:true},{id:C,kind:'remote',name:'设备 C',host:'100.70.0.3',port:43128,hasKey:true}];
let scenario='healthy',delay=0;const requests=[],streams=new Set(),errors=[],checks=[];
const bridge={bridgeVersion:'0.10.24',connected:true,officialVersion:'26.903.8094.0',codexWritable:true,chatRead:true,chatSend:true,chatCreate:false,chatImages:false,officialOnly:true,storage:[]};
const server=http.createServer(async(req,res)=>{
 const url=new URL(req.url,'http://fixture'),p=url.pathname;const json=x=>{if(!res.destroyed){res.setHeader('content-type','application/json');res.end(JSON.stringify(x));}};
 if(p==='/seed.html'){res.setHeader('content-type','text/html');return res.end('<html><body>Fixture</body></html>');}
 if(!p.startsWith('/api/')){const name=p==='/'?'index.html':p.slice(1);if(!/^[\w.-]+$/.test(name)||!fs.existsSync(path.join(ROOT,'public',name))){res.statusCode=404;return res.end();}res.setHeader('content-type',({'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.svg':'image/svg+xml'})[path.extname(name)]||'application/octet-stream');return res.end(fs.readFileSync(path.join(ROOT,'public',name),'utf8').replace('__BRIDGE_CSRF__','fixture').replace('__BRIDGE_VERSION__','fixture').replace('<head>','<head><meta name="bridge-platform" content="android">'));}
 let raw='';for await(const part of req)raw+=part;requests.push({method:req.method,path:p});
 if(p==='/api/agents')return json({agents,selectedId:B});if(p==='/api/agents/select')return json({selectedId:JSON.parse(raw).id});
 if(p==='/api/diagnostics'){
  const chosen=url.searchParams.get('agent'),state=scenario;const result={schemaVersion:1,checkedAt:'2026-09-10T00:00:00Z',resolved:true,tcp:true,httpStatus:200,bridge:{...bridge,bridgeVersion:chosen===C?'0.10.25':'0.10.24'}};
  if(state==='auth'){result.httpStatus=401;result.bridge=null;result.failure='authentication-failed';}
  if(state==='official')result.bridge.connected=false;
  if(state==='timeout'){result.tcp=false;result.bridge=null;result.failure='connection-timeout';}
  if(delay&&chosen===B)await new Promise(r=>setTimeout(r,delay));return json(result);
 }
 if(p==='/api/device-connections')return json({enabled:true,running:true,devices:2,connected:2,detail:'Fixture'});
 if(p.endsWith('/updates')||p.endsWith('/updates/check'))return json({supported:false});
 if(p.endsWith('/status')||p.endsWith('/connect'))return json({source:'official-desktop-IPC-live',connected:true,existingCodexWritable:true,imageCreation:{supported:true},multiImageInput:true});
 if(p.endsWith('/events')){res.writeHead(200,{'content-type':'text/event-stream'});res.write(': fixture\n\n');streams.add(res);res.on('close',()=>streams.delete(res));return;}
 if(p.endsWith('/projects'))return json({data:{projects:[]}});if(p.endsWith('/models'))return json({models:[]});if(p.endsWith('/usage'))return json({status:'unknown',weekly:[]});if(p.endsWith('/threads'))return json({data:{threads:[]}});return json({});
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const url='http://127.0.0.1:'+server.address().port;
const browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
try{
 const page=await browser.newPage({viewport:{width:390,height:844}});page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>Object.defineProperty(navigator,'clipboard',{value:{writeText:async text=>window.fixtureClipboard=text}}));
 await page.goto(url+'/seed.html');await page.evaluate(async id=>{
  localStorage.setItem('remote-codex-window-id','fixture-window');const db=await new Promise(resolve=>{const r=indexedDB.open('remote-codex-update-recovery',1);r.onupgradeneeded=()=>r.result.createObjectStore('windows');r.onsuccess=()=>resolve(r.result);});
  const file=new File([new Uint8Array([137,80,78,71,13,10,26,10])],'fixture.png',{type:'image/png'});
  await new Promise(resolve=>{const tx=db.transaction('windows','readwrite');tx.objectStore('windows').put({agent:id,mode:'codex',thread:null,prompt:'只能原设备使用的草稿',files:[file,file],drafts:[],taken:[],settings:[]},'fixture-window');tx.oncomplete=resolve;});db.close();
 },A);await page.goto(url+'/');await page.waitForFunction(()=>document.querySelector('#agent-title').textContent==='设备 B'&&!document.querySelector('#prompt').disabled);
 assert.equal(await page.locator('#prompt').inputValue(),'');assert.equal(await page.locator('#send').isDisabled(),true);
 await page.locator('#mobile-menu').click();await page.locator('#orphan-drafts').click();await page.locator('#orphan-dialog').waitFor({state:'visible'});
 assert.match(await page.locator('#orphan-draft-rows').innerText(),/2 张原始图片/);await page.screenshot({path:path.join(dir,'protected-draft-mobile.png')});
 await page.locator('#orphan-draft-rows button').filter({hasText:'放入「设备 B'}).click();await page.waitForFunction(()=>document.querySelector('#prompt').value.includes('只能原设备'));
 await page.evaluate(()=>window.remoteCodexSaveDrafts());await page.reload();await page.waitForFunction(()=>document.querySelector('#prompt').value.includes('只能原设备'));
 assert.equal(await page.locator('#attachment .attachment-chip').count(),2);checks.push('removed-device draft stays outside input; explicit target restoration retains both files across reload');
 await page.locator('#mobile-menu').click();await page.locator('#diagnose-connection').click();await page.locator('#diagnostic-checks [data-check="official"][data-status="ok"]').waitFor();
 await page.locator('#connection-diagnostics button').filter({hasText:'复制脱敏诊断'}).click();const copied=await page.evaluate(()=>window.fixtureClipboard);assert.ok(copied.includes('0.10.24'));for(const secret of [A,B,C,'100.70','只能原设备','设备 B'])assert.ok(!copied.includes(secret));checks.push('healthy diagnostic and copied report exclude device identity, address and draft content');
 for(const [state,key] of [['auth','auth'],['official','official'],['timeout','tcp']]){scenario=state;await page.locator('#connection-diagnostics button').filter({hasText:'重新检测'}).click();await page.locator(`[data-check="${key}"][data-status="error"]`).waitFor();checks.push(state+' has a distinct diagnosis');}
 scenario='healthy';delay=450;await page.locator('#connection-diagnostics button').filter({hasText:'重新检测'}).click();await page.locator('#diagnostic-device').selectOption(C);await page.waitForFunction(()=>document.querySelector('#diagnostic-checks').textContent.includes('0.10.25'));await page.waitForTimeout(550);assert.ok(!(await page.locator('#diagnostic-checks').innerText()).includes('0.10.24'));checks.push('late response cannot replace newly selected device diagnosis');
 for(const width of [390,1300]){await page.setViewportSize({width,height:844});const box=await page.locator('#connection-diagnostics').boundingBox();assert.ok(box.x>=0&&box.x+box.width<=width&&box.y>=0&&box.y+box.height<=844);await page.screenshot({path:path.join(dir,`diagnostics-${width}.png`)});}checks.push('diagnostic dialog fits mobile and desktop');
 assert.deepEqual(errors,[]);assert.equal(requests.filter(r=>r.method==='POST'&&(/\/messages$/.test(r.path)||/\/bridge\/threads$/.test(r.path))).length,0);
 const result={result:'PASS',checks,errors,realOfficialWrites:0,apkExecuted:false};fs.writeFileSync(path.join(dir,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify({...result,dir}));
}finally{await browser.close();for(const s of streams)s.end();server.closeAllConnections();await new Promise(r=>server.close(r));}
