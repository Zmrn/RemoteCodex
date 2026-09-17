import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter, once } from 'node:events';
import { spawn } from 'node:child_process';
import { UsageHistory, SAMPLE_MS, RETENTION_MS } from '../src/usage-history.mjs';
import { UsageRecorder } from '../src/usage-recorder.mjs';
import { accountUsage } from '../src/usage.mjs';
import { Bridge } from '../src/bridge.mjs';
import { startServer } from '../src/server.mjs';
import { allowedRoute } from '../src/remote.mjs';
import { chartSegments } from '../public/usage-history-view.mjs';

const base = Date.parse('2026-09-17T12:00:00Z');
const usage = (at, used = 25) => accountUsage({ accountId:'NEVER-SAVE-ME', rateLimitsByLimitId: {
  codex: { primary:{usedPercent:used,windowDurationMins:10080,resetsAt:base/1000+86400} },
  spark:{limitName:'Spark',primary:{usedPercent:2,windowDurationMins:300,resetsAt:base/1000+300}}
}}, new Date(at).toISOString());
function setup(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(),'remote-usage-history-')), clock = { now: base };
  const history = new UsageHistory(dir,{now:()=>clock.now});
  t.after(()=>{history.close();fs.rmSync(dir,{recursive:true,force:true});});
  return {dir,history,clock};
}

test('history retains real samples, isolates windows, coalesces five-minute slots and survives restart', t=>{
  const {history,dir,clock} = setup(t);
  assert.equal(history.record(usage(base),'connection-one'),true);
  assert.equal(history.record(usage(base,90),'connection-one'),true); // Same timestamp cannot overwrite.
  clock.now += 60000; history.record(usage(clock.now,30),'connection-one');
  let result=history.read(1);
  assert.equal(result.series.length,2); assert.equal(result.series[0].points.length,1);
  assert.equal(result.series[0].points[0].at,clock.now);
  assert.equal(result.series[0].points[0].remainingPercent,70);
  assert.ok(!JSON.stringify(result).includes('NEVER-SAVE-ME'));
  assert.ok(!fs.readFileSync(history.file).includes(Buffer.from('NEVER-SAVE-ME')));
  history.close();
  const reopened=new UsageHistory(dir,{now:()=>clock.now});
  try {assert.deepEqual(reopened.read(1).series,result.series);} finally {reopened.close();}
  clock.now += SAMPLE_MS; history.record(usage(clock.now,35),'connection-two');
  result=history.read(1); assert.equal(result.series[0].points.length,2);
  assert.equal(chartSegments(result.series[0].points).length,2);
});

test('only genuine known observations are persisted; null or failed reads never become full quota',t=>{
  const {history,clock}=setup(t);
  for (const raw of [{}, {...usage(base),source:'cache'}, {...usage(base),status:'unknown'}, {...usage(base),observedAt:new Date(base+1).toISOString()}])
    assert.equal(history.record(raw,'run'),false);
  const unknown=usage(base,null);unknown.fiveHour=[];
  assert.equal(history.record(unknown,'run'),false);
  assert.equal(history.read(7).series.length,0);
  const zero=usage(base,100); history.record(zero,'run');
  assert.equal(history.read(7).series[0].points[0].remainingPercent,0);
  clock.now+=SAMPLE_MS*3;
  assert.equal(history.record(usage(base),'run'),false);
  const points=[{at:1,segment:'run',resetsAt:10},{at:700001,segment:'run',resetsAt:10},{at:700002,segment:'run',resetsAt:11}];
  assert.equal(chartSegments(points).length,3);
});

test('range filters and one-year pruning affect only this database, even without new samples',t=>{
  const {history,dir,clock}=setup(t);
  fs.writeFileSync(path.join(dir,'agents.json'),'USER-SETTINGS');
  for (const age of [366,365,31,29,6,0]) {clock.now=base-age*86400000;history.record(usage(clock.now),'run');}
  clock.now=base;
  assert.equal(history.read(1).series[0].points.length,1);
  assert.equal(history.read(7).series[0].points.length,2);
  assert.equal(history.read(30).series[0].points.length,3);
  assert.equal(history.open().prepare('SELECT count(*) AS n FROM samples').get().n,10);
  assert.equal(fs.readFileSync(path.join(dir,'agents.json'),'utf8'),'USER-SETTINGS');
  for(const days of [0,2,365,Infinity,NaN,'7'])assert.throws(()=>history.read(days),/仅支持/);
  clock.now=base+RETENTION_MS+1;history.prune();
  assert.equal(history.open().prepare('SELECT count(*) AS n FROM samples').get().n,0);
});

test('independent instances merge writes and never overwrite a newer observation with stale memory',t=>{
  const {history,dir,clock}=setup(t), other=new UsageHistory(dir,{now:()=>clock.now});
  try {
    history.record(usage(base),'one');other.read(7);
    clock.now+=60000;other.record(usage(clock.now,60),'two');
    history.record(usage(base,99),'one');
    assert.equal(history.read(7).series[0].points[0].remainingPercent,40);
    clock.now+=SAMPLE_MS;history.record(usage(clock.now,70),'one');
    assert.equal(other.read(7).series[0].points.length,2);
  } finally {other.close();}
});

