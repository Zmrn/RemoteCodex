import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Bridge } from '../src/bridge.mjs';
import { readCodexThreadMetadata } from '../src/thread-metadata.mjs';
import { fixtureEvidence } from './fixtures/interface-evidence.mjs';
const id = '11111111-2222-4333-8444-555555555555', owner = 'aaaaaaaa-2222-4333-8444-555555555555';
const row = () => ({ id, kind:'codex', hostId:'local', status:'idle', cwd:'C:/fixture', title:'Fixture' });
function setup(t) {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'metadata-send-')), bridge=new Bridge(dir), calls=[];
  const state={row:row(), runtime:'idle', owner, fail:false};
  const desktop={identity:{appToolsPipe:{image:'OpenAI.Codex_26.903.9818.0_x64__fixture'}},close(){},
    call:async(name,args)=>{calls.push(name); if(name==='list_threads')return {threads:[state.row]}; throw Error('Codex app tool request failed');},
    owner:async()=>({handledByClientId:owner}),
    ipc:{broadcast(method,params){if(params.following)bridge.frame({type:'broadcast',method:'thread-stream-state-changed',sourceClientId:owner,
      params:{hostId:'local',conversationId:id,change:{type:'snapshot',revision:1,conversationState:{id:state.id??id,threadRuntimeStatus:{type:state.runtime}}}}});},
      async request(method,params){calls.push(method);assert.equal(Object.values(bridge.db.requests).at(-1).status,'outcome-unknown');
        if(state.fail)throw Error('lost acknowledgement'); return {handledByClientId:owner,result:{result:{turn:{id:'next'}}}};}}};
  fixtureEvidence(desktop); bridge.desktop=desktop; bridge.connected=true;
  // Use the production follow and snapshot handler, including owner routing.
  const broadcast=desktop.ipc.broadcast;
  desktop.ipc.broadcast=(...args)=>{ if(state.owner!==owner){bridge.live.set(id,{owner:state.owner,state:{id,threadRuntimeStatus:{type:state.runtime}}});return;}broadcast(...args); };
  t.after(()=>{bridge.disconnect();fs.rmSync(dir,{recursive:true,force:true});});
  return {bridge,desktop,state,calls};
}
test('long-task send uses fresh official metadata and matching owner, without reading a turn; duplicate is not replayed',async t=>{
  const {bridge,calls}=setup(t);
  const send=()=>bridge.nativeSend(id,'long-send-001','synthetic text');
  const results=await Promise.all([send(),send()]);assert.ok(results.every(r=>r.status==='accepted'));
  assert.ok(!calls.includes('read_thread'));assert.equal(calls.filter(c=>c==='thread-follower-start-turn').length,1);
  assert.equal((await send()).deduplicated,true);
});
test('runtime change, wrong owner/task, foreign host and Chat reject before any start',async t=>{
  for(const change of ['active','owner','id','host','chat','unknown']){
    const {bridge,state,calls}=setup(t);
    if(change==='active')state.runtime='active';
    if(change==='owner')state.owner='other';
    if(change==='id')state.id=owner;
    if(change==='host')state.row.hostId='another-host';
    if(change==='chat')state.row.kind='chatgpt';
    if(change==='unknown')state.row.status='unknown';
    await assert.rejects(bridge.nativeSend(id,'rejected-send-'+change,'synthetic text'));
    assert.equal(calls.filter(c=>c==='thread-follower-start-turn').length,0,change);
    assert.equal(bridge.db.requests['rejected-send-'+change].status,'rejected');
  }
});
test('connection replacement or runtime change at the last pre-dispatch hook cannot send',async t=>{
  for(const change of ['connection','runtime']){
    const {bridge,state,calls}=setup(t);
    await assert.rejects(bridge.nativeSend(id,'late-change-'+change,'synthetic text',[],{},async()=>{
      if(change==='connection')bridge.desktop={...bridge.desktop};
      else bridge.live.get(id).state.threadRuntimeStatus.type='active';
    }));
    assert.ok(!calls.includes('thread-follower-start-turn'));
  }
});
test('lost acknowledgement on the metadata route stays unknown and is never resent',async t=>{
  const {bridge,state,calls}=setup(t);state.fail=true;
  const send=()=>bridge.nativeSend(id,'unknown-send-01','synthetic text');
  await assert.rejects(send(),/lost acknowledgement/);
  bridge.db=JSON.parse(fs.readFileSync(bridge.stateFile));
  assert.equal((await send()).status,'outcome-unknown');
  assert.equal(calls.filter(c=>c==='thread-follower-start-turn').length,1);
});

test('a cached idle owner without a new observation cannot authorize a start',async t=>{
  const {bridge,desktop,calls}=setup(t);
  bridge.live.set(id,{owner,state:{id,threadRuntimeStatus:{type:'idle'}}});
  desktop.ipc.broadcast=()=>{};
  await assert.rejects(bridge.nativeSend(id,'stale-owner-01','synthetic text'),/所有者或空闲状态尚未确认/);
  assert.ok(!calls.includes('thread-follower-start-turn'));
  assert.equal(bridge.db.requests['stale-owner-01'].status,'rejected');
});
test('missing list entry or unavailable list retains the bounded official per-task route; oversize errors explain unsent state',async()=>{
  for(const missing of [true,false]){
    const calls=[],desktop={call:async(name,args)=>{calls.push({name,args});
      if(name==='list_threads'){if(missing)return {threads:[]};throw Error('unavailable list');}
      return {thread:{...row(),status:{type:'idle'}},turns:[{items:['must not be returned']}]};}};
    const result=await readCodexThreadMetadata(desktop,id,()=>{});
    assert.equal(result.source,'official-thread-live');assert.equal(result.turns,undefined);
    assert.equal(calls[1].args.includeOutputs,false);assert.equal(calls[1].args.turnLimit,1);
  }
  await assert.rejects(readCodexThreadMetadata({call:async name=>{if(name==='list_threads')return {threads:[]};throw Error('Codex app tool request failed');}},id,()=>{}),/操作未发送.*草稿已保留/);
});
test('metadata observation rejects a replaced connection and never falls through to history',async()=>{
  let calls=0;
  await assert.rejects(readCodexThreadMetadata({call:async()=>{calls++;return {threads:[row()]};}},id,()=>{throw Error('changed connection');}),/changed connection/);
  assert.equal(calls,1);
});
