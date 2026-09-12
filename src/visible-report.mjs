import { liveTurns } from './state.mjs';
import { reportReceipt } from './task-reports.mjs';

// The current owner alone supplies completion and the latest report identity.
export function ownerReport(thread, state) {
  if(thread?.kind!=='codex' || thread.id!==state?.id || state.threadRuntimeStatus?.type!=='idle') return null;
  const latest=liveTurns(state).at(-1);
  if(!latest || !Array.isArray(latest.items)) return null;
  const data={thread:{...thread,status:state.threadRuntimeStatus},turns:[{
    id:latest.turnId,status:latest.status,startedAt:latest.turnStartedAtMs/1000,items:latest.items}]};
  const receipt=reportReceipt(data);
  return receipt ? {data,receipt,turn:data.turns[0],item:latest.items.find(i=>i.id===receipt.itemId)} : null;
}

// Disk history is display-only. It cannot create a receipt without matching
// the full text, item and turn of the latest live owner's reply.
export function visibleOwnerReport(display, live) {
  if(!live?.owner) return null;
  const report=ownerReport(display.thread,live.state);
  if(!report) return null;
  const item=display.turns?.find(t=>t.id===report.turn.id)?.items?.find(i=>i.id===report.item.id);
  return item?.type==='agentMessage' && item.text===report.item.text ? report : null;
}
