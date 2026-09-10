// Explicitly selected real task, read-only; output contains counts, never message bodies.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { Bridge, ROOT } from '../src/bridge.mjs';
const id = process.argv[2]; assert.match(id ?? '',/^[a-f0-9-]{36}$/);
const directory = fs.mkdtempSync(path.join(ROOT,'work/rollout-live-'));
fs.writeFileSync(path.join(directory,'update-settings.json'),'{"automatic":false}');
const bridge = new Bridge(directory), start = Date.now(), seen = new Set();
try {
 await bridge.connect();
 const first = await bridge.readPage(id), pages = [first];
 assert.equal(first.source,'official-local-rollout-read-only');
 assert.equal(first.reportReceipt,null);
 const headMs = Date.now()-start;
 let next = first.data.page.nextCursor, image = null, duplicates = 0;
 const inspect = page => {
   for (const turn of page.data.turns) for (const item of turn.items) {
     const key=turn.id+':'+item.id; if (seen.has(key))duplicates++; seen.add(key);
     for (const ref of item.bridgeDisplay?.images??[]) {
       if (bridge.media.deferred.has(id+':'+ref.id) && !image) {
         const loaded = bridge.media.read(id,ref.id); image={bytes:loaded.bytes.length,type:loaded.type};
       }
     }
   }
 };
 inspect(first);
 for (let n=0; next && n<63; n++) {
   const page = await bridge.readPage(id,next); inspect(page); pages.push(page); next=page.data.page.nextCursor;
 }
 const refreshed = await bridge.readPage(id);
 assert.equal(refreshed.data.history.revision,first.data.history.revision);
 assert.deepEqual(refreshed.data.turns.flatMap(t=>t.items.map(i=>i.id)),first.data.turns.flatMap(t=>t.items.map(i=>i.id)));
 assert.equal(duplicates,0); assert.ok(seen.size>40); assert.ok(image); assert.equal(next,null);
 const report = {result:'PASS',officialVersion:bridge.status().desktopCompatibility.detectedVersion,headMs,pages:pages.length,
   visibleItems:seen.size,duplicates,image,largestResponseBytes:Math.max(...pages.map(p=>Buffer.byteLength(JSON.stringify(p)))),
   refreshSameContent:true,reportReceiptIssued:false,officialTaskWrites:0,apkExecuted:false};
 fs.writeFileSync(path.join(directory,'result.json'),JSON.stringify(report,null,2)); console.log(JSON.stringify({...report,evidence:directory}));
} finally { bridge.disconnect(); }
