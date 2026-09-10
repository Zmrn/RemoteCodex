import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { TaskReports, reportReceipt } from "../src/task-reports.mjs";
import { allowedRoute } from "../src/remote.mjs";
const id = "11111111-1111-4111-8111-111111111111";
const report = (text = "Returned fixture", status = "idle", kind = "codex") => ({
  thread: { id, kind, status: { type: status } },
  turns: [{ id: "turn-1", startedAt: 5, status: "completed", items: [{ id: "item-1", type: "agentMessage", text }] }],
});
function fixture(t) {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'official-summary-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));let now=Date.now(),connected=true;
  const rows=[{id,kind:'codex',status:'idle',hostId:'local',updatedAt:3}],calls=[];
  const states=new Map([[id,{running:false,unread:true,runtimeKnown:true,readStateKnown:true,unknown:false,stateSource:'official-owner-snapshot'}]]);
  const reader={supported:()=>true,connect:async()=>{},close(){},read:async(task)=>{calls.push(task);const s=states.get(task);if(s instanceof Error)throw s;return structuredClone(s);}};
  const bridge={dataDir:dir,requireConnection(){if(!connected)throw Error('offline');},threads:async()=>({data:{threads:rows,pinnedThreads:rows.slice(0,1)}}),desktop:{},markOfficialReportRead:async()=>({status:'unconfirmed'})};
  const reports=new TaskReports(bridge,{now:()=>now,stateFactory:()=>reader});
  return {bridge,reports,rows,states,calls,reader,dir,advance:ms=>now+=ms,disconnect:()=>{connected=false;}};
}
test('read confirmation invalidates a still-running summary before any coalesced caller can consume it',async t=>{
  const f=fixture(t),gates=[];
  f.reader.read=()=>new Promise(resolve=>gates.push(resolve));
  f.bridge.markOfficialReportRead=async()=>({status:'synced'});
  const receipt=f.reports.observe(report());
  const before=f.reports.summary();while(!gates.length)await new Promise(resolve=>setImmediate(resolve));
  await f.reports.acknowledge(id,receipt.token);const after=f.reports.summary();
  gates[0]({...f.states.get(id),unread:true});while(gates.length<2)await new Promise(resolve=>setImmediate(resolve));
  gates[1]({...f.states.get(id),unread:false});
  assert.equal((await before).threads[0].unread,false);assert.equal((await after).threads[0].unread,false);
});
test("report tokens require a final return, distinguish revisions, and never use Chat synthetic completion as runtime proof", () => {
  const first = reportReceipt(report()); assert.ok(first); assert.equal(first.itemId, "item-1");
  assert.notEqual(first.token, reportReceipt(report("New return")).token);
  for (const status of ["active", "waiting-approval", "waiting-user-input"]) assert.equal(reportReceipt(report("text", status)), null);
  assert.equal(reportReceipt(report("text", "unknown", "chatgpt")), null);
  assert.ok(reportReceipt(report("text", "idle", "chatgpt")));
  const data = report(); data.turns.unshift({ id: "later", startedAt: 6, status: "inProgress", items: [] });
  assert.equal(reportReceipt(data), null);
  assert.equal(reportReceipt(report("  ")), null);
});
test('official read and unread can alternate on the same report without local receipts suppressing either',async t=>{
  const f=fixture(t),file=path.join(f.dir,'task-receipts.json');fs.writeFileSync(file,'old independent read state, intentionally invalid');
  const bytes=fs.readFileSync(file);
  assert.equal((await f.reports.summary()).threads[0].unread,true);
  f.states.get(id).unread=false;assert.equal((await f.reports.summary()).threads[0].unread,false);
  f.states.get(id).unread=true;assert.equal((await f.reports.summary()).threads[0].unread,true);
  assert.equal(f.calls.length,3,'every summary obtains new official state');assert.deepEqual(fs.readFileSync(file),bytes);
});
test('read acknowledgement succeeds only on official confirmation and never writes its own read store',async t=>{
  const f=fixture(t),token=f.reports.observe(report()).token;let attempts=0,status='unconfirmed';
  f.bridge.markOfficialReportRead=async()=>{attempts++;return {status};};
  assert.equal((await f.reports.acknowledge(id,token)).accepted,false);
  assert.equal((await f.reports.summary()).threads[0].unread,true);assert.equal(attempts,1);
  status='synced';assert.equal((await f.reports.acknowledge(id,token)).accepted,true);
  assert.equal((await f.reports.summary()).threads[0].unread,true,'even acknowledgement cannot override next official unread observation');
  assert.deepEqual(fs.readdirSync(f.dir),[]);
});
test('simultaneous read requests coalesce; unissued, wrong-task, expired and Chat attempts cannot notify official',async t=>{
  const f=fixture(t),token=f.reports.observe(report()).token;let calls=0,release;
  f.bridge.markOfficialReportRead=()=>{calls++;return new Promise(r=>release=r);};
  const a=f.reports.acknowledge(id,token),b=f.reports.acknowledge(id,token);await new Promise(r=>setImmediate(r));assert.equal(calls,1);release({status:'synced'});await Promise.all([a,b]);
  assert.equal((await f.reports.acknowledge(randomUUID(),token)).accepted,false);
  assert.equal((await f.reports.acknowledge(id,'a'.repeat(64))).accepted,false);
  f.advance(31*60000);assert.equal((await f.reports.acknowledge(id,token)).accepted,false);
  const chat=f.reports.observe(report('chat','idle','chatgpt')).token;
  assert.equal((await f.reports.acknowledge(id,chat)).accepted,false);assert.equal(calls,1);
  await assert.rejects(f.reports.acknowledge('../config',token),/Invalid/);
});
test('summary deduplicates and only official running rows bypass a snapshot; no history or account-union inference',async t=>{
  const f=fixture(t),running=randomUUID();f.rows.push({id:running,kind:'codex',status:'active'});
  const s=await f.reports.summary();assert.equal(s.schemaVersion,2);assert.equal(s.statePolicy,'official-only');assert.equal(s.complete,true);
  assert.equal(s.threads.length,2);assert.equal(s.threads.filter(r=>r.running).length,1);assert.equal(s.threads.filter(r=>r.unread).length,1);assert.deepEqual(f.calls,[id]);
  f.rows[0].hostId='remote';assert.equal((await f.reports.summary()).threads[0].unknown,true);
  f.rows[0].kind='chatgpt';assert.equal((await f.reports.summary()).threads[0].unread,false);
});
test('failed, unloaded, unsupported or missing official state cannot resurrect previous flags or healthy zero',async t=>{
  const f=fixture(t);await f.reports.summary();f.states.set(id,Error('no-client-found'));
  let s=await f.reports.summary();assert.equal(s.complete,false);assert.equal(s.threads[0].unread,false);assert.equal(s.threads[0].unknown,true);
  f.reader.supported=()=>false;s=await f.reports.summary();assert.equal(s.officialReadState.status,'unsupported');assert.equal(s.threads[0].unknown,true);
  f.bridge.threads=async()=>({data:{threads:[],unavailableSources:['chatgpt']}});assert.equal((await f.reports.summary()).complete,false);
  f.bridge.threads=async()=>({data:{threads:Array.from({length:50},()=>({id:randomUUID(),kind:'codex',status:'active'}))}});
  s=await f.reports.summary();assert.equal(s.complete,false);assert.equal(s.listLimited,true);
});
test('disconnect or replaced owner transport rejects a summary; each reader is closed',async t=>{
  const f=fixture(t);await f.reports.summary();f.disconnect();await assert.rejects(f.reports.summary(),/offline/);
  const g=fixture(t);let closed=0;g.reader.close=()=>closed++;g.reader.read=async()=>{g.bridge.desktop={};return g.states.get(id);};
  await assert.rejects(g.reports.summary(),/changed/);assert.equal(closed,1);
});
test('summary and official read notification forwarding expose only intended HTTP methods',()=>{
  assert.equal(allowedRoute('GET','/api/task-summary'),true);assert.equal(allowedRoute('POST','/api/task-summary'),false);
  assert.equal(allowedRoute('POST',`/api/threads/${id}/read-receipt`),true);assert.equal(allowedRoute('GET',`/api/threads/${id}/read-receipt`),false);
});
