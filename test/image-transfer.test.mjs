import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { MessageMedia, messageLocalPath } from '../src/message-media.mjs';
import { imageTransfer, imageFailure } from '../public/image-transfer.mjs';

test('official /C:/ Markdown images and files read original bytes without admitting UNC or relative paths', {skip:process.platform !== 'win32'}, t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'media-path-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const png = fs.readFileSync(new URL('../fixtures/multi-image-a.png', import.meta.url));
  const file = path.join(dir, '原图 space.png'), attachment = path.join(dir, 'notes.md');
  fs.writeFileSync(file,png); fs.writeFileSync(attachment,'notes');
  const media = new MessageMedia(), link = '/'+file.replaceAll('\\','/');
  const result = media.decorate('one',{turns:[{items:[{type:'agentMessage',text:`![原图](<${link}>)\n[notes](/${attachment.replaceAll('\\','/')})`}]}]});
  const item=result.turns[0].items[0].bridgeDisplay;
  assert.equal(item.images.length,1); assert.equal(item.files.length,1);
  assert.deepEqual(media.read('one',item.images[0].id).bytes,png);
  assert.throws(()=>media.read('other',item.images[0].id),/未出现/);
  const opened=media.openFile('one',item.files[0].id);
  try { assert.equal(fs.readFileSync(opened.fd,'utf8'),'notes'); } finally {fs.closeSync(opened.fd);}
  for(const source of ['//server/share/image.png','\\\\?\\C:\\secret.png','relative.png']) assert.equal(media.add('one',source),null);
  assert.equal(messageLocalPath('/C:/a%20b.png'),'C:/a%20b.png');
  fs.unlinkSync(file); assert.throws(()=>media.read('one',item.images[0].id),/找不到原图/);
});

test('download progress follows actual bytes, shares observers and completes only after the stream',async()=>{
  let stream; const response=new Response(new ReadableStream({start(c){stream=c;}}),{headers:{'content-length':'4','content-type':'image/png'}});
  const transfer=imageTransfer(()=>response), first=[],second=[];
  const unsubscribe=transfer.subscribe(p=>first.push({...p}));
  await new Promise(r=>setImmediate(r)); stream.enqueue(new Uint8Array([1,2]));
  await new Promise(r=>setImmediate(r));assert.deepEqual(first.at(-1),{phase:'downloading',loaded:2,total:4});
  transfer.subscribe(p=>second.push({...p}));unsubscribe();
  stream.enqueue(new Uint8Array([3,4]));stream.close();
  assert.deepEqual([...new Uint8Array(await (await transfer.promise).arrayBuffer())],[1,2,3,4]);
  assert.equal(first.at(-1).loaded,2); assert.deepEqual(second.at(-1),{phase:'decoding',loaded:4,total:4});
});
test('unknown or compressed lengths remain unknown and partial bodies reject for a fresh retry',async()=>{
  for(const headers of [{},{'content-encoding':'gzip','content-length':'1'}]){
    const progress=[];const transfer=imageTransfer(()=>new Response('abc',{headers}));transfer.subscribe(p=>progress.push(p));
    await transfer.promise;assert.equal(progress.at(-1).total,null);assert.equal(progress.at(-1).loaded,3);
  }
  await assert.rejects(imageTransfer(()=>new Response('abc',{headers:{'content-length':'9'}})).promise,/数据不完整/);
  await assert.rejects(imageTransfer(()=>new Response(new ReadableStream({start(c){c.error(Error('stream dropped'));}}))).promise,/stream dropped/);
});
test('media errors show useful bounded explanations, never render an HTML error page',async()=>{
  await assert.rejects(imageTransfer(()=>new Response(JSON.stringify({error:'图片未出现在已读取的此会话中，请刷新会话'}),{status:400,headers:{'content-type':'application/json'}})).promise,/请刷新会话/);
  await assert.rejects(imageTransfer(()=>new Response('<script>bad</script>',{status:502})).promise,/HTTP 502/);
  await assert.rejects(imageTransfer(()=>new Response('x'.repeat(20000),{status:500,headers:{'content-type':'application/json'}})).promise,/HTTP 500/);
  assert.match(imageFailure(new DOMException('expired','TimeoutError')),/超时/);
  assert.match(imageFailure(new TypeError('Failed to fetch')),/连接中断/);
  assert.match(imageFailure(Error('ENOENT private path')),/找不到原图/);
});
