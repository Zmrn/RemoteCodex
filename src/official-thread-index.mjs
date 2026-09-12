import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { OFFICIAL } from './official-protocol.mjs';
import { PYTHON } from './runtime.mjs';

const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
export async function readOfficialThreadIndex(home) {
  if (!home) return {status:'unavailable',threads:[]};
  return new Promise(resolve => {
    const child=execFile(PYTHON,['-X','utf8',fileURLToPath(new URL('./official_thread_index.py',import.meta.url))],
      {windowsHide:true,timeout:2500,maxBuffer:512*1024},(error,stdout)=>{
        try { const data=JSON.parse(stdout); resolve(!error && data.status==='available' && Array.isArray(data.threads)
          ? data : {status:'unavailable',threads:[]}); } catch { resolve({status:'unavailable',threads:[]}); }
      });
    child.stdin.on('error',()=>{});
    child.stdin.end(JSON.stringify({home,spec:{...OFFICIAL.storage.threadIndex,globalFile:OFFICIAL.storage.globalStateFile}}));
  });
}

// A new snapshot on each refresh; no local task catalog or status inference.
export function supplementOfficialThreads(data, index, limit=50) {
  if(index?.status!=='available') return data;
  const pinned=[...(data.pinnedThreads??[])], recent=[...(data.threads??[])];
  const ids=new Set([...pinned,...recent].map(t=>t.id));
  let added=0;
  for(const row of index.threads.slice(0,OFFICIAL.storage.threadIndex.maxRows)) {
    if(!uuid.test(row?.id??'') || ids.has(row.id) || row.projectId!=null && !uuid.test(row.projectId) ||
      !Number.isFinite(row.updatedAt) || row.title!=null && typeof row.title!=='string' || typeof row.cwd!=='string') continue;
    const thread={id:row.id,kind:'codex',hostId:OFFICIAL.discovery.hostId,projectId:row.projectId??null,
      title:row.title,updatedAt:row.updatedAt,cwd:row.cwd,status:'unknown',metadataSource:'official-local-index'};
    // The live list owns pin order; missing rows join recency until it supplies that order.
    recent.push(thread);ids.add(row.id);added++;
  }
  if(!added) return data;
  recent.sort((a,b)=>(b.updatedAt??0)-(a.updatedAt??0));
  return {...data,pinnedThreads:pinned,threads:recent.slice(0,Math.min(50,limit))};
}
