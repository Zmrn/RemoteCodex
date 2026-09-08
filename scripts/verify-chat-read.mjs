// Reads only official Chat metadata/history, writes evidence without private text.
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { Bridge, ROOT } from "../src/bridge.mjs";
import { modeCatalog } from "../public/modes.mjs";
const dir=fs.mkdtempSync(path.join(ROOT,"work/chat-read-")),bridge=new Bridge(dir);
try{
 const identity=await bridge.connect(), list=await bridge.threads();
 const chats=modeCatalog(list.data,"chat");assert.ok(chats.length,'No official Chat records available');
 const target=chats[0],read=await bridge.readPage(target.id);
 assert.equal(read.data.thread.id,target.id);assert.equal(read.data.thread.kind,'chatgpt');
 assert.ok(read.data.turns.length);assert.equal(read.live,null);
 assert.ok(read.data.turns.every(t=>t.status==='history'));
 const evidence={observedAt:read.observedAt,officialPid:identity.officialPid,chatCount:chats.length,threadId:target.id,turnCount:read.data.turns.length,itemCount:read.data.turns.reduce((n,t)=>n+t.items.length,0),status:read.data.thread.status,source:read.source,capabilities:bridge.chatCapabilities(),mutations:0};
 fs.writeFileSync(path.join(dir,'result.json'),JSON.stringify(evidence,null,2));console.log(JSON.stringify(evidence,null,2));
}finally{bridge.disconnect();}
