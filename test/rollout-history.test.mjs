import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { RolloutHistory } from '../src/rollout-history.mjs';
import { MessageMedia } from '../src/message-media.mjs';
import { ConversationPages, compactConversation } from '../src/conversation-pages.mjs';
import { mergeTurns } from '../public/conversation-history.mjs';
import { readOfficialHistory } from '../src/history-read.mjs';
import { Bridge } from '../src/bridge.mjs';
const id='11111111-2222-4333-8444-555555555555', a='aaaaaaaa-2222-4333-8444-555555555555', b='bbbbbbbb-2222-4333-8444-555555555555';
const thread={id,kind:'codex',hostId:'local',title:'History',status:'active'};
const png='data:image/png;base64,'+Buffer.from([137,80,78,71,13,10,26,10,0,0]).toString('base64');
const record=(payload,type='event_msg')=>({timestamp:'2026-09-10T12:00:00Z',type,payload});
const meta=()=>record({id},'session_meta');
const item=(n,turn=a)=>record({type:'item_completed',thread_id:id,turn_id:turn,item:{type:'AgentMessage',id:'msg-'+n,content:[{type:'Text',text:'Reply '+n}]}});
function setup(t,rows) {
 const home=fs.mkdtempSync(path.join(os.tmpdir(),'remote-rollout-test-'));
 const dir=path.join(home,'sessions','2026','09','10'); fs.mkdirSync(dir,{recursive:true});
 const file=path.join(dir,'rollout-2026-09-10T12-00-00-'+id+'.jsonl');
 fs.writeFileSync(file,[meta(),...rows].map(r=>JSON.stringify(r)+'\n').join(''));
 t.after(()=>fs.rmSync(home,{recursive:true,force:true}));
 const reader=new RolloutHistory(), media=new MessageMedia();
 return {home,file,reader,media,read:options=>reader.read({home,thread,media,...options})};
}
test('large raw payload does not block bounded text pages or copy images into the response',async t=>{
 const s=setup(t,[record({type:'custom_tool_call_output',output:'x'.repeat(9*1024*1024)},'response_item'),
   record({type:'item_completed',thread_id:id,turn_id:a,item:{type:'Extension',kind:'image_gen.generation',id:'picture',result:png}}),
   ...Array.from({length:90},(_,n)=>item(n))]);
 const pages=new ConversationPages(), read=async cursor=>({data:compactConversation(s.media.decorate(id,await s.read({cursor}),{externalImages:true})),live:null,reportReceipt:null});
 let page=await pages.read(id,null,read), turns=[], count=0, cursor;
 do {
   assert.ok(Buffer.byteLength(JSON.stringify(page))<128*1024);
   assert.ok(!JSON.stringify(page).includes(png));
   assert.equal(page.data.thread.status.type,'active');
   assert.ok(page.data.turns.every(t=>t.status==='history'));
   turns=mergeTurns(turns,page.data.turns,count>0); count++;
   cursor=page.data.page.nextCursor; if(cursor)page=await pages.read(id,cursor,read);
 } while(cursor);
 assert.equal(turns[0].items.length,91); assert.equal(new Set(turns[0].items.map(i=>i.id)).size,91);
 const image=turns[0].items.find(i=>i.id==='picture').bridgeDisplay.images[0];
 assert.equal(s.media.read(id,image.id).type,'image/png');
 assert.throws(()=>s.media.read(b,image.id),/图片未出现/);
 assert.equal(s.media.inlineBytes,0);
});
test('changed official files invalidate both older cursors and lazy image references',async t=>{
 const s=setup(t,[...Array.from({length:55},(_,n)=>item(n)),record({type:'item_completed',thread_id:id,turn_id:a,item:{type:'Extension',kind:'image_gen.generation',id:'picture',result:png}})]);
 const first=await s.read({}), image=first.turns[0].items.find(i=>i.id==='picture').bridgeHistoryImages[0];
 const snapshot=fs.readFileSync(s.file); fs.appendFileSync(s.file,JSON.stringify(item(99))+'\n');
 assert.throws(()=>s.media.read(id,image.id),/历史已变化/);
 await assert.rejects(s.read({cursor:first.page.nextCursor}),/历史已变化/);
 const second=await s.read({}); assert.notEqual(second.history.revision,first.history.revision);
 assert.ok(second.turns[0].items.some(i=>i.id==='msg-99'));
 // Replacing/truncating cannot reuse a same-task, old cursor either.
 fs.writeFileSync(s.file,snapshot.subarray(0,80)); await assert.rejects(s.read({cursor:second.page.nextCursor}));
});
test('identity, host and symlink checks prevent reading another task or arbitrary paths',async t=>{
 const s=setup(t,[item(1)]);
 await assert.rejects(s.reader.read({home:s.home,thread:{...thread,hostId:'remote'},media:s.media}),/本机/);
 await assert.rejects(s.reader.read({home:s.home,thread:{...thread,kind:'chatgpt'},media:s.media}),/本机/);
 fs.writeFileSync(s.file,JSON.stringify(record({id:b},'session_meta'))+'\n'+JSON.stringify(item(1))+'\n');
 await assert.rejects(s.read({}),/身份不一致/);
 fs.renameSync(path.join(s.home,'sessions'),path.join(s.home,'outside'));
 fs.symlinkSync(path.join(s.home,'outside'),path.join(s.home,'sessions'),'junction');
 await assert.rejects(s.read({}),/唯一确认/);
});
test('malformed completed records are reported; an in-progress final line is never displayed',async t=>{
 const s=setup(t,[item(1)]);
 fs.appendFileSync(s.file,'{"type":"event_msg","payload":');
 const head=await s.read({}); assert.equal(head.turns[0].items.length,1);
 fs.appendFileSync(s.file,'\n'); await assert.rejects(s.read({}),/无法解析/);
});
test('official rollback removes historical members and never supplies a live completion flag',async t=>{
 const s=setup(t,[item(1,a),item(2,b),record({type:'thread_rolled_back',num_turns:1})]);
 const head=await s.read({}); assert.deepEqual(head.turns.map(t=>t.id),[a]);
 assert.equal(head.turns[0].status,'history'); assert.equal(head.thread.status.type,'active');
});
test('a failed older official page starts strictly before its known turn boundary',async t=>{
 const s=setup(t,[item(1,a),item(2,b)]);
 const head=await s.read({beforeTurnId:b}); assert.deepEqual(head.turns.map(t=>t.id),[a]);
 await assert.rejects(s.read({beforeTurnId:id}),/无法对齐/);
});
test('fallback is display-only, respects cursor anchors and does not intercept unrelated failures',async()=>{
 const desktop={call:async(_tool,args)=>{
   if(!args.cursor)return {thread,turns:[{id:b,items:[]}],page:{nextCursor:'official-old'}};
   throw Error('Codex app tool request failed');
 }};
 const calls=[],fallback=async x=>{calls.push(x);return {thread,turns:[],page:{}};};
 await readOfficialHistory(desktop,id,null,2,()=>{},fallback);
 await readOfficialHistory(desktop,id,'official-old',2,()=>{},fallback);
 assert.equal(calls[0].beforeTurnId,b);
 await assert.rejects(readOfficialHistory(desktop,id,'unobserved',2,()=>{},fallback),/无法对齐/);
 await assert.rejects(readOfficialHistory(desktop,id,'official-old',2,()=>{}),/读取接口/);
 await assert.rejects(readOfficialHistory({call:async()=>{throw Error('Forbidden');}},id,null,2,()=>{},fallback),/Forbidden/);
 assert.equal(calls.length,1);
});
test('Bridge viewer recovers content; full operational reads stay on the official tool and issue no receipt',async t=>{
 const s=setup(t,Array.from({length:65},(_,n)=>item(n))), desktop={identity:{officialPid:7},call:async tool=>{
   if(tool==='list_threads')return {threads:[thread]};
   throw Error('Codex app tool request failed');
 }};
 const bridge=new Bridge(path.join(s.home,'bridge')); t.after(()=>bridge.disconnect());
 bridge.desktop=desktop; bridge.connected=true; desktop.close=()=>{};
 bridge.officialStorage={desktop,identity:desktop.identity,home:s.home};
 const page=await bridge.readPage(id);
 assert.equal(page.source,'official-local-rollout-read-only'); assert.equal(page.reportReceipt,null);
 assert.equal(page.data.turns[0].items.at(-1).text,'Reply 64');
 await bridge.readPage(id,page.data.page.nextCursor);
 fs.appendFileSync(s.file,JSON.stringify(item(99))+'\n');
 await assert.rejects(bridge.readPage(id,page.data.page.nextCursor),/历史已变化/);
 await assert.rejects(bridge.read(id),/读取接口/);
 bridge.connected=false; await assert.rejects(bridge.readPage(id),/connection-interrupted/);
});
