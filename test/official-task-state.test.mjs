import { fixtureEvidence } from "./fixtures/interface-evidence.mjs";
import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { OfficialTaskState, officialTaskFlags } from '../src/official-task-state.mjs';
import { OFFICIAL, EVENTS } from '../src/official-protocol.mjs';
const id='11111111-1111-4111-8111-111111111111',owner='22222222-2222-4222-8222-222222222222';
const state=(unread=true,type='idle')=>({id,hasUnreadTurn:unread,threadRuntimeStatus:{type}});
test('only explicit official unread and runtime flags count; failed histories or missing flags do not become a cached report',()=>{
  assert.equal(officialTaskFlags(state(),id).unread,true);assert.equal(officialTaskFlags(state(false),id).unread,false);
  assert.equal(officialTaskFlags(state(true,'active'),id).running,true);assert.equal(officialTaskFlags(state(true,'active'),id).unread,false);
  assert.equal(officialTaskFlags(state(true,'notLoaded'),id).unknown,true);assert.equal(officialTaskFlags(state(true,'notLoaded'),id).unread,false);
  assert.equal(officialTaskFlags({id,threadRuntimeStatus:{type:'idle'}},id).unknown,true);
  assert.throws(()=>officialTaskFlags(state(),'other'),/identity/);
});
test('fresh dedicated subscription ignores other owners/hosts, never sends read-state changes, and releases on timeout/disconnect',async()=>{
  const pipe=new EventEmitter(),sent=[];let closed=0,mode='snapshot';
  Object.assign(pipe,{connect:async()=>{},close:()=>closed++,request:async()=>({handledByClientId:owner}),broadcast:(method,params,version,targets)=>{
    sent.push({method,params,targets});if(!params.following)return;
    queueMicrotask(()=>{
      const f={type:'broadcast',method:EVENTS.stream,sourceClientId:owner,params:{hostId:'local',conversationId:id,change:{type:'snapshot',conversationState:state(mode!=='read')}}};
      pipe.emit('frame',{...f,sourceClientId:'wrong'});pipe.emit('frame',{...f,params:{...f.params,hostId:'remote'}});
      if(mode==='disconnect')pipe.emit('disconnected');else if(mode!=='timeout')pipe.emit('frame',f);
    });
  }});
  const desktop={identity:{appToolsPipe:{image:OFFICIAL.support.packagePrefix+'26.903.8094.0'+OFFICIAL.support.packageSuffix},brokerPipe:{path:'fixture'}}};
  fixtureEvidence(desktop);
  const reader=new OfficialTaskState(desktop,{pipeFactory:()=>pipe});await reader.connect();
  assert.equal((await reader.read(id,50)).unread,true);mode='read';assert.equal((await reader.read(id,50)).unread,false);
  mode='timeout';await assert.rejects(reader.read(id,20),/timed out/);mode='disconnect';await assert.rejects(reader.read(id,50),/interrupted/);
  assert.equal(pipe.listenerCount('frame'),0);assert.equal(pipe.listenerCount('disconnected'),0);
  assert.equal(sent.filter(s=>s.params.following===false).length,4);
  assert.ok(sent.every(s=>s.method===OFFICIAL.ipc.following.method));reader.close();assert.equal(closed,1);
});
