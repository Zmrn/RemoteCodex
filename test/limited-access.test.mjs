import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { EventEmitter } from "node:events";
import { startServer } from "../src/server.mjs";
import { startRemoteListener } from "../src/remote.mjs";
import { LimitedBridge } from "../src/limited-bridge.mjs";

const other = "11111111-1111-4111-8111-111111111111";
const created = "22222222-2222-4222-8222-222222222222";
const agents = { preserve: async () => {}, list: () => ({selectedId:"local", agents:[{id:"local",kind:"local",name:"Local"}]}), get: id => ({id}) };
const access = { status: () => ({}), start: async () => {}, close: () => {} };
class FakeBridge extends EventEmitter {
  constructor(dir) { super(); this.dataDir=dir; this.db={tests:{}}; this.taskReports={summary:async()=>({threads:[{id:other},{id:created}],complete:true})}; this.created=0; this.queue={clearRecovery:()=>{}}; }
  async connect() { this.connected=true; }
  disconnect() { this.connected=false; }
  status() { return {connected:this.connected,threads:{[other]:{status:"idle"},[created]:{status:"active"}},testThreads:{[other]:{title:"private"}}}; }
  async threads() { return {source:"fixture",data:{pinnedThreads:[{id:other,title:"private"}],threads:[{id:other,title:"private"},{id:created,title:"owned"}],privateMetadata:{title:"private"}}}; }
  async projects() { return {data:{projects:[{name:"private project"}]}}; }
  async read(id) { return {data:{thread:{id},turns:this.reply?[{reply:this.reply}]:[]}}; }
  async create(_key,_prompt,_settings,_project,_images,onCreated) { this.created++; onCreated?.(created); return {status:"accepted",result:{threadId:created}}; }
  guard() {}
  async nativeSend(id,_key,prompt) {
    this.reply="answer to "+prompt;
    queueMicrotask(()=>this.emit("event",{kind:"thread-state",threadId:id,status:{type:"idle",confirmed:true},ownerClientId:"private-owner"}));
    return {status:"accepted"};
  }
  async usage() { return {windows:[]}; }
}
const request = async (base, route, method="GET", body, bearer, csrf) => {
  const response = await fetch(base+route,{method,headers:{...(bearer?{Authorization:"Bearer "+bearer}:{}),...(csrf?{"X-Bridge-CSRF":csrf}:{}),...(body?{"Content-Type":"application/json"}:{})},body:body?JSON.stringify(body):undefined});
  const value = await response.json().catch(()=>null);
  return {status:response.status,value};
};
const openEvents = async (base, bearer, csrf) => {
  const controller=new AbortController();
  const response=await fetch(base+"/api/events",{headers:{...(bearer?{Authorization:"Bearer "+bearer}:{}),...(csrf?{"X-Bridge-CSRF":csrf}:{})},signal:controller.signal});
  assert.equal(response.status,200);
  const events=[];
  let ended=false;
  const pump=(async()=>{
    const reader=response.body.getReader(),decoder=new TextDecoder();
    let buffer="";
    try {
      for (;;) {
        const {done,value}=await reader.read();
        if(done)break;
        buffer+=decoder.decode(value,{stream:true});
        let pos;
        while((pos=buffer.indexOf("\n\n"))>=0){
          const frame=buffer.slice(0,pos);buffer=buffer.slice(pos+2);
          const line=frame.split("\n").find(part=>part.startsWith("data: "));
          if(line)events.push(JSON.parse(line.slice(6)));
        }
      }
    } catch(error) { if(!controller.signal.aborted)throw error; }
    finally {ended=true;reader.releaseLock();}
  })();
  return {events,get ended(){return ended},close:async()=>{controller.abort();await pump},pump};
};
const until=async condition=>{
  for(let n=0;n<100;n++) {if(condition())return;await new Promise(resolve=>setTimeout(resolve,20));}
  assert.fail("Timed out waiting for event stream");
};

