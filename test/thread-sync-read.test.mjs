import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {PYTHON} from '../src/runtime.mjs';
import {readOfficialThreadIndex,supplementOfficialThreads} from '../src/official-thread-index.mjs';
import {visibleOwnerReport,ownerReport} from '../src/visible-report.mjs';
import {markOfficialReportRead} from '../src/official-report-read.mjs';
import {TOOLS} from '../src/official-protocol.mjs';
const id='11111111-1111-4111-8111-111111111111',project='22222222-2222-4222-8222-222222222222';
const item={id:'reply',type:'agentMessage',text:'Visible latest reply'},turn={turnId:'turn',turnStartedAtMs:1000,status:'completed',items:[item]};
const state=()=>({id,threadRuntimeStatus:{type:'idle'},turns:[structuredClone(turn)]});
const thread={id,kind:'codex',hostId:'local',status:{type:'idle'}};
function sqlite(home,sql){execFileSync(PYTHON,['-X','utf8','-c','import sqlite3,sys,json;v=json.load(sys.stdin);d=sqlite3.connect(v["file"]);d.executescript(v["sql"]);d.close()'],{input:JSON.stringify({file:path.join(home,'state_5.sqlite'),sql}),windowsHide:true,stdio:['pipe','pipe','pipe']});}
test('official index adds an assigned task with an empty legacy title, without inventing runtime or unread state',async t=>{
 const home=fs.mkdtempSync(path.join(os.tmpdir(),'remote-index-项目-'));t.after(()=>fs.rmSync(home,{recursive:true,force:true}));
 sqlite(home,`CREATE TABLE threads(id TEXT,name TEXT,title TEXT,preview TEXT,cwd TEXT,updated_at INTEGER,source TEXT,is_pinned INTEGER,archived INTEGER,has_user_event INTEGER);
 INSERT INTO threads VALUES('${id}','官方创建的任务 🧩','','','C:/project',3,'vscode',0,0,0);`);
 fs.writeFileSync(path.join(home,'.codex-global-state.json'),JSON.stringify({'thread-project-assignments':{[id]:{projectKind:'local',projectId:project}}}));
 const before=fs.readFileSync(path.join(home,'state_5.sqlite'));
 const index=await readOfficialThreadIndex(home);assert.equal(index.status,'available');
 const view=supplementOfficialThreads({threads:[],pinnedThreads:[]},index);
 assert.equal(view.threads[0].title,'官方创建的任务 🧩');assert.equal(view.threads[0].projectId,project);
 assert.equal(view.threads[0].status,'unknown');assert.equal(view.threads[0].hasUnreadTurn,undefined);
 assert.deepEqual(fs.readFileSync(path.join(home,'state_5.sqlite')),before);
 sqlite(home,`UPDATE threads SET archived=1;`);assert.equal((await readOfficialThreadIndex(home)).threads.length,0);
 sqlite(home,`UPDATE threads SET archived=0,source='{"subAgent":{}}';`);assert.equal((await readOfficialThreadIndex(home)).threads.length,0);
 sqlite(home,`UPDATE threads SET source='vscode';`);fs.writeFileSync(path.join(home,'.codex-global-state.json'),'{}');assert.equal((await readOfficialThreadIndex(home)).threads.length,0);
 fs.writeFileSync(path.join(home,'.codex-global-state.json'),'bad');assert.equal((await readOfficialThreadIndex(home)).status,'unavailable');
});
test('supplement keeps official live rows and pin order, bounds recent rows and never retains old supplemental entries',()=>{
 const live={threads:[{id,title:'Live',status:'active',updatedAt:1}],pinnedThreads:[{id:project,title:'Pinned'}]};
 const index={status:'available',threads:[{id,title:'Index stale',cwd:'C:/p',updatedAt:5,projectId:project}]};
 assert.deepEqual(supplementOfficialThreads(live,index),live);
 assert.deepEqual(supplementOfficialThreads(live,{status:'unavailable',threads:[]}),live);
 assert.deepEqual(supplementOfficialThreads({threads:[],pinnedThreads:[]},{status:'available',threads:[]}).threads,[]);
 assert.equal(supplementOfficialThreads({threads:[],pinnedThreads:[]},index,0).threads.length,0);
});
test('rollout display earns a receipt only from the exact latest live reply, not historical completion',()=>{
 const live={owner:'owner',state:state()},display={thread,turns:[{id:'turn',status:'history',items:[structuredClone(item)]}]};
 assert.ok(visibleOwnerReport(display,live));
 for(const change of [d=>d.turns[0].items[0].text='old',d=>d.turns[0].id='old',d=>d.thread={...thread,id:project},d=>d.turns[0].items=[]]){
  const d=structuredClone(display);change(d);assert.equal(visibleOwnerReport(d,live),null);
 }
 live.state.threadRuntimeStatus.type='active';assert.equal(visibleOwnerReport(display,live),null);
 live.state=state();live.state.turns.push({...turn,turnId:'new',turnStartedAtMs:2000,items:[]});assert.equal(visibleOwnerReport(display,live),null);
 assert.equal(visibleOwnerReport(display,null),null);
});
test('mark-read uses live metadata and a newly received owner report even when whole history exceeds the official frame limit',async()=>{
 let marked=true, sends=0,historyReads=0;
 const desktop={identity:{},call:async method=>{if(method===TOOLS.listThreads)return{threads:[thread]};historyReads++;throw Error('native pipe message exceeds frame limit');},
  ipc:{broadcast(){sends++;marked=false;}}};
 const b={desktop,requireConnection(){},live:new Map([[id,{owner:'owner',state:state()}]]),follow:async()=>{b.live.set(id,{owner:'owner',state:state()});return{handledByClientId:'owner'};}};
 const token=ownerReport(thread,state()).receipt.token;
 const opts={reader:{supported:()=>true,context:async()=>({identity:{},executionHostKey:'local'}),marked:async()=>marked},sleep:async()=>{},attempts:1,snapshotAttempts:1};
 assert.equal((await markOfficialReportRead(b,id,token,opts)).status,'synced');assert.equal(sends,1);assert.equal(historyReads,0);
 marked=true;b.follow=async()=>({handledByClientId:'owner'});
 assert.equal((await markOfficialReportRead(b,id,token,opts)).status,'unavailable');assert.equal(sends,1);
});
