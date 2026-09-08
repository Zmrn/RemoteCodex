import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { Bridge } from "../src/bridge.mjs";
import { startServer } from "../src/server.mjs";
import { modeCatalog, modeTaskKey, chatComposer } from "../public/modes.mjs";
const id = "11111111-1111-4111-8111-111111111111";
function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "chat-bridge-"));
  t.after(() => fs.rmSync(dir, { recursive: true }));
  const bridge = new Bridge(dir), calls = [];
  const data = { thread: { id, kind: "chatgpt", title: "Fixture Chat", status: {type:"idle"} }, turns: [{ id:"turn", status:"completed", items: [{id:"message",type:"agentMessage",text:"fixture"}] }] };
  bridge.connected = true;
  bridge.desktop = {
    identity: { officialPid: 123, appToolsPipe: { image: "OpenAI.Codex_26.901.6511.0_x64__fixture" } },
    catalog: ["read_thread","list_threads","send_message_to_thread"].map(name => ({namespace:"codex_app",name})),
    call: async (name, args) => { calls.push({name,args}); return name === "read_thread" ? structuredClone(data) : {threadId:id}; },
  };
  return { bridge, data, calls };
}
test("mode lists partition official kinds, deduplicate and never inject Codex probes into Chat", () => {
  const chat={id:"chat",kind:"chatgpt"}, codex={id:"codex",kind:"codex"};
  const catalog={pinnedThreads:[chat],threads:[chat,codex,{id:"unknown",kind:"unknown"}]};
  assert.deepEqual(modeCatalog(catalog,"chat",{probe:{title:"probe"}}),[chat]);
  assert.deepEqual(modeCatalog(catalog,"codex").map(x=>x.id),["codex"]);
  assert.notEqual(modeTaskKey("a",null,"chat"),modeTaskKey("a",null,"codex"));
  assert.equal(modeTaskKey("a",id,"codex"),"a:"+id);
  assert.notEqual(modeTaskKey("a",id,"chat"),modeTaskKey("b",id,"chat"));
});
test("Chat history completion never turns a live Chat into completed", async t => {
  const {bridge,data}=fixture(t); data.thread.status.type="active";
  bridge.live.set(id,{state:{turns:[]}}); // Cannot mix a stale Codex snapshot.
  const read=await bridge.read(id);
  assert.equal(read.data.thread.status.type,"active");
  assert.equal(read.data.turns[0].status,"history");
  assert.equal(read.live,null); assert.match(read.source,/renderer-status-poll/);
  assert.equal(data.turns[0].status,"completed");
  data.thread.status.type="systemError";
  assert.equal((await bridge.read(id)).data.thread.status.type,"error");
});
test("Chat same-ID text goes only through the official send tool; retries never replay", async t => {
  const {bridge,calls,data}=fixture(t);
  const r=await bridge.chatSend(id,"request-001","Fixture prompt");
  assert.equal(r.status,"accepted"); assert.equal(r.result.threadId,id);
  const sent=calls.filter(x=>x.name==="send_message_to_thread");
  assert.deepEqual(sent,[{name:"send_message_to_thread",args:{threadId:id,prompt:"Fixture prompt"}}]);
  data.thread.status.type="active";
  assert.equal((await bridge.chatSend(id,"request-001","Fixture prompt")).deduplicated,true);
  assert.equal(calls.length,2);
  const journal=fs.readFileSync(bridge.stateFile,"utf8"); assert.ok(!journal.includes("Fixture prompt"));
});
test("Chat blocks wrong kinds, unknown/active status, attachments, model overrides and unsupported builds", async t => {
  const {bridge,data,calls}=fixture(t);
  await assert.rejects(bridge.chatSend(id,"request-image","hi","data:image/png;base64,AAAA"),/暂不支持/);
  await assert.rejects(bridge.chatSend(id,"request-model","hi",null,{model:"fixture"}),/暂不支持/);
  data.thread.kind="codex";
  await assert.rejects(bridge.chatSend(id,"request-kind","hi"),/不是/);
  data.thread.kind="chatgpt";
  for (const type of ["active","unknown","systemError"]) {
    data.thread.status.type=type;
    await assert.rejects(bridge.chatSend(id,"request-"+type,"hi"),/状态未知/);
  }
  assert.ok(!calls.some(x=>x.name==="send_message_to_thread"));
  bridge.desktop.identity.appToolsPipe.image="OpenAI.Codex_other";
  assert.equal(bridge.chatCapabilities().sendText,false);
});
test("uncertain Chat sends remain deduplicated after reconnect or restart", async t => {
  const {bridge}=fixture(t); const original=bridge.desktop.call;
  let sends=0;
  bridge.desktop.call=async (name,args)=>{if(name==="send_message_to_thread"){sends++;throw Error("pipe lost");}return original(name,args);};
  await assert.rejects(bridge.chatSend(id,"request-uncertain","hi"),/pipe lost/);
  const restarted=new Bridge(bridge.dataDir); restarted.desktop=bridge.desktop; restarted.connected=true;
  const retry=await restarted.chatSend(id,"request-uncertain","hi");
  assert.equal(retry.status,"outcome-unknown"); assert.equal(sends,1);
});
test("Chat composer requires target capability and confirmed idle state", () => {
  const status={connected:true,chat:{sendText:true}}, thread={kind:"chatgpt",status:{type:"idle"}};
  assert.equal(chatComposer(status,thread).canSend,true);
  for(const state of ["active","unknown","error"]) assert.equal(chatComposer(status,{...thread,status:{type:state}}).canSend,false);
  assert.equal(chatComposer({connected:true},thread).writable,false);
  assert.equal(chatComposer({...status,connected:false},thread).canSend,false);
  assert.equal(chatComposer(status,null).canSend,false);
});
test("Chat HTTP dispatch cannot silently create Codex or pass through Codex models", async t => {
  const {bridge}=fixture(t); let created=0,sent=null;
  bridge.create=async()=>{created++;return {};};
  bridge.chatSend=async(...args)=>{sent=args;return {status:"accepted",result:{threadId:id}};};
  bridge.disconnect=()=>{};
  fs.writeFileSync(path.join(bridge.dataDir,"update-settings.json"),'{"automatic":false}');
  const {server,address}=await startServer({port:0,bridge});
  try {
    const html=await(await fetch(address)).text(),csrf=/name="bridge-csrf"\s+content="([^"]+)"/.exec(html)[1];
    const post=(url,body)=>fetch(address+url,{method:"POST",headers:{"X-Bridge-CSRF":csrf,"Content-Type":"application/json"},body:JSON.stringify(body)});
    const rejected=await post('/api/threads',{mode:"chat",prompt:"hi",requestId:"create-chat"});
    assert.equal(rejected.status,400);assert.equal(created,0);
    const sentResponse=await post('/api/threads/'+id+'/messages',{mode:"chat",prompt:"hi",requestId:"send-chat"});
    assert.equal(sentResponse.status,200);assert.equal(sent[0],id);
    const models=await(await fetch(address+'/api/models?mode=chat',{headers:{"X-Bridge-CSRF":csrf}})).json();
    assert.deepEqual(models.models,[]);assert.equal(models.supported,false);
  } finally {server.closeAllConnections();await new Promise(r=>server.close(r));}
});
