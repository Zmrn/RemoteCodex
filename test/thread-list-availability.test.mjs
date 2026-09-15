import test from 'node:test';
import assert from 'node:assert/strict';
import { readThreadList, THREAD_LIST_TIMEOUT_MS } from '../src/thread-list-read.mjs';
import { readCodexThreadMetadata } from '../src/thread-metadata.mjs';
import { diagnosticStatus, diagnosticChecks, diagnosticExport } from '../public/diagnostic-state.mjs';
import { TaskReports } from '../src/task-reports.mjs';
const id='11111111-1111-4111-8111-111111111111';
const diskRow=()=>({id,title:'Official index title',cwd:'C:/official-project',updatedAt:1,projectId:null,pinned:true,status:'idle',hasUnreadTurn:true});
function fixture(){
 let clock=100000,index={status:'available',threads:[diskRow()]}; const calls=[];
 const bridge={connected:true,home:'C:/official-home',desktop:{identity:{},call:async(...args)=>{calls.push(args);throw Error('outcome-unknown: timeout tools/call');}},
  requireConnection(){if(!this.connected)throw Error('disconnected');},officialDataHome(){return this.home;}};
 const options={now:()=>clock,indexRead:async home=>{assert.equal(home,bridge.home);return structuredClone(index);}};
 return {bridge,calls,read:(limit=50)=>readThreadList(bridge,limit,{},options),advance:ms=>{clock+=ms;},setIndex:v=>{index=v;},options};
}
test('failed official tool is bounded and coalesced; every partial list rereads the official index and keeps status unknown',async()=>{
 const f=fixture();let fail;f.bridge.desktop.call=(...args)=>{f.calls.push(args);return new Promise((_,reject)=>{fail=reject;});};
 const a=f.read(),b=f.read();await new Promise(setImmediate);assert.equal(f.calls.length,1);
 assert.equal(f.calls[0][3].timeoutMs,THREAD_LIST_TIMEOUT_MS);fail(Error('timeout tools/call'));
 const results=await Promise.all([a,b]);
 for(const r of results){assert.equal(r.data.listAvailability,'partial');assert.deepEqual(r.data.unavailableSources,['official-desktop-tool']);
  assert.equal(r.data.threads[0].status,'unknown');assert.equal(r.data.threads[0].hasUnreadTurn,undefined);assert.equal(r.data.pinnedThreads.length,0);assert.match(r.listNotice,/Chat/);}
 f.setIndex({status:'available',threads:[]});assert.equal((await f.read()).data.threads.length,0);assert.equal(f.calls.length,1,'backoff does not flood the stalled official tool');
 f.advance(30001);f.bridge.desktop.call=async(...args)=>{f.calls.push(args);return {threads:[{id,title:'Live again',kind:'codex',hostId:'local',status:'idle'}],pinnedThreads:[]};};
 const fresh=await f.read();assert.equal(fresh.listNotice,undefined);assert.equal(fresh.data.threads[0].title,'Live again');assert.equal(f.bridge.threadListRead.status,'available');assert.equal(f.calls.length,2);
});
test('a failing/missing official index cannot be replaced with a previously successful local list',async()=>{
 const f=fixture();f.bridge.desktop.call=async()=>({threads:[{id,kind:'codex',hostId:'local'}]});await f.read();
 f.bridge.desktop.call=async()=>{throw Error('official list unavailable');};f.setIndex({status:'unavailable',threads:[]});
 await assert.rejects(f.read(),/official list unavailable/);assert.equal(f.bridge.threadListRead.status,'unavailable');
 f.bridge.desktop.call=async()=>({threads:[]});f.advance(30001);assert.deepEqual((await f.read()).data.threads,[]);
});
test('late list/index results from a changed connection or home never enter the new view or its diagnostics',async()=>{
 for(const change of ['desktop','identity','home','disconnect']){
  const f=fixture();let done;f.bridge.desktop.call=()=>new Promise(resolve=>{done=resolve;});
  const pending=f.read();await new Promise(setImmediate);
  if(change==='desktop')f.bridge.desktop={identity:{},call:async()=>({threads:[]})};
  if(change==='identity')f.bridge.desktop.identity={};if(change==='home')f.bridge.home='C:/different-home';if(change==='disconnect')f.bridge.connected=false;
  done({threads:[{id}]});await assert.rejects(pending,/连接已变化|disconnected/);assert.equal(f.bridge.threadListRead,undefined);
 }
});
test('a newly verified desktop does not inherit the old connection backoff',async()=>{
 const f=fixture();await f.read();f.bridge.desktop={identity:{},call:async()=>({threads:[{id,title:'New owner'}]})};
 const result=await f.read();assert.equal(result.data.threads[0].title,'New owner');assert.equal(result.listNotice,undefined);
});
test('malformed official list responses are marked partial instead of being presented as healthy empty lists',async()=>{
 const f=fixture();f.bridge.desktop.call=async()=>({text:'unsupported response'});
 assert.equal((await f.read()).data.listAvailability,'partial');assert.equal(f.bridge.threadListRead.status,'partial');
});
test('operation metadata still requires a fresh official per-task response after a bounded list failure',async()=>{
 const calls=[];const desktop={call:async(name,args,context,options)=>{calls.push({name,args,options});if(name==='list_threads')throw Error('timeout tools/call');
  return {thread:{id,kind:'codex',hostId:'local',status:{type:'idle'}}};}};
 const result=await readCodexThreadMetadata(desktop,id,()=>{});assert.equal(result.source,'official-thread-live');assert.equal(calls[0].options.timeoutMs,6000);
 assert.deepEqual(calls.map(c=>c.name),['list_threads','read_thread']);
 desktop.call=async()=>{throw Error('official read unavailable');};await assert.rejects(readCodexThreadMetadata(desktop,id,()=>{}),/official read unavailable/);
});
test('partial list statistics remain incomplete and never infer unread/running from official index rows',async()=>{
 const f=fixture();f.bridge.threads=f.read;const reports=new TaskReports(f.bridge,{stateFactory:()=>({supported:()=>false,close(){}})});
 const summary=await reports.summary();assert.equal(summary.complete,false);assert.match(summary.source,/local index/);
 assert.equal(summary.threads[0].unknown,true);assert.equal(summary.threads[0].running,false);assert.equal(summary.threads[0].unread,false);
});
test('diagnostics distinguish connected transport from a partial list without exporting rows or errors',()=>{
 const projected=diagnosticStatus({connected:true,threadListRead:{status:'partial',checkedAt:'2026-09-15T01:10:00.000Z',threads:[{title:'private'}],error:'secret'}});
 const report={bridge:projected};assert.equal(diagnosticChecks(report).find(c=>c.key==='official').status,'ok');assert.equal(diagnosticChecks(report).find(c=>c.key==='list').status,'warning');
 assert.ok(!/private|secret/.test(diagnosticExport(report)));assert.equal(diagnosticChecks({bridge:{connected:true}}).find(c=>c.key==='list').status,'unknown');
});
