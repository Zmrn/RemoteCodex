import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import {diagnoseDevice} from '../src/diagnostics.mjs';
import {DraftDiscards} from '../public/draft-discards.mjs';
import {DurableJson} from '../src/durable-json.mjs';
import {Bridge} from '../src/bridge.mjs';
import {LocalAccess} from '../src/local-access.mjs';
import {Updater} from '../src/updater.mjs';
import {TaskReports} from '../src/task-reports.mjs';
import {protectRecovery,draftBinding,orphanEntries} from '../public/draft-guard.mjs';
import {diagnosticStatus,diagnosticChecks,diagnosticExport} from '../public/diagnostic-state.mjs';
const folder=t=>{const dir=fs.mkdtempSync(path.join(os.tmpdir(),'remote-review-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));return dir;};
test('critical malformed files open in protective mode without erasing bytes or replaying requests',async t=>{
  const dir=folder(t);for(const name of ['remote-access.json','bridge-state.json','update-settings.json'])fs.writeFileSync(path.join(dir,name),'{broken');
  const b=new Bridge(dir),a=new LocalAccess(dir),u=new Updater(dir);t.after(()=>b.disconnect());
  assert.equal(b.status().existingCodexWritable,false);assert.equal(b.stateStore.health.writable,false);assert.equal(u.settings.automatic,false);
  let calls=0;await assert.rejects(b.once('fixture-request','send',{},()=>{calls++;}),/暂停/);await assert.rejects(a.key(),/暂停/);assert.equal(calls,0);
  for(const name of ['remote-access.json','bridge-state.json','update-settings.json'])assert.equal(fs.readFileSync(path.join(dir,name),'utf8'),'{broken');
});
test('durable JSON preserves legacy bytes, validates its replica, and preserves damaged primary on explicit repair',t=>{
  const file=path.join(folder(t),'settings.json'),raw='{ "value": 1 }';fs.writeFileSync(file,raw);
  const options={label:'Fixture',empty:{value:0}};const first=new DurableJson(file,options);assert.equal(fs.readFileSync(file,'utf8'),raw);first.write({value:2});
  fs.writeFileSync(file,'{bad');const second=new DurableJson(file,options);assert.equal(second.value.value,2);assert.equal(second.health.status,'recovered');assert.equal(fs.readFileSync(file,'utf8'),'{bad');
  second.write({value:3});assert.ok(fs.readdirSync(path.dirname(file)).some(f=>f.includes('.damaged-')));
  fs.writeFileSync(file,'{bad again');fs.writeFileSync(file+'.recovery.json','{bad backup');const third=new DurableJson(file,options);assert.equal(third.health.writable,false);assert.throws(()=>third.write({value:0}),/暂停/);
});
test('failed writes stop further mutations and recovered request records remain read-only',t=>{
  const file=path.join(folder(t),'requests.json');fs.writeFileSync(file,'{"requests":{"old":{"status":"outcome-unknown"}}}');
  const io=Object.create(fs);let fail=false;io.renameSync=(a,b)=>{if(fail&&b===file)throw Error('injected failure');return fs.renameSync(a,b);};
  const options={label:'Fixture',empty:{requests:{}},recoveryReadOnly:true,io};const first=new DurableJson(file,options);fail=true;
  assert.throws(()=>first.write({requests:{old:{status:'accepted'}}}),/未完成/);assert.equal(first.health.writable,false);
  const interrupted=new DurableJson(file,{...options,io:fs});assert.equal(interrupted.value.requests.old.status,'accepted');assert.equal(interrupted.health.writable,false);
  assert.equal(JSON.parse(fs.readFileSync(file)).requests.old.status,'outcome-unknown');
  fs.writeFileSync(file,'{bad');const recovered=new DurableJson(file,{...options,io:fs});assert.equal(recovered.value.requests.old.status,'accepted');assert.equal(recovered.health.writable,false);
});
test('diagnostic HTTP probes are read-only, redact responses, and reject changed endpoints',async t=>{
  let status=200,body={source:'official-desktop-IPC-live',connected:true,existingCodexWritable:true,bridgeVersion:'0.10.24',secret:'private-fixture',threads:{private:'fixture'}},hook=()=>{};
  const methods=[];const server=http.createServer((req,res)=>{methods.push(req.method+' '+req.url);assert.equal(req.headers.authorization,'Bearer fixture-key');hook();res.writeHead(status,{'Content-Type':'application/json'});res.end(typeof body==='string'?body:JSON.stringify(body));});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>server.close());
  let agent={id:'11111111-1111-4111-8111-111111111111',kind:'remote',host:'100.70.0.1',port:server.address().port,sealedKey:'cipher-fixture'};
  const agents={get:()=>agent,key:async()=> 'fixture-key'},probe=()=>diagnoseDevice(agents,agent.id,{resolve:async()=> '127.0.0.1'});
  let result=await probe();assert.equal(result.tcp,true);assert.equal(result.bridge.codexWritable,true);assert.ok(!JSON.stringify(result).includes('private'));
  status=401;result=await probe();assert.equal(result.failure,'authentication-failed');assert.equal(result.bridge,undefined);
  status=200;body={...body,connected:false};result=await probe();assert.equal(result.bridge.connected,false);
  body='{invalid';assert.equal((await probe()).failure,'invalid-response');
  body={connected:true,source:'another-server'};assert.equal((await probe()).failure,'invalid-response');
  body={connected:true,source:'official-desktop-IPC-live'};hook=()=>{agent={...agent,host:'100.70.0.2'};};assert.equal((await probe()).failure,'target-changed');
  assert.ok(methods.every(m=>m==='GET /bridge/v1/api/status'));
});
test('diagnostic copy whitelists even an untrusted projection and malformed capability arrays',()=>{
  const raw=diagnosticExport({checkedAt:'private-fixture',failure:'private-fixture',bridge:{bridgeVersion:'private-fixture',verifiedVersions:'private-fixture',storage:'private-fixture',secret:'private-fixture'}});
  assert.ok(!raw.includes('private-fixture'));assert.deepEqual(diagnosticStatus({storageHealth:{},desktopCompatibility:{verifiedVersions:{}}}).storage,[]);
});
test('a removed draft cleanup intent cannot dispatch after its persistence wait',async()=>{
  let release,calls=0;const gate=new Promise(resolve=>{release=resolve;});
  const discards=new DraftDiscards({persist:()=>gate,api:async()=>{calls++;return {status:'accepted',result:{disposition:'recovery-cleared'}};}});
  const context={agent:'fixture',id:'task',connected:true};discards.add(context,'recovery');const pending=discards.flush(context);discards.entries.clear();release();await pending;assert.equal(calls,0);
});
test('slow summary scans rotate without inheriting any earlier task flags',async()=>{
  let now=0;const calls=[],rows=Array.from({length:30},(_,i)=>({id:String(i+1).padStart(8,'0')+'-1111-4111-8111-111111111111',kind:'codex',status:'idle',hostId:'local'}));
  const bridge={desktop:{},requireConnection(){},threads:async()=>({data:{threads:rows}})};
  const reports=new TaskReports(bridge,{now:()=>now,stateFactory:()=>({supported:()=>true,connect:async()=>{},close(){},read:async id=>{calls.push(id);now+=2500;return {running:false,unread:true,runtimeKnown:true,readStateKnown:true,unknown:false};}})});
  const first=await reports.summary();assert.ok(first.threads.at(-1).unknown);let latest;
  for(let i=0;i<8;i++)latest=await reports.summary();assert.equal(new Set(calls).size,30);
  assert.ok(latest.threads.some(row=>row.unknown&&!row.unread));assert.equal(latest.complete,false);
});
test('removed or repointed devices quarantine text and original files while valid drafts remain scoped',()=>{
  const a={id:'11111111-1111-4111-8111-111111111111',name:'A',kind:'remote',host:'100.70.0.1',port:43128},b={...a,id:'22222222-2222-4222-8222-222222222222',name:'B',host:'100.70.0.2'},file=new File(['fixture'],'image.png',{type:'image/png'});
  const saved={agent:a.id,mode:'codex',thread:null,prompt:'A only',files:[file],drafts:[[a.id+':null','A only'],[b.id+':null','B only']],taken:[],settings:[],deviceBindings:[[a.id,{binding:draftBinding(a),name:'A'}]],questions:{drafts:[],done:[]}};
  for(const targets of [[b],[{...a,host:'100.70.0.3'},b]]){const result=protectRecovery(saved,targets);assert.equal(result.blockedActive,true);assert.equal(result.saved.prompt,'');assert.equal(result.saved.thread,null);assert.deepEqual(result.saved.drafts,[[b.id+':null','B only']]);const entries=orphanEntries(result.saved.orphanedDrafts[0]);assert.equal(entries.length,1);assert.equal(entries[0].taken.files[0].size,file.size);assert.equal(entries[0].text,'A only');}
  assert.equal(protectRecovery(saved,[a,b]).blockedActive,false);assert.equal(saved.prompt,'A only');
});
test('diagnostics distinguish network, authentication, official availability and capabilities without exporting tasks',()=>{
  const projected=diagnosticStatus({source:'official-desktop-IPC-live',connected:true,bridgeVersion:'0.10.24',desktopCompatibility:{detectedVersion:'26.903.8094.0',verifiedVersions:['26.903.8094.0']},existingCodexWritable:true,threads:{private:'content'},token:'fixture-secret',chat:{read:true},taskSummary:{schemaVersion:2,statePolicy:'official-only'}});
  const report={schemaVersion:1,resolved:true,tcp:true,httpStatus:200,bridge:projected};const raw=diagnosticExport(report);assert.ok(!raw.includes('private')&&!raw.includes('secret'));assert.equal(diagnosticChecks(report).find(c=>c.key==='official').status,'ok');
  assert.equal(diagnosticChecks({...report,bridge:null,httpStatus:401}).find(c=>c.key==='auth').status,'error');
  assert.equal(diagnosticChecks({...report,bridge:{...projected,connected:false}}).find(c=>c.key==='official').status,'error');
  assert.equal(diagnosticChecks({failure:'target-changed'})[0].key,'changed');
});