test("Limit streams refresh owned replies without exposing another pairing or private event fields", async () => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),"remote-limit-events-"));
  const bridge=new FakeBridge(dir);
  const local=await startServer({port:0,bridge,agents,access});
  let remote,aStream,bStream,fullStream,resumed;
  try {
    const a=(await request(local.address,"/api/limited-access","POST",{name:"A"},null,local.secret)).value;
    const b=(await request(local.address,"/api/limited-access","POST",{name:"B"},null,local.secret)).value;
    remote=await startRemoteListener({host:"127.0.0.1",port:0,getKey:()=>"f".repeat(64),localPort:local.server.address().port,secret:local.secret,limitedAccess:local.limitedAccess});
    const base=`http://127.0.0.1:${remote.address().port}/bridge/v1`;
    await request(base,"/api/threads","POST",{requestId:"request-123",prompt:"hello"},a.code);
    local.limitedAccess.remember(b.id,other);
    [aStream,bStream,fullStream]=await Promise.all([openEvents(base,a.code),openEvents(base,b.code),openEvents(base,"f".repeat(64))]);
    await until(()=>[aStream,bStream,fullStream].every(stream=>stream.events.length===1));
    assert.deepEqual(Object.keys(aStream.events[0].threads),[created]);
    assert.deepEqual(Object.keys(bStream.events[0].threads),[other]);
    const sent=await request(base,"/api/threads/"+created+"/messages","POST",{requestId:"message-123",prompt:"question"},a.code);
    assert.equal(sent.status,200);
    await until(()=>aStream.events.length===2 && fullStream.events.length===2);
    assert.deepEqual(aStream.events[1],{kind:"thread-state",threadId:created,status:{type:"idle",confirmed:true}});
    assert.equal(JSON.stringify(aStream.events).includes("private-owner"),false);
    assert.equal(fullStream.events[1].ownerClientId,"private-owner");
    assert.equal(bStream.events.length,1);
    assert.deepEqual((await request(base,"/api/threads/"+created,"GET",null,a.code)).value.data.turns,[{reply:"answer to question"}]);
    bridge.emit("event",{kind:"thread-state",threadId:other,status:{type:"running",confirmed:true}});
    await until(()=>bStream.events.length===2);
    assert.equal(aStream.events.length,2);
    bridge.emit("event",{kind:"connected",officialPid:9999,connection:{private:"metadata"}});
    await until(()=>aStream.events.length===3&&bStream.events.length===3);
    assert.deepEqual(aStream.events[2],{kind:"connected"});
    assert.deepEqual(bStream.events[2],{kind:"connected"});
    const replacement=(await request(local.address,"/api/limited-access/rotate","POST",{id:a.id},null,local.secret)).value.code;
    await until(()=>aStream.ended);
    assert.equal((await request(base,"/api/status","GET",null,a.code)).status,401);
    resumed=await openEvents(base,replacement);
    await until(()=>resumed.events.length===1);
    assert.deepEqual(Object.keys(resumed.events[0].threads),[created]);
    await request(local.address,"/api/limited-access/revoke","POST",{id:a.id},null,local.secret);
    await until(()=>resumed.ended);
  } finally {
    await Promise.all([aStream,bStream,fullStream,resumed].filter(Boolean).map(stream=>stream.close()));
    remote?.closeAllConnections(); remote?.close();
    local.server.closeAllConnections(); await new Promise(resolve=>local.server.close(resolve));
    fs.rmSync(dir,{recursive:true,force:true});
  }
});

