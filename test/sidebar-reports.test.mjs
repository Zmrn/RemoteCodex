import test from 'node:test';
import assert from 'node:assert/strict';
import {SidebarReports, sidebarIndicator} from '../public/sidebar-reports.mjs';
const flags=unread=>({runtimeKnown:true,readStateKnown:true,unknown:false,running:false,unread,stateSource:'official-owner-snapshot'});
const summary=unread=>({schemaVersion:2,statePolicy:'official-only',threads:[{id:'fixture',...flags(unread)}]});
const completed={type:'completed',confirmed:true};
test('completion and visiting do not imply unread; only explicit official unread paints a blue dot',()=>{
  assert.equal(sidebarIndicator(completed,null,'codex',true).type,'unknown');
  assert.equal(sidebarIndicator(completed,flags(false),'codex',true).type,'idle');
  assert.equal(sidebarIndicator(completed,flags(true),'codex',true).type,'unread');
  for(const bad of [{...flags(true),stateSource:'history'},{...flags(true),readStateKnown:false},{...flags(true),unknown:true}])assert.equal(sidebarIndicator(completed,bad,'codex',true).type,'unknown');
  assert.equal(sidebarIndicator(completed,flags(true),'chat',true).type,'unknown');
  assert.equal(sidebarIndicator(completed,flags(true),'codex',false).type,'connection-interrupted');
  assert.equal(sidebarIndicator({type:'running'},flags(true),'codex',true).type,'running');
});
test('sidebar replaces observations on official read/unread, expiry, error and old protocol without local receipts',async()=>{
  let now=0,value=summary(true);const state=new SidebarReports({now:()=>now,read:async()=>{if(value instanceof Error)throw value;return value;}});
  await state.refresh('A');assert.equal(state.get('fixture').unread,true);
  value=summary(false);await state.refresh('A');assert.equal(state.get('fixture').unread,false);
  value=summary(true);await state.refresh('A');assert.equal(state.get('fixture').unread,true);
  now=60000;state.expire();assert.equal(state.get('fixture'),null);
  value=summary(true);await state.refresh('A');value=Error('offline');await state.refresh('A');assert.equal(state.get('fixture'),undefined);
  value={...summary(true),schemaVersion:1};await state.refresh('A');assert.equal(state.get('fixture'),undefined);
});
test('late results cannot restore unread after a read event or switching target, and parallel refreshes coalesce',async()=>{
  const gates=[];const state=new SidebarReports({read:(agent,signal)=>new Promise(resolve=>gates.push({agent,signal,resolve}))});
  const old=state.refresh('A');assert.equal(state.refresh('A'),old);await Promise.resolve();
  state.reset();const fresh=state.refresh('A');await Promise.resolve();assert.equal(gates[0].signal.aborted,true);
  gates[1].resolve(summary(false));await fresh;gates[0].resolve(summary(true));await old;assert.equal(state.get('fixture').unread,false);
  const stale=state.refresh('A');await Promise.resolve();const current=state.refresh('B');await Promise.resolve();
  gates[3].resolve(summary(false));await current;gates[2].resolve(summary(true));await stale;assert.equal(state.agent,'B');assert.equal(state.get('fixture').unread,false);
});
