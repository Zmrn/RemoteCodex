// Explicit, durable dedicated probe; never sends to the development task.
// Re-running checks the stored request ID instead of creating another turn.
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Bridge, ROOT } from "../src/bridge.mjs";
import { parseModels } from "../src/settings.mjs";
const dir=path.join(ROOT,"work/multi-image-official-probe");fs.mkdirSync(dir,{recursive:true});
const file=path.join(dir,"probe.json");
const probe=fs.existsSync(file)?JSON.parse(fs.readFileSync(file,"utf8")):{createKey:randomUUID(),sendKey:randomUUID()};
const save=()=>fs.writeFileSync(file,JSON.stringify(probe,null,2));save();
const b=new Bridge(path.join(dir,"bridge"));
async function until(fn){const end=Date.now()+120000;while(Date.now()<end){const r=await fn();if(r)return r;await new Promise(r=>setTimeout(r,900));}throw Error("Official probe timeout; inspect the existing probe before retrying");}
const result={source:"official-desktop-owner-IPC",time:new Date().toISOString()};
try{
  await b.connect();result.officialPid=b.desktop.identity.officialPid;
  if(!probe.id){const models=parseModels(b.desktop.catalog);const model=models.find(m=>m.id==="gpt-5.6-luna")??models.find(m=>m.efforts.includes("low"));assert.ok(model);const created=await b.create(probe.createKey,"只回复 READY。不要使用工具。",{model:model.id,effort:"low",permissionMode:"read-only"});probe.id=created.result?.threadId;assert.ok(probe.id);save();}
  b.guardProbe(probe.id);result.threadId=probe.id;
  await until(async()=> (await b.codexThread(probe.id)).thread.status.type==="idle");
  const urls=["multi-image-a.png","multi-image-b.png"].map(n=>"data:image/png;base64,"+fs.readFileSync(path.join(ROOT,"fixtures",n)).toString("base64"));
  const accepted=await b.nativeSend(probe.id,probe.sendKey,"不要使用工具。请按附件顺序分别说出两张图片的背景颜色，以及中间图形的形状和颜色，只回复两句话。",urls);
  assert.equal(accepted.status,"accepted");result.ownerClientId=accepted.result.handledByClientId;
  result.turnId=accepted.result.result?.result?.turn?.id;assert.ok(result.turnId);
  const r=await until(async()=>{const r=await b.read(probe.id);const turn=r.data.turns.find(t=>t.id===result.turnId);return turn?.status==="completed"&&turn.items.some(i=>i.type==="agentMessage")?r:null;});
  const turn=r.data.turns.find(t=>t.id===result.turnId);
  result.reply=turn.items.filter(i=>i.type==="agentMessage").map(i=>i.text).join("\n");
  assert.match(result.reply,/红|red/i);assert.match(result.reply,/蓝|blue/i);assert.match(result.reply,/白|white/i);assert.match(result.reply,/黄|yellow/i);
  assert.match(result.reply,/方|square/i);assert.match(result.reply,/圆|circle/i);
  result.images=2;result.result="passed";
}catch(e){result.result="failed";result.error=e.message;process.exitCode=1;}
finally{b.disconnect();fs.writeFileSync(path.join(dir,"result.json"),JSON.stringify(result,null,2));console.log(JSON.stringify(result));}
