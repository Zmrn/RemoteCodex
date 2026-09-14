// Real browser touch input + production viewer/CSS; synthetic images only.
// This exercises browser gesture arbitration, not dispatchEvent substitutes.
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const source=process.env.REMOTE_BRIDGE_VIEWER_ROOT || root;
const {chromium}=await import(process.env.REMOTE_BRIDGE_PLAYWRIGHT || 'playwright-core');
fs.mkdirSync(path.join(root,'work'),{recursive:true});
const dir=fs.mkdtempSync(path.join(root,'work/image-touch-ui-'));
const server=http.createServer((req,res)=>{
 if(req.url==='/') {res.setHeader('Content-Type','text/html');res.end(`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><link rel="stylesheet" href="/style.css"></head><body style="display:block;height:1800px;overflow:auto;padding:24px"><main id="underlay"><h1>图片预览测试</h1><textarea id="draft">未发送的草稿</textarea><img id="thumbnail" style="width:180px;height:135px;display:block;margin-top:220px"></main></body></html>`);return;}
 const name=req.url.slice(1);
 if(!['style.css','image-viewer.mjs','image-gestures.mjs','image-load-state.mjs'].includes(name)||!fs.existsSync(path.join(source,'public',name))){res.writeHead(404);res.end();return;}
 res.setHeader('Content-Type',name.endsWith('.css')?'text/css':'text/javascript');res.end(fs.readFileSync(path.join(source,'public',name)));
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const url='http://127.0.0.1:'+server.address().port;
const browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
const errors=[],checks=[];
async function setup(options){
 const context=await browser.newContext(options),page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
 await page.goto(url);
 await page.evaluate(async()=>{
  const c=document.createElement('canvas');c.width=1600;c.height=1200;const g=c.getContext('2d');
  g.fillStyle='#20364e';g.fillRect(0,0,c.width,c.height);g.strokeStyle='#83bfff';g.lineWidth=3;
  for(let x=0;x<=1600;x+=100){g.beginPath();g.moveTo(x,0);g.lineTo(x,1200);g.stroke();}
  for(let y=0;y<=1200;y+=100){g.beginPath();g.moveTo(0,y);g.lineTo(1600,y);g.stroke();}
  g.fillStyle='#fff';g.font='60px sans-serif';g.fillText('1600 × 1200 · Gesture fixture',200,620);
  window.fixtureBlob=URL.createObjectURL(await new Promise(r=>c.toBlob(r)));
  window.inputEvents=[];
  for(const type of ['pointerdown','pointerup','pointercancel','lostpointercapture']) document.addEventListener(type,e=>window.inputEvents.push({type,id:e.pointerId,x:e.clientX,y:e.clientY}),true);
  const img=document.querySelector('#thumbnail');img.src=window.fixtureBlob;await img.decode();
  const {zoomableImage}=await import('/image-viewer.mjs');zoomableImage(img,'gesture-grid.png');
  window.scrollTo(0,180);
 });
 return {context,page,cdp:await context.newCDPSession(page)};
}
const frame=p=>p.evaluate(()=>new Promise(requestAnimationFrame));
const snapshot=p=>p.evaluate(()=>{
 const rect=e=>{const r=e.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height};};
 return {image:rect(document.querySelector('#image-viewer img')),stage:rect(document.querySelector('.image-viewer-stage')),
  toolbar:rect(document.querySelector('.image-viewer-toolbar')),scale:visualViewport.scale,scroll:[scrollX,scrollY],
  underlay:rect(document.querySelector('#underlay')),open:document.querySelector('#image-viewer').open};
});
async function open(page){
 await page.locator('#thumbnail').click();
 // The viewer replaces the thumbnail's Blob URL with its own retained URL.
 // decode() against the first URL can reject when that source is replaced.
 // Wait for the final image's observable load state, including after reopen.
 await page.waitForFunction(()=>{
  const dialog=document.querySelector('#image-viewer'),image=dialog?.querySelector('img');
  return dialog?.open && image?.getAttribute('src')?.startsWith('blob:') && image.getAttribute('src')!==window.fixtureBlob
   && image.complete && image.naturalWidth===1600 && !image.hidden && !image.classList.contains('image-pending')
   && !dialog.querySelector('.image-viewer-size').disabled;
 });
 await frame(page);
}
const touch=(cdp,type,points)=>cdp.send('Input.dispatchTouchEvent',{type,touchPoints:points.map(([id,x,y])=>({id,x,y,radiusX:5,radiusY:5,force:1}))});
async function pinch(cdp,cx,cy,from,to){
 await touch(cdp,'touchStart',[[1,cx-from,cy],[2,cx+from,cy]]);
 for(let n=1;n<=8;n++){const d=from+(to-from)*n/8;await touch(cdp,'touchMove',[[1,cx-d,cy],[2,cx+d,cy]]);}
 await touch(cdp,'touchEnd',[]);
}
async function drag(cdp,x,y,dx,dy){
 await touch(cdp,'touchStart',[[1,x,y]]);
 for(let n=1;n<=8;n++)await touch(cdp,'touchMove',[[1,x+dx*n/8,y+dy*n/8]]);
 await touch(cdp,'touchEnd',[]);
}
let page;
try {
 const mobile=await setup({viewport:{width:390,height:844},isMobile:true,hasTouch:true,deviceScaleFactor:1});page=mobile.page;
 const before=await page.evaluate(()=>({scroll:[scrollX,scrollY],scale:visualViewport.scale,draft:document.querySelector('#draft').value}));
 await open(page);const initial=await snapshot(page),cx=initial.stage.x+initial.stage.width/2+25,cy=initial.stage.y+initial.stage.height/2-20;
 const anchor={x:(cx-initial.image.x)/initial.image.width,y:(cy-initial.image.y)/initial.image.height};
 await pinch(mobile.cdp,cx,cy,35,125);await frame(page);const zoomed=await snapshot(page);
 assert.ok(zoomed.image.width>initial.image.width*2.5,'pinch must enlarge the image itself');
 assert.equal(zoomed.scale,initial.scale,'pinch must not change visualViewport/page zoom');
 assert.deepEqual(zoomed.toolbar,initial.toolbar);assert.deepEqual(zoomed.scroll,initial.scroll);
 assert.ok(Math.abs((cx-zoomed.image.x)/zoomed.image.width-anchor.x)<0.02);
 assert.ok(Math.abs((cy-zoomed.image.y)/zoomed.image.height-anchor.y)<0.02);
 await page.screenshot({path:path.join(dir,'mobile-zoomed.png')});
 await drag(mobile.cdp,cx,cy,55,45);await frame(page);const panned=await snapshot(page);
 assert.ok(panned.image.x>zoomed.image.x+40 && panned.image.y>zoomed.image.y+30,'one-finger drag pans zoomed image');assert.ok(panned.open);
 checks.push('trusted mobile pinch scales only image, preserves focal point; one-finger pan and no accidental close');
 // Continue with one finger after ending a two-finger pinch, then cancel input.
 await touch(mobile.cdp,'touchStart',[[1,100,cy],[2,270,cy]]);
 await touch(mobile.cdp,'touchMove',[[1,85,cy],[2,285,cy]]);
 await touch(mobile.cdp,'touchEnd',[[2,285,cy]]);
 const one=await snapshot(page);await touch(mobile.cdp,'touchMove',[[1,110,cy-20]]);await frame(page);
 const continued=await snapshot(page);assert.ok(continued.image.x>one.image.x+15);assert.ok(Math.abs(continued.image.width-one.image.width)<1);
 await touch(mobile.cdp,'touchCancel',[]);
 const canceled=await snapshot(page);await drag(mobile.cdp,180,cy,-40,0);const resumed=await snapshot(page);
 assert.ok(resumed.image.x<canceled.image.x-25);assert.ok(resumed.open);
 checks.push('pinch-to-single-finger transition and canceled gesture recover without jump or stuck drag');
 await page.locator('.image-viewer-size').click();await frame(page);assert.ok(Math.abs((await snapshot(page)).image.width-initial.image.width)<1);
 // Touch double-tap uses image zoom; browser synthetic dblclick must not undo it.
 for(let n=0;n<2;n++){await touch(mobile.cdp,'touchStart',[[1,cx,cy]]);await touch(mobile.cdp,'touchEnd',[]);}
 await frame(page);assert.ok((await snapshot(page)).image.width>initial.image.width*2);
 await page.setViewportSize({width:844,height:390});await frame(page);const rotated=await snapshot(page);
 assert.equal(rotated.scale,1);assert.ok(rotated.image.x+rotated.image.width>rotated.stage.x && rotated.image.y+rotated.image.height>rotated.stage.y);
 await page.locator('.image-viewer-size').click();await frame(page);const fitted=await snapshot(page);
 assert.ok(fitted.image.width<=fitted.stage.width && fitted.image.height<=fitted.stage.height);
 await page.screenshot({path:path.join(dir,'mobile-landscape.png')});
 await page.setViewportSize({width:390,height:844});await frame(page);
 await page.locator('[aria-label="关闭图片预览"]').click();
 assert.equal(await page.evaluate(()=>visualViewport.scale),before.scale);assert.equal(await page.locator('#draft').inputValue(),before.draft);
 assert.deepEqual(await page.evaluate(()=>[scrollX,scrollY]),before.scroll);
 await open(page);assert.ok(Math.abs((await snapshot(page)).image.width-initial.image.width)<1);
 await page.screenshot({path:path.join(dir,'mobile-fit.png')});
 await page.locator('.image-viewer-canvas').click({position:{x:2,y:2}});assert.equal(await page.locator('#image-viewer').isVisible(),false);
 await pinch(mobile.cdp,195,260,40,100);
 assert.ok(await page.evaluate(()=>visualViewport.scale>1),'normal page zoom stays available after closing the preview');
 checks.push('double-tap, rotation, fit reset, close/reopen and unchanged app scale/draft');
 await mobile.context.close();
 const desktop=await setup({viewport:{width:1280,height:900}});page=desktop.page;await open(page);const d=await snapshot(page);
 await page.mouse.move(640,480);await page.mouse.wheel(0,-350);await frame(page);const dw=await snapshot(page);
 assert.ok(dw.image.width>d.image.width*1.5);assert.equal(dw.scale,d.scale);
 await page.mouse.down();await page.mouse.move(710,530,{steps:8});await page.mouse.up();assert.ok((await snapshot(page)).open);
 for(let n=0;n<8;n++){await page.mouse.wheel(0,-1000);await frame(page);}
 const bounded=await snapshot(page);await page.mouse.wheel(0,-1000);await frame(page);assert.ok(Math.abs((await snapshot(page)).image.width-bounded.image.width)<1);
 await page.mouse.move(640,480);await page.mouse.down();await page.mouse.move(7000,7000,{steps:8});await page.mouse.up();const edge=await snapshot(page);
 assert.ok(edge.open && edge.image.x<edge.stage.x+30 && edge.image.y<edge.stage.y+30,'drag cannot lose the image beyond its content edge');
 await page.locator('.image-viewer-size').click();await page.locator('.image-viewer-size').click();
 assert.ok(Math.abs((await snapshot(page)).image.width-1600)<1,'original size is actual natural pixels');
 await page.locator('.image-viewer-size').click();await page.locator('#image-viewer img').dblclick();
 assert.ok((await snapshot(page)).image.width>d.image.width*2,'mouse double-click zooms the image');
 await page.keyboard.press('Escape');assert.equal(await page.locator('#image-viewer').isVisible(),false);
 assert.equal(await page.locator('#thumbnail').evaluate(i=>document.activeElement===i),true);
 checks.push('desktop wheel, drag, original dimensions, Escape and focus restoration');
 await desktop.context.close();assert.deepEqual(errors,[]);
 const report={result:'PASS',checks,errors,apkExecuted:false,officialTaskWrites:0,directory:dir};
 fs.writeFileSync(path.join(dir,'result.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
} catch(error) {
 if(page&&!page.isClosed()){await page.screenshot({path:path.join(dir,'failure.png')}).catch(()=>{});fs.writeFileSync(path.join(dir,'failure.txt'),String(error.stack));fs.writeFileSync(path.join(dir,'failure-input.json'),JSON.stringify({view:await snapshot(page),events:await page.evaluate(()=>window.inputEvents)},null,2));}
 console.error(dir);throw error;
} finally {await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
