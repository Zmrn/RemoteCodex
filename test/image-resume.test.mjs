import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createHash } from 'node:crypto';
import { imageTransfer, ImagePartials } from '../public/image-transfer.mjs';
import { mediaResponse } from '../src/media-response.mjs';
import { relay } from '../src/remote.mjs';
const tag = bytes => '"sha256-' + createHash('sha256').update(bytes).digest('hex') + '"';
const tick = () => new Promise(r => setImmediate(r));
const data = Buffer.from('0123456789abcdefghijklmnopqrstuvwxyz');
const checkpoint = bytes => ({chunks:[bytes.subarray(0,10)],loaded:10,total:bytes.length,etag:tag(bytes),type:'image/png'});

test('broken real HTTP transfer resumes exact bytes through both relay hops with current strong validator', async t => {
  let interrupted = true, sent = 0; const calls = [], servers = [];
  async function listen(fn) {
    const s = http.createServer(fn); servers.push(s);
    await new Promise(r => s.listen(0,'127.0.0.1',r)); return s.address().port;
  }
  t.after(()=>{for(const s of servers){s.closeAllConnections();s.close();}});
  const source = await listen((req,res) => {
    calls.push({...req.headers});
    if (interrupted) {
      res.writeHead(200,{'content-type':'image/png','content-length':data.length,etag:tag(data),'accept-ranges':'bytes'});
      res.write(data.subarray(0,10)); sent += 10;
      setTimeout(()=>res.destroy(),40);
    } else { sent += data.length - 10; mediaResponse(req,res,{bytes:data,type:'image/png',name:'fixture.png'}); }
  });
  const first = await listen((req,res)=>relay(req,res,{hostname:'127.0.0.1',port:source,route:req.url,headers:{'X-Bridge-CSRF':'synthetic'}}));
  const second = await listen((req,res)=>relay(req,res,{hostname:'127.0.0.1',port:first,route:req.url,headers:{Authorization:'Bearer synthetic'}}));
  const url = 'http://127.0.0.1:'+second+'/api/threads/11111111-2222-4333-8444-555555555555/media?id=fixture';
  const request = options => fetch(url,options), cache = new ImagePartials();
  await assert.rejects(imageTransfer(request,{savePartial:p=>cache.set('a',p)}).promise,/已保留 27%/);
  assert.equal(cache.get('a').loaded,10); interrupted = false;
  const progress=[], transfer=imageTransfer(request,{partial:cache.get('a'),savePartial:p=>cache.set('a',p)});
  transfer.subscribe(p=>progress.push(p));
  assert.deepEqual(Buffer.from(await (await transfer.promise).arrayBuffer()),data);
  assert.equal(sent,data.length); assert.equal(calls.length,2);
  assert.equal(calls[1].range,'bytes=10-'); assert.equal(calls[1]['if-range'],tag(data));
  assert.equal(cache.get('a'),undefined); assert.equal(progress[0].loaded,10);
});

test('source changed or old target returns 200: discard old prefix and decode only current full bytes',async()=>{
  for (const current of [Buffer.from(data).reverse(), data]) {
    const result = imageTransfer(({headers})=>{
      assert.equal(headers.Range,'bytes=10-');
      return new Response(current,{headers:{'content-type':'image/png','content-length':current.length,etag:tag(current)}});
    },{partial:checkpoint(data)});
    assert.deepEqual(Buffer.from(await (await result.promise).arrayBuffer()),current);
  }
});

test('wrong range, length, hash or encoding never joins mismatched partial data',async()=>{
  for(const changed of ['start','total','etag','length','encoding','hash']){
    let saved=checkpoint(data);
    const headers={'content-type':'image/png','content-length':data.length-10,etag:tag(data),'content-range':'bytes 10-35/36'};
    if(changed==='start')headers['content-range']='bytes 11-35/36';
    if(changed==='total')headers['content-range']='bytes 10-35/37';
    if(changed==='etag')headers.etag=tag(Buffer.from('other'));
    if(changed==='length')headers['content-length']='25';
    if(changed==='encoding')headers['content-encoding']='gzip';
    const body=Buffer.from(data.subarray(10)); if(changed==='hash')body[0]^=1;
    await assert.rejects(imageTransfer(()=>new Response(body,{status:206,headers}),{
      partial:saved,savePartial:p=>saved=p,
    }).promise,/校验失败/);
    assert.equal(saved,null,changed);
  }
});

test('active slow transfers outlive idle limit; a real idle gap preserves prefix for retry',async()=>{
  let c, saved;
  const transfer=imageTransfer(()=>new Response(new ReadableStream({start(x){c=x;}}),{
    headers:{'content-type':'image/png','content-length':data.length,etag:tag(data)},
  }),{idleTimeoutMs:150,savePartial:p=>saved=p});
  await tick();
  for(let i=0;i<4;i++){ c.enqueue(data.subarray(i*9,i*9+9)); await new Promise(r=>setTimeout(r,65)); }
  c.close();assert.deepEqual(Buffer.from(await (await transfer.promise).arrayBuffer()),data);
  const stalled=imageTransfer(()=>new Response(new ReadableStream({start(x){x.enqueue(data.subarray(0,10));}}),{
    headers:{'content-type':'image/png','content-length':data.length,etag:tag(data)},
  }),{idleTimeoutMs:40,savePartial:p=>saved=p});
  await assert.rejects(stalled.promise,/超时.*已保留/); assert.equal(saved.loaded,10);
});

test('cancel retains validated bytes; no validator never retains; cache isolates targets and bounds memory/age',async()=>{
  for(const etag of [tag(data),'"path-only"',null]){
    let saved, c; const abort=new AbortController();
    const transfer=imageTransfer(()=>new Response(new ReadableStream({start(x){c=x;}}),{
      headers:{'content-length':data.length,...(etag?{etag}:{}),'content-type':'image/png'},
    }),{signal:abort.signal,savePartial:p=>saved=p});
    await tick(); c.enqueue(data.subarray(0,10)); await tick(); abort.abort();
    await assert.rejects(transfer.promise);
    assert.equal(saved?.loaded??0,etag===tag(data)?10:0);
  }
  const cache=new ImagePartials({maxBytes:15});
  cache.set('device-a/task/image',checkpoint(data));assert.equal(cache.get('device-b/task/image'),undefined);
  cache.set('device-b/task/image',checkpoint(data));assert.equal(cache.get('device-a/task/image'),undefined);
  cache.entries.get('device-b/task/image').at=0;assert.equal(cache.get('device-b/task/image'),undefined);
});

test('server rejects invalid ranges and source changes produce full 200, never old-file suffix',()=>{
  const run=headers=>{let status,out,bytes;mediaResponse({headers},{writeHead(s,h){status=s;out=h;},end(b){bytes=b;}},{bytes:data,type:'image/png',name:'a.png'});return {status,out,bytes};};
  for(const range of ['bytes=999-','bytes=10-2','bytes=0-1,5-6','bytes=-5','bytes=9999999999999999999999-']){
    const r=run({range,'if-range':tag(data)});assert.equal(r.status,416);assert.equal(r.out['Content-Range'],'bytes */36');
  }
  const changed=run({range:'bytes=10-','if-range':'"old"'});assert.equal(changed.status,200);assert.deepEqual(changed.bytes,data);
  const good=run({range:'bytes=10-','if-range':tag(data)});assert.equal(good.status,206);assert.deepEqual(good.bytes,data.subarray(10));
});