test("limited pairing gates target data and writes, shares only its own conversations, and revokes", async () => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),"remote-limit-"));
  const bridge=new FakeBridge(dir);
  const local=await startServer({port:0,bridge,agents,access});
  let remote;
  try {
    const a=(await request(local.address,"/api/limited-access","POST",{name:"Shared"},null,local.secret)).value;
    const b=(await request(local.address,"/api/limited-access","POST",{name:"Other"},null,local.secret)).value;
    assert.match(a.code,/^lrc1_[a-f0-9]{64}$/);
    assert.notEqual(a.code,b.code);
    remote=await startRemoteListener({host:"127.0.0.1",port:0,getKey:()=>"f".repeat(64),localPort:local.server.address().port,secret:local.secret,limitedAccess:local.limitedAccess});
    const base=`http://127.0.0.1:${remote.address().port}/bridge/v1`;
    const list=await request(base,"/api/threads","GET",null,a.code);
    assert.equal(list.status,200);
    assert.deepEqual(list.value.data.threads,[]);
    assert.deepEqual(list.value.data.pinnedThreads,[]);
    assert.equal(list.value.data.privateMetadata,undefined);
    assert.equal((await request(base,"/api/projects","GET",null,a.code)).status,403);
    assert.equal((await request(base,"/api/threads/"+other,"GET",null,a.code)).status,400);
    assert.equal((await request(base,"/api/threads/"+other+"/media?id=x","GET",null,a.code)).status,400);
    assert.equal((await request(base,"/api/threads","POST",{requestId:"request-123",prompt:"hello",project:{projectId:"secret"}},a.code)).status,400);
    assert.equal(bridge.created,0);
    const made=await request(base,"/api/threads","POST",{requestId:"request-123",prompt:"hello"},a.code);
    assert.equal(made.status,200);
    assert.equal(made.value.result.threadId,created);
    assert.equal((await request(base,"/api/threads/"+created,"GET",null,a.code)).status,200);
    assert.equal((await request(base,"/api/threads/"+created,"GET",null,b.code)).status,400);
    assert.deepEqual((await request(base,"/api/threads","GET",null,a.code)).value.data.threads.map(x=>x.id),[created]);
    assert.deepEqual((await request(base,"/api/task-summary","GET",null,a.code)).value.threads.map(x=>x.id),[created]);
    const status=(await request(base,"/api/status","GET",null,a.code)).value;
    assert.deepEqual(Object.keys(status.threads),[created]);
    assert.deepEqual(status.testThreads,{});
    assert.equal(status.projectCreation.local,false);
    assert.equal((await request(base,"/api/threads","GET",null,"f".repeat(64))).value.data.threads.length,2);
    assert.equal((await request(base,"/api/limited-access","GET",null,a.code)).status,404);
    const replacement=(await request(local.address,"/api/limited-access/rotate","POST",{id:a.id},null,local.secret)).value.code;
    assert.match(replacement,/^lrc1_[a-f0-9]{64}$/);
    assert.equal((await request(base,"/api/threads","GET",null,a.code)).status,401);
    assert.deepEqual((await request(base,"/api/threads","GET",null,replacement)).value.data.threads.map(x=>x.id),[created]);
    assert.equal((await request(local.address,"/api/limited-access/revoke","POST",{id:a.id},null,local.secret)).status,200);
    assert.equal((await request(base,"/api/threads","GET",null,replacement)).status,401);
    assert.equal((await request(base,"/api/threads/"+created,"GET",null,b.code)).status,400);
  } finally {
    remote?.closeAllConnections(); remote?.close();
    local.server.closeAllConnections(); await new Promise(resolve=>local.server.close(resolve));
    fs.rmSync(dir,{recursive:true,force:true});
  }
});

test("Limit controller has no local official bridge route", async () => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),"remote-limit-controller-"));
  const local=await startServer({port:0,edition:"limit",bridge:new LimitedBridge(dir),agents,access});
  try {
    assert.equal((await request(local.address,"/api/status","GET",null,null,local.secret)).status,403);
    assert.equal((await request(local.address,"/api/agents/local/bridge/status","GET",null,null,local.secret)).status,403);
    assert.equal((await request(local.address,"/api/agents","GET",null,null,local.secret)).value.agents.length,0);
  } finally {
    local.server.closeAllConnections(); await new Promise(resolve=>local.server.close(resolve));
    fs.rmSync(dir,{recursive:true,force:true});
  }
});
