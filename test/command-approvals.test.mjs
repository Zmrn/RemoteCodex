import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Bridge } from '../src/bridge.mjs';
import { startServer } from '../src/server.mjs';
import { EVENTS, OFFICIAL, observeDesktop } from '../src/official-protocol.mjs';
import { fixtureEvidence, fixtureProtocols } from './fixtures/interface-evidence.mjs';
import { approvalView, approvalResponse, pendingApprovals } from '../src/approvals.mjs';
import { conversationView } from '../src/state.mjs';
const id='99999999-1111-4222-8333-444444444444';
const request=()=>({id:42,method:EVENTS.commandApproval,params:{threadId:id,turnId:'turn',itemId:'command',
 command:"Invoke-WebRequest -Uri 'https://example.com/paper.pdf' -OutFile 'C:\\work\\paper.pdf'",
 cwd:'C:\\work',reason:'普通下载遇到网络认证错误，是否允许在沙箱外下载公开论文？',
 proposedExecpolicyAmendment:['Invoke-WebRequest','-Uri','https://example.com/paper.pdf']}});
function fixture(t){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'command-approval-')),b=new Bridge(dir),calls=[];
 const state={requests:[request()],owner:'owner',id,kind:'codex'};
 b.connected=true;b.desktop=fixtureEvidence({identity:{},catalog:[],close(){},call:async()=>({thread:{id,kind:state.kind}}),
  ipc:{request:async(method,params,options)=>{assert.equal(Object.values(b.db.requests).at(-1).status,'outcome-unknown');calls.push({method,params,options});return{handledByClientId:'owner',result:{method,result:{ok:true}}};}}});
 b.follow=async()=>{b.live.set(id,{owner:state.owner,state:{id:state.id,requests:structuredClone(state.requests)}});return{handledByClientId:'owner'};};
 b.connect=async()=>b.status();b.disconnect=()=>{};
 fs.writeFileSync(path.join(dir,'update-settings.json'),'{"automatic":false}');
 t.after(()=>{clearInterval(b.subscriptionTimer);fs.rmSync(dir,{recursive:true,force:true});});
 const view=approvalView(state.requests[0],id),body={requestId:'command-client-001',approvalRequestId:view.requestId,token:view.token,decision:'once'};
 return{b,dir,calls,state,view,body,send:(input=body)=>b.answerApproval(id,input.requestId,input)};
}
test('command decisions preserve the exact official forms and only offer the proposed prefix',()=>{
 const r=request(),v=approvalView(r,id);assert.equal(v.kind,'command');assert.deepEqual(v.decisions,['deny','once','prefix']);
 assert.equal(v.command,r.params.command);assert.equal(approvalResponse(v,'once'),'accept');assert.equal(approvalResponse(v,'deny'),'decline');
 assert.deepEqual(approvalResponse(v,'prefix'),{acceptWithExecpolicyAmendment:{execpolicy_amendment:r.params.proposedExecpolicyAmendment}});
 assert.throws(()=>approvalResponse(v,'session'));assert.throws(()=>approvalResponse(v,'site'));
 for(const prefix of [undefined,[],[''],['cmd\nwhoami'],['cmd',null]]){
  const value=approvalView({...r,params:{...r.params,proposedExecpolicyAmendment:prefix}},id);
  assert.deepEqual(value.decisions,['deny','once']);assert.throws(()=>approvalResponse(value,'prefix'));
 }
});
test('missing full commands and unsupported network or decision schemas cannot be approved',()=>{
 for(const change of [p=>delete p.command,p=>p.command='',p=>p.command=['cmd'],p=>p.command='x'.repeat(65537),p=>delete p.itemId,
  p=>delete p.turnId,p=>p.networkApprovalContext={host:'example.com'},p=>p.availableDecisions=['cancel'],p=>p.reason={},p=>p.cwd={}]){
  const r=request();change(r.params);const v=approvalView(r,id);assert.equal(v.supported,false);assert.deepEqual(v.decisions,[]);assert.throws(()=>approvalResponse(v,'once'));
 }
});
test('only official pending requests produce command cards and legacy browser clients never receive them',()=>{
 const state={id,requests:[request()],turns:[{items:[{type:'commandExecution',status:'inProgress'}]}]};
 assert.equal(pendingApprovals(state).length,0);assert.equal(pendingApprovals(state,'command').length,1);
 const projected=conversationView({live:{state}}).live.state;
 assert.deepEqual(projected.approvals,[]);assert.equal(projected.commandApprovals.length,1);
 state.requests=[];assert.deepEqual(pendingApprovals(state,'command'),[]);
 assert.equal(approvalView({...request(),completed:true},id),null);assert.equal(approvalView(request(),'other'),null);
});
test('command approval sends once to the current owner, preserves request ID type and keeps official pending state',async t=>{
 for(const decision of ['once','deny','prefix']){
  const f=fixture(t);assert.equal((await f.send({...f.body,decision})).status,'accepted');
  assert.deepEqual(f.calls,[{method:'thread-follower-command-approval-decision',params:{conversationId:id,requestId:42,decision:approvalResponse(f.view,decision)},options:{targetClientId:'owner',timeoutMs:30000,version:1}}]);
  assert.equal(pendingApprovals(f.b.live.get(id).state,'command').length,1);
  assert.doesNotMatch(fs.readFileSync(f.b.stateFile,'utf8'),/example\.com|Invoke-WebRequest|普通下载/);
 }
 const f=fixture(t);f.state.requests[0].id='42';f.body.token=approvalView(f.state.requests[0],id).token;
 await f.send();assert.equal(f.calls[0].params.requestId,'42');
});
test('changed command/reason/prefix, ended request, wrong owner or thread, Chat and connection replacement reject before dispatch',async t=>{
 for(const change of [f=>f.state.requests[0].params.command+=' -Other',f=>f.state.requests[0].params.reason+=' changed',
  f=>f.state.requests[0].params.proposedExecpolicyAmendment=['cmd'],f=>f.state.requests=[],f=>f.state.owner='other',f=>f.state.id='other',
  f=>f.state.kind='chatgpt',f=>{const follow=f.b.follow;f.b.follow=async()=>{const r=await follow();f.b.desktop={...f.b.desktop};return r;};}]){
  const f=fixture(t);change(f);assert.equal((await f.send()).status,'not-sent');assert.equal(f.calls.length,0);
 }
 for(const extra of [{decision:'site'},{decision:'session'},{decision:'accept'},{command:'changed'},{response:{decision:'accept'}},{prefix:['cmd']}]){
  const f=fixture(t);assert.equal((await f.send({...f.body,...extra})).status,'not-sent');assert.equal(f.calls.length,0);
 }
});
test('command and browser compatibility are independent and storage failure cannot dispatch',async t=>{
 const f=fixture(t),protocols=fixtureProtocols();delete protocols[0].methods[OFFICIAL.ipc.commandApproval.method];observeDesktop(f.b.desktop,protocols);
 assert.equal(f.b.status().commandApprovals.supported,false);assert.equal(f.b.status().browserApprovals.supported,true);
 assert.equal((await f.send()).status,'not-sent');assert.equal(f.calls.length,0);
 const g=fixture(t),other=fixtureProtocols();delete other[0].methods[OFFICIAL.ipc.mcpElicitation.method];observeDesktop(g.b.desktop,other);
 assert.equal(g.b.status().browserApprovals.supported,false);assert.equal(g.b.status().commandApprovals.supported,true);
 assert.equal((await g.send()).status,'accepted');
 const h=fixture(t);h.b.stateStore.assertWritable=()=>{throw Error('read-only fixture');};assert.equal((await h.send()).status,'not-sent');assert.equal(h.calls.length,0);
});
test('concurrent clients and later choices cannot repeat a dispatch; unknown receipts stay protected across restart',async t=>{
 const f=fixture(t);await Promise.all([f.send(),f.send({...f.body,requestId:'other-client-002',decision:'deny'})]);assert.equal(f.calls.length,1);
 for(const response of [null,{handledByClientId:'wrong',result:{method:OFFICIAL.ipc.commandApproval.method,result:{ok:true}}},
  {handledByClientId:'owner',result:{method:'other',result:{ok:true}}},{handledByClientId:'owner',result:{ok:true}}]){
  const g=fixture(t);let count=0;g.b.desktop.ipc.request=async()=>{count++;if(!response)throw Error('connection lost');return response;};
  assert.equal((await g.send()).status,'outcome-unknown');
  const restart=new Bridge(g.dir);t.after(()=>clearInterval(restart.subscriptionTimer));restart.connected=true;restart.desktop=g.b.desktop;
  assert.equal((await restart.answerApproval(id,'new-client-001',{...g.body,decision:'prefix'})).status,'outcome-unknown');assert.equal(count,1);
 }
});
test('production HTTP reuses only the protected approvals route with a separate command projection',async t=>{
 const f=fixture(t),app=await startServer({port:0,bridge:f.b});
 try{
  const url=app.address+'/api/threads/'+id+'/approvals';
  const post=secret=>fetch(url,{method:'POST',headers:{'content-type':'application/json',...(secret?{'X-Bridge-CSRF':secret}:{})},body:JSON.stringify(f.body)});
  assert.equal((await post()).status,403);assert.equal(f.calls.length,0);
  assert.equal((await(await post(app.secret)).json()).status,'accepted');assert.equal(f.calls.length,1);
 }finally{app.server.closeAllConnections();await new Promise(resolve=>app.server.close(resolve));}
});
