// Shared production UI; fake devices/history only. No APK or real task operations.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { startServer } from '../src/server.mjs';
import { ROOT } from '../src/bridge.mjs';
const { chromium } = await import(process.env.REMOTE_BRIDGE_PLAYWRIGHT || 'playwright-core');
fs.mkdirSync(path.join(ROOT, 'work'), {recursive:true});
const dir=fs.mkdtempSync(path.join(ROOT,'work/usage-history-ui-'));
fs.writeFileSync(path.join(dir,'update-settings.json'),'{"automatic":false}');
const app=await startServer({port:0,bridge:{dataDir:dir,on(){},off(){},async connect(){},disconnect(){}}});
const browser=await chromium.launch({executablePath:process.env.REMOTE_BRIDGE_BROWSER||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
const remote='11111111-2222-4333-8444-555555555555', checks=[],errors=[],requests=[];
const at=Date.now(), point=(n,value,segment='run',reset=1)=>({at:at-n*300000,remainingPercent:value,segment,resetsAt:reset});
try {
 for(const width of [1300,390]){
  const page=await browser.newPage({viewport:{width,height:1000}});
  let kind='normal',hold=false,release,heldDone;
  await page.addInitScript(()=>{
    const fetch=window.fetch.bind(window);
    window.fetch=(url,options)=>String(url).endsWith('/events')?Promise.resolve(new Response(new ReadableStream({start(c){options.signal.addEventListener('abort',()=>c.error(new DOMException('Aborted','AbortError')));}}),{headers:{'content-type':'text/event-stream'}})):fetch(url,options);
  });
  page.on('pageerror',e=>errors.push(e.message));
  const rows=days=>{
    const points=kind==='single'?[point(0,65)]:days===30?Array.from({length:8640},(_,i)=>point(8639-i,85-(i%180)/4,'dense'))
      :[point(36,82),point(35,80),point(34,76),point(15,60),point(14,57),point(13,53),point(3,100,'reset',2),point(2,98,'reset',2),point(1,96,'reset',2)];
    return [{key:'week',limitId:'codex',windowDurationMins:10080,label:'Codex',points},
      {key:'five',limitId:'codex',windowDurationMins:300,label:'Codex',points:points.map(p=>({...p,remainingPercent:Math.max(0,p.remainingPercent-20)}))}];
  };
  await page.route(app.address+'/api/**',async route=>{
    const url=new URL(route.request().url()),p=url.pathname;
    const json=(data,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(data)}).catch(()=>{});
    if(p==='/api/agents')return json({selectedId:'local',agents:[{id:'local',kind:'local',name:'这台电脑'},{id:remote,kind:'remote',host:'100.64.0.2',port:43128,name:'公司电脑'}]});
    if(p.endsWith('/status')||p.endsWith('/connect'))return json({connected:true,existingCodexWritable:true});
    if(p.endsWith('/threads'))return json({data:{threads:[]}});
    if(p.endsWith('/projects'))return json({data:{projects:[]}});
    if(p.endsWith('/models'))return json({models:[]});
    if(p.endsWith('/usage'))return json({schemaVersion:2,status:'available',observedAt:new Date(at).toISOString(),weekly:[{limitId:'codex',remainingPercent:96}],fiveHour:[]});
    if(p.endsWith('/usage/history')){
      const days=Number(url.searchParams.get('days')),target=p.includes(remote)?remote:'local',captured=kind;
      requests.push({width,days,target});
      const result={schemaVersion:1,days,sampleMinutes:5,retentionDays:365,recording:{connected:target==='local'},series:target===remote||captured==='empty'?[]:rows(days)};
      if(hold){hold=false;await new Promise(r=>{release=r;});}
      if(captured==='old')return json({error:'Unknown route'},404);
      if(captured==='failed')return json({error:'连接中断'},502);
      await json(result);heldDone?.();return;
    }
    return json({});
  });
  const dialog=page.locator('#usage-history-dialog');
  try{
    const before=requests.length;
    await page.goto(app.address);await page.waitForFunction(()=>document.querySelector('#agent-quota').textContent.includes('96%'));
    assert.equal(requests.length,before);
    if(width===390)await page.locator('#mobile-menu').click();
    await page.locator('#open-usage-history').click();
    await page.locator('#usage-history-sample').waitFor();
    assert.equal(requests.at(-1).days,7);assert.equal(requests.at(-1).target,'local');
    assert.equal(await page.locator('#usage-history-series').inputValue(),'week');
    assert.equal(await dialog.locator('.usage-chart-line').count(),3);
    await page.locator('#usage-history-sample').fill('0');await page.locator('#usage-history-sample').dispatchEvent('input');
    assert.match(await page.locator('#usage-history-selected').textContent(),/82%/);
    await page.locator('#usage-history-sample').press('ArrowRight');
    assert.match(await page.locator('#usage-history-selected').textContent(),/80%/);
    await page.locator('#usage-history-series').selectOption('five');
    assert.match(await page.locator('#usage-history-selected').textContent(),/76%/);
    await page.locator('#usage-history-series').selectOption('week');
    await page.screenshot({path:path.join(dir,'history-'+width+'.png')});
    const box=await dialog.boundingBox();assert.ok(box.x>=0&&box.y>=0&&box.x+box.width<=width+1&&box.y+box.height<=1001);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    checks.push(width+'px: on-demand target fetch, weekly default, observed gaps/reset breaks, keyboard sample inspection, responsive chart');
    await dialog.locator('[data-days="1"]').click();await page.waitForFunction(()=>!document.querySelector('#usage-history-refresh').disabled);
    assert.equal(requests.at(-1).days,1);
    await dialog.locator('[data-days="30"]').click();await page.waitForFunction(()=>document.querySelector('#usage-history-sample')?.max==='8639');
    assert.equal(await dialog.locator('.usage-chart-line').count(),1);
    assert.ok(await dialog.locator('.usage-chart-line').getAttribute('d'));
    assert.equal(await dialog.locator('.usage-chart-dot').count(),0);
    checks.push(width+'px: 1/7/30 day requests and dense 30-day history use real samples without thousands of dot nodes');
    // A slower previous-device response must never paint after changing selection.
    hold=true;await page.locator('#usage-history-refresh').click();
    await page.waitForFunction(()=>document.querySelector('#usage-history-refresh').disabled);
    for(let i=0;i<100&&!release;i++)await new Promise(r=>setTimeout(r,10));assert.ok(release);
    await page.locator('#usage-history-device').selectOption(remote);
    await page.locator('.usage-history-empty').waitFor();
    const finished=new Promise(r=>{heldDone=r;});release();await finished;release=null;heldDone=null;
    await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
    assert.equal(await page.locator('#usage-history-device').inputValue(),remote);
    assert.equal(await dialog.locator('svg.usage-history-chart').count(),0);
    assert.match(await page.locator('#usage-history-status').textContent(),/未连接/);
    checks.push(width+'px: late device response discarded, offline official app can return saved history, empty ranges show no invented values');
    kind='old';await page.locator('#usage-history-device').selectOption('local');
    await page.waitForFunction(()=>document.querySelector('#usage-history-status').textContent.includes('尚不支持'));
    assert.equal(await dialog.locator('svg.usage-history-chart').count(),0);
    kind='failed';await page.locator('#usage-history-refresh').click();
    await page.waitForFunction(()=>document.querySelector('#usage-history-status').textContent.includes('连接中断'));
    kind='single';await page.locator('#usage-history-refresh').click();await page.locator('#usage-history-sample').waitFor();
    assert.equal(await dialog.locator('.usage-chart-line').count(),0);
    assert.equal(await dialog.locator('.usage-chart-dot').count(),1);
    assert.match(await page.locator('#usage-history-selected').textContent(),/65%/);
    await page.getByRole('button',{name:'关闭额度历史',exact:true}).click();
    assert.equal(await page.locator('#usage-history-sample').count(),0);
    const count=requests.length;await page.locator('#open-usage-history').click();await page.locator('#usage-history-sample').waitFor();
    assert.equal(requests.length,count+1);
    await page.getByRole('button',{name:'关闭额度历史',exact:true}).click();
    await page.locator('#footer-agent').click();await page.locator('#menu-usage-history').click();await page.locator('#usage-history-sample').waitFor();
    checks.push(width+'px: unsupported/failed targets clear chart and retry; single record stays a dot; close clears data; both nearby buttons reopen with fresh fetch');
  }catch(e){await page.screenshot({path:path.join(dir,'failure-'+width+'.png')});console.log(JSON.stringify({width,error:e.message,errors}));throw e;}
  finally{release?.();await page.close();}
 }
 assert.deepEqual(errors,[]);
 const result={result:'PASS',checks,requests,errors,officialTaskWrites:0,apkExecuted:false};
 fs.writeFileSync(path.join(dir,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify({...result,evidence:dir}));
}finally{await browser.close();app.server.closeAllConnections();await new Promise(r=>app.server.close(r));}