test('interrupted transaction is recovered after process exit without losing committed history',async t=>{
  const {history,clock}=setup(t);history.record(usage(base),'committed');
  const file=history.file;history.close();
  const code = `import {DatabaseSync} from 'node:sqlite'; const d=new DatabaseSync(process.argv[1]);d.exec('BEGIN IMMEDIATE; DELETE FROM samples;');process.send('pending');setInterval(()=>{},1000);`;
  const child=spawn(process.execPath,['--input-type=module','-e',code,file],{windowsHide:true,stdio:['ignore','ignore','pipe','ipc']});
  t.after(()=>{if(child.exitCode===null)child.kill();});
  await Promise.race([once(child,'message'),once(child,'exit').then(()=>{throw Error('child exited early');})]);
  const stopped=once(child,'close'); child.kill(); await stopped;
  const result=history.read(7);assert.equal(result.series[0].points[0].remainingPercent,75);
  assert.equal(result.series[0].points[0].at,clock.now);
});

test('corrupt or newer-schema history is not replaced with an empty file',t=>{
  const {history}=setup(t);
  fs.writeFileSync(history.file,'damaged-history-bytes');
  const before=fs.readFileSync(history.file);
  assert.throws(()=>history.read(7),/原文件已保留/);
  assert.throws(()=>history.record(usage(base),'run'),/原文件已保留/);
  assert.deepEqual(fs.readFileSync(history.file),before);
});

test('recorder samples without viewers, handles gaps and stops late writes on shutdown',async t=>{
  const {history}=setup(t), bridge=new EventEmitter();bridge.connected=true;
  let calls=0,pending;
  bridge.usage=async()=>{calls++;const u=usage(base);bridge.emit('usage',u);return u;};
  const recorder=new UsageRecorder(bridge,history,{intervalMs:25,now:()=>base});
  t.after(()=>recorder.close()); recorder.start();
  await new Promise(r=>setTimeout(r,65));assert.ok(calls>=2);assert.equal(history.read(1).series.length,2);
  bridge.connected=false;bridge.emit('event',{kind:'connection-interrupted'});
  const atDisconnect=calls;await new Promise(r=>setTimeout(r,35));assert.equal(calls,atDisconnect);
  const oldSegment=recorder.segment;bridge.connected=true;bridge.emit('event',{kind:'connected'});
  assert.notEqual(recorder.segment,oldSegment);
  await new Promise(r=>setTimeout(r,0));
  bridge.usage=()=>new Promise(r=>{pending=r;});
  recorder.poll();assert.ok(pending);recorder.close();
  bridge.emit('usage',usage(base+60000));pending();
  await new Promise(r=>setTimeout(r,0));
  assert.equal(history.read(7).series[0].points[0].at,base);
});

test('storage failures cannot fail live quota requests or silently report successful history',async t=>{
  const {history,dir}=setup(t), bridge=new Bridge(dir);bridge.connected=true;
  bridge.desktop={call:async()=>({rateLimits:{primary:{usedPercent:10,windowDurationMins:10080}}})};
  const recorder=new UsageRecorder(bridge,history);
  history.record=()=>{throw Error('Disk write failed');};
  recorder.start();t.after(()=>recorder.close());
  const result=await bridge.usage();assert.equal(result.weekly[0].remainingPercent,90);
  assert.match(recorder.read(1).recording.error,/未能保存/);
});

test('history HTTP read works while official is offline and remote forwarding is GET-only',async t=>{
  const {dir,history}=setup(t);history.record(usage(base),'run');
  // Read API uses wall-clock ranges, so add one observation at the actual current time.
  const liveHistory=new UsageHistory(dir);liveHistory.record(usage(Date.now()),'current');liveHistory.close();history.close();
  fs.writeFileSync(path.join(dir,'update-settings.json'),'{"automatic":false}');
  const bridge=new EventEmitter();Object.assign(bridge,{dataDir:dir,connected:false,connect:async()=>{},disconnect(){}});
  const app=await startServer({port:0,bridge});
  try {
    const response=await fetch(app.address+'/api/usage/history?days=7',{headers:{'X-Bridge-CSRF':app.secret}});
    assert.equal(response.status,200);const data=await response.json();
    assert.equal(data.recording.connected,false);assert.ok(data.series.length);
    assert.equal((await fetch(app.address+'/api/usage/history?days=365',{headers:{'X-Bridge-CSRF':app.secret}})).status,400);
    assert.equal((await fetch(app.address+'/api/usage/history?days=7')).status,403);
    assert.equal(allowedRoute('GET','/api/usage/history?days=30'),true);
    assert.equal(allowedRoute('POST','/api/usage/history'),false);
    assert.equal(allowedRoute('GET','/api/usage/history/delete'),false);
  } finally {app.server.closeAllConnections();await new Promise(r=>app.server.close(r));}
});


test('newer database schemas are preserved and refused instead of reinitialized',t=>{
  const {history}=setup(t);history.record(usage(base),'run');
  history.open().exec('PRAGMA user_version=2');history.close();
  const before=fs.readFileSync(history.file);
  assert.throws(()=>history.read(7),/原文件已保留/);
  assert.deepEqual(fs.readFileSync(history.file),before);
});

test('a missing quota window breaks its continuity even while another window remains available',t=>{
  const {history,clock}=setup(t), bridge=new EventEmitter();bridge.connected=true;
  const recorder=new UsageRecorder(bridge,history);recorder.start();t.after(()=>recorder.close());
  bridge.emit('usage',usage(base));
  clock.now+=SAMPLE_MS;bridge.emit('usage',usage(clock.now,null));
  clock.now+=SAMPLE_MS;bridge.emit('usage',usage(clock.now,40));
  const codex=history.read(1).series.find(s=>s.limitId==='codex');
  assert.equal(codex.points.length,2);
  assert.equal(chartSegments(codex.points).length,2);
});
