import {modeTaskKey,normalizeMode} from './modes.mjs';
export const draftBinding=agent=>agent?JSON.stringify([agent.id,agent.kind,String(agent.host??'').toLowerCase(),agent.kind==='local'?null:agent.port]):null;
// Keep complete original records separately; never move a draft by falling back
// to another selected device. These are user drafts, not official task state.
export function protectRecovery(input,agents){
  if(!input)return {saved:null,blockedActive:false};
  const saved=structuredClone(input),bindings=new Map(saved.deviceBindings??[]),ids=new Set([saved.agent,...(saved.drafts??[]).map(([key])=>key.split(':')[0]),...(saved.taken??[]).map(([key])=>key.split(':')[0])].filter(Boolean));
  const invalid=new Set([...ids].filter(id=>{const agent=agents.find(a=>a.id===id);return !agent||(bindings.has(id)&&bindings.get(id).binding!==draftBinding(agent));}));
  const orphans=[...(saved.orphanedDrafts??[])];
  for(const id of invalid){
    const original=structuredClone(saved);delete original.orphanedDrafts;
    const active=saved.agent===id;
    if((active&&(saved.prompt||saved.files?.length||saved.file))||(saved.drafts??[]).some(([key,text])=>key.startsWith(id+':')&&text)||(saved.taken??[]).some(([key])=>key.startsWith(id+':')))
      orphans.push({id:crypto.randomUUID(),agent:id,name:bindings.get(id)?.name??'原设备',reason:agents.some(a=>a.id===id)?'设备连接地址已变化':'原设备已移除',snapshot:original});
    bindings.delete(id);
  }
  const keep=key=>!invalid.has(String(key).split(':')[0]);
  for(const field of ['drafts','taken','settings','modeSelections','creationProjects'])saved[field]=(saved[field]??[]).filter(([key])=>keep(key));
  saved.discardedRecoveries=(saved.discardedRecoveries??[]).filter(r=>!invalid.has(r.agent));
  if(saved.questions)saved.questions={drafts:(saved.questions.drafts??[]).filter(([key])=>keep(key)),done:(saved.questions.done??[]).filter(keep)};
  const blockedActive=invalid.has(saved.agent);
  if(blockedActive){saved.agent=null;saved.thread=null;saved.prompt='';saved.files=[];delete saved.file;}
  saved.deviceBindings=[...bindings];saved.orphanedDrafts=orphans;
  return {saved,blockedActive};
}
export function orphanEntries(orphan){
  const s=orphan.snapshot,drafts=new Map(s.drafts??[]),taken=new Map(s.taken??[]);
  if(s.agent===orphan.agent){const key=modeTaskKey(s.agent,s.thread,s.mode);drafts.set(key,s.prompt??'');taken.set(key,{...(taken.get(key)??{}),files:s.files??(s.file?[s.file]:[])});}
  const keys=new Set([...drafts.keys(),...taken.keys()]);
  return [...keys].filter(key=>key.startsWith(orphan.agent+':')).map(key=>({key,text:drafts.get(key)??taken.get(key)?.message?.text??'',taken:taken.get(key),mode:key===modeTaskKey(s.agent,s.thread,s.mode)?normalizeMode(s.mode):key.endsWith(':chat:null')?'chat':null}))
    .filter(row=>row.text||row.taken?.files?.length||row.taken?.file||row.taken?.message);
}
