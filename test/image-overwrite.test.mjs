import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { MessageMedia } from '../src/message-media.mjs';
import { compactConversation } from '../src/conversation-pages.mjs';

function fixture(t) {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'image-overwrite-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const file=path.join(dir,'预览.png'),media=new MessageMedia();
  const a=fs.readFileSync(new URL('../fixtures/multi-image-a.png',import.meta.url));
  const b=fs.readFileSync(new URL('../fixtures/multi-image-b.png',import.meta.url));
  const decorate=(id='message',label='预览')=>compactConversation(media.decorate('task',{turns:[{items:[{id,type:'agentMessage',text:`![${label}](<${file}>)`}]}]},{externalImages:true})).turns[0].items[0].bridgeDisplay.images[0];
  return {file,media,a,b,decorate};
}
test('overwriting a referenced local image keeps authorization ID but changes its presentation revision',t=>{
  const s=fixture(t);fs.writeFileSync(s.file,s.a);
  const first=s.decorate();assert.match(first.contentKey,/^[a-f0-9]{64}$/);
  assert.deepEqual(s.decorate(),first);
  assert.equal(s.decorate('message','new caption').contentKey,first.contentKey);
  fs.writeFileSync(s.file,s.b);
  const next=s.decorate('new-message');assert.equal(next.id,first.id);assert.notEqual(next.contentKey,first.contentKey);
  assert.deepEqual(s.media.read('task',next.id).bytes,s.b);
  assert.throws(()=>s.media.read('other-task',next.id),/未出现在/);
});
test('same length overwrite with restored mtime, atomic replacement, missing and recreated file invalidate old previews',t=>{
  const s=fixture(t),size=Math.max(s.a.length,s.b.length);
  const a=Buffer.concat([s.a,Buffer.alloc(size-s.a.length)]),b=Buffer.concat([s.b,Buffer.alloc(size-s.b.length)]);
  fs.writeFileSync(s.file,a);fs.utimesSync(s.file,1700000000,1700000000);
  const initial=s.decorate(),stat=fs.statSync(s.file),mtime=fs.statSync(s.file,{bigint:true}).mtimeNs;
  fs.writeFileSync(s.file,b);fs.utimesSync(s.file,stat.atime,stat.mtime);
  assert.equal(fs.statSync(s.file,{bigint:true}).mtimeNs,mtime);
  const overwritten=s.decorate('new-preview');assert.notEqual(overwritten.contentKey,initial.contentKey);
  const replacement=s.file+'.tmp';fs.writeFileSync(replacement,a);fs.renameSync(replacement,s.file);
  const replaced=s.decorate('new-preview');assert.notEqual(replaced.contentKey,overwritten.contentKey);
  fs.unlinkSync(s.file);const missing=s.decorate('new-preview');assert.notEqual(missing.contentKey,replaced.contentKey);assert.deepEqual(s.decorate('new-preview'),missing);
  assert.throws(()=>s.media.read('task',missing.id),/找不到原图/);
  fs.writeFileSync(s.file,b);const restored=s.decorate('new-preview');assert.notEqual(restored.contentKey,missing.contentKey);
  assert.deepEqual(s.media.read('task',restored.id).bytes,b);
});
test('a new official preview revalidates even when all filesystem metadata collides',t=>{
  const s=fixture(t);fs.writeFileSync(s.file,s.a);
  const stat=fs.statSync(s.file,{bigint:true});
  t.mock.method(fs,'statSync',()=>stat);
  const first=s.decorate('old-preview');fs.writeFileSync(s.file,s.b);
  const next=s.decorate('new-preview');assert.equal(next.id,first.id);
  assert.notEqual(next.contentKey,first.contentKey);
  assert.equal(s.decorate('new-preview','caption changes do not invent a new emission').contentKey,next.contentKey);
  assert.deepEqual(s.media.read('task',next.id).bytes,s.b);
});
test('re-reading a large preview checks file metadata without reading its bytes',t=>{
  const s=fixture(t);fs.writeFileSync(s.file,s.a);
  const read=t.mock.method(fs,'readFileSync',()=>{throw Error('history must not read image bytes');});
  const stat=t.mock.method(fs,'statSync');
  const item={type:'agentMessage',text:`![one](<${s.file}>)\n![two](<${s.file}>)`};
  const result=s.media.decorate('task',{turns:[{items:[item,item]}]});
  assert.equal(result.turns[0].items[0].bridgeDisplay.images.length,1);
  assert.equal(stat.mock.callCount(),1);assert.equal(read.mock.callCount(),0);
});
