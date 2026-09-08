// Production Windows bridge + production UI; read-only official Chat validation.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {ROOT} from '../src/bridge.mjs';
const {chromium}=await import(process.env.REMOTE_BRIDGE_PLAYWRIGHT||'playwright-core');
const runtime=JSON.parse(fs.readFileSync(path.join(process.env.LOCALAPPDATA,'RemoteCodex/data/server.json'),'utf8'));
assert.equal(runtime.version,JSON.parse(fs.readFileSync(path.join(ROOT,'package.json'))).version,'Update the local EXE before this check');
const browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
const page=await browser.newPage(),errors=[],blocked=[],followCalls=[];
page.on('pageerror',e=>errors.push(e.message));
await page.addInitScript(()=>localStorage.setItem('remote-codex-mode','chat'));
await page.route('**/api/**',route=>{
 const req=route.request(),p=new URL(req.url()).pathname;
 if(p.endsWith('/follow'))followCalls.push(p);
 const allowed=['/api/agents/select','/api/agents/local/bridge/connect','/api/updates/activity'].includes(p);
 if(req.method()!=='GET'&&!allowed){blocked.push(p);return route.abort();}
 return route.continue();
});
try{
 await page.goto(runtime.address);
 await page.locator('#footer-agent').click();
 await page.locator('#agents [data-agent-id="local"]').click();
 await page.locator('#threads .thread-card').first().waitFor({timeout:60000});
 assert.equal(await page.locator('#mode-name').textContent(),'Chat');
 await page.locator('#threads .thread-card').first().click();
 await page.waitForFunction(()=>document.querySelector('#messages .message')!=null,null,{timeout:60000});
 assert.ok((await page.locator('#metadata').textContent()).includes('chat-history'));
 assert.equal(await page.locator('#model-display').isDisabled(),true);
 const result={observedAt:new Date().toISOString(),version:runtime.version,mode:'chat',realChatMessagesRendered:true,messageCount:await page.locator('#messages .message').count(),unsupportedModelDisabled:true,codexFollowCalls:followCalls.length,blockedPosts:blocked.length,pageErrors:errors};
 assert.equal(followCalls.length,0);assert.equal(blocked.length,0);assert.deepEqual(errors,[]);
 fs.writeFileSync(path.join(ROOT,'work/chat-live-ui-result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
}finally{await browser.close();}
