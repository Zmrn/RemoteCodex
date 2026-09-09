import test from 'node:test';
import assert from 'node:assert/strict';
import { DraftDiscards } from '../public/draft-discards.mjs';
const context = {agent:'local',id:'task-a',connected:true};
test('discard intent precedes local cleanup, deduplicates and survives lost acknowledgement/restart', async () => {
  let saved, time=0, calls=0, errors=0;
  const make = fail => {
    const d = new DraftDiscards({now:()=>time,persist:async()=>{saved=d.snapshot();},onError:()=>errors++,
      api:async(agent,route,body)=>{calls++;assert.equal(saved[0].recoveryId,'withdrawn');assert.equal(body.action,'ack-recovery');
        if(fail)throw Error('lost response');return {status:'accepted',result:{disposition:'recovery-cleared'}};}});
    return d;
  };
  const d=make(true);d.add(context,'withdrawn');
  await Promise.all([d.flush(context),d.flush(context)]);assert.equal(calls,1);
  assert.equal(d.has({...context,agent:'other'},'withdrawn'),false);
  assert.equal(d.has({...context,id:'task-b'},'withdrawn'),false);
  await d.flush(context);assert.equal(calls,1);assert.equal(errors,1);
  const restarted=make(false);restarted.restore(saved);
  assert.equal(restarted.has(context,'withdrawn'),true);
  await restarted.flush({...context,connected:false});assert.equal(calls,1);
  await restarted.flush(context);assert.equal(calls,2);
  assert.equal(saved[0].cleared,true);
  assert.equal(restarted.has(context,'withdrawn'),true,'late stale queue GET remains suppressed');
  await restarted.flush(context);assert.equal(calls,2);
});
test('failed durable intent never dispatches deletion; retry remains limited to the same backup',async()=>{
  let failure=true,calls=0,time=0;
  const d=new DraftDiscards({now:()=>time,persist:async()=>{if(failure)throw Error('IDB unavailable');},api:async()=>{calls++;return {status:'accepted',result:{disposition:'recovery-cleared'}};}});
  d.add(context,'keep-until-durable');await d.flush(context);assert.equal(calls,0);
  failure=false;time=5000;await d.flush({...context,id:'task-b'});assert.equal(calls,0);
  await d.flush(context);assert.equal(calls,1);
});
