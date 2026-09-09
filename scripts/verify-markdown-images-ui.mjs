// Shared Windows/Android renderer. --message accepts a locally saved read-only
// official message for verification, never uploading message text to a website.
import fs from "node:fs";import path from "node:path";import assert from "node:assert/strict";
import { startServer } from "../src/server.mjs";import { ROOT } from "../src/bridge.mjs";
const { chromium }=await import(process.env.REMOTE_BRIDGE_PLAYWRIGHT||"playwright-core");
const dir=fs.mkdtempSync(path.join(ROOT,"work/markdown-ui-"));
fs.writeFileSync(path.join(dir,"update-settings.json"),'{"automatic":false}');
const {server,address}=await startServer({port:0,bridge:{dataDir:dir,on(){},off(){},connect:async()=>{},disconnect(){}}});
const browser=await chromium.launch({executablePath:"C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",headless:true});
const page=await browser.newPage({viewport:{width:1000,height:850}});
await page.route(address+"/api/**",r=>r.fulfill({contentType:"application/json",body:'{"agents":[],"models":[]}'}));
const requests=[];page.on("request",r=>{if(r.url().startsWith("https://"))requests.push({url:r.url(),referer:r.headers().referer});});
const bytes=fs.readFileSync(path.join(ROOT,"fixtures/multi-image-a.png"));
let bad=true;
await page.route('https://images.example/**',route=>route.request().url().endsWith('bad.png')&&bad?route.fulfill({status:404,body:"missing"}):route.fulfill({contentType:"image/png",body:bytes}));
async function render(text){await page.evaluate(async text=>{const {markdown}=await import('/ui.mjs');const viewer=document.getElementById('image-viewer');document.body.replaceChildren(markdown(text),...(viewer?[viewer]:[]));document.body.className='';document.body.style.cssText='display:block;overflow:auto;padding:24px';},text);}
try{
  const response=await page.goto(address);assert.match(response.headers()['content-security-policy'],/img-src[^;]*https:/);
  await render('前文\n\n![图一](https://images.example/one.png)\n\n中间\n\n![图二](https://images.example/two_(2).png "说明")\n\n![坏图](https://images.example/bad.png)\n\n`![代码](https://images.example/code.png)`\n\n```md\n![代码块](https://images.example/fence.png)\n```\n\n[原始链接](https://images.example/source)\n\n![不安全](javascript:alert(1))');
  assert.equal(await page.locator('.remote-message-image').count(),3);
  await page.waitForFunction(()=>[...document.querySelectorAll('.remote-message-image img')].slice(0,2).every(i=>i.complete&&i.naturalWidth>0));
  await page.locator('.remote-image-error:not([hidden])').waitFor();
  bad=false;await page.locator('.remote-image-error button').last().click();
  await page.waitForFunction(()=>[...document.querySelectorAll('.remote-message-image img')].every(i=>i.complete&&i.naturalWidth>0));
  assert.equal(requests.some(r=>/code.png|fence.png/.test(r.url)),false);
  assert.ok(requests.every(r=>!r.referer));
  await page.locator('.remote-message-image img').first().click();
  assert.equal(await page.locator('#image-viewer').isVisible(),true);
  assert.equal(await page.locator('.image-viewer-download').textContent(),'打开原图');
  assert.equal(await page.locator('.image-viewer-download').getAttribute('download'),null);
  await page.keyboard.press('Escape');
  const report={result:'passed',source:'isolated renderer fixtures',checks:['images inline in message order','code and ordinary links preserved','HTTPS image policy on Windows','no Referrer header','failed image offers original URL and retry','click zoom and original link'],actual:null};
  const at=process.argv.indexOf('--message');
  if(at>=0){const m=JSON.parse(fs.readFileSync(process.argv[at+1],'utf8'));await render(m.bridgeDisplay?.text??m.text);assert.equal(await page.locator('.remote-message-image img').count(),6);
    for(const img of await page.locator('.remote-message-image img').all()){await img.scrollIntoViewIfNeeded();await img.evaluate(img=>new Promise((resolve,reject)=>{if(img.complete)return img.naturalWidth?resolve():reject(Error('Image unavailable'));img.addEventListener('load',resolve,{once:true});img.addEventListener('error',()=>reject(Error('Image unavailable')),{once:true});setTimeout(()=>reject(Error('Image timeout')),25000);}));}
    report.actual=await page.locator('.remote-message-image img').evaluateAll(images=>images.map(i=>({alt:i.alt,width:i.naturalWidth,height:i.naturalHeight,loaded:i.complete})));
    await page.evaluate(()=>scrollTo(0,0));await page.screenshot({path:path.join(ROOT,'evidence/remote-message-images.png')});
    await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    await page.locator('.remote-message-image img').first().click();await page.locator('#image-viewer img').evaluate(i=>i.decode());
    await page.screenshot({path:path.join(ROOT,'evidence/remote-message-images-mobile.png')});
  }
  fs.writeFileSync(path.join(ROOT,'evidence/markdown-images-ui.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}finally{await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
