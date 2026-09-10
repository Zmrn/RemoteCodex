import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateKeyPairSync, createHash, sign } from 'node:crypto';
import { updateSource, releaseAssetUrl, fetchUpdateAsset, readUpdateBytes } from '../src/update-channel.mjs';
import { releaseFiles, verifyReleaseBundle, publishRelease } from '../scripts/github-release.mjs';

test('GitHub downloads follow bounded HTTPS redirects without credentials and pin signed versions', async () => {
  const seen = [], responses = [new Response(null, {status:302,headers:{location:releaseAssetUrl('0.10.29','latest.json')}}),
    new Response(null,{status:302,headers:{location:'https://release-assets.githubusercontent.com/asset?signature=opaque'}}), new Response('payload')];
  const response = await fetchUpdateAsset(updateSource.manifestUrl,{fetcher:async(url, options)=>{seen.push([String(url),options]);return responses.shift();}});
  assert.equal(await response.text(),'payload'); assert.equal(seen.length,3);
  assert.ok(seen.every(([,options])=>options.redirect==='manual'&&!options.headers.Authorization));
  assert.equal(releaseAssetUrl('0.10.29','RemoteCodex.exe'),'https://github.com/Zmrn/RemoteCodex/releases/download/v0.10.29/RemoteCodex.exe');
  assert.equal(releaseAssetUrl('0.10.29','RemoteCodex.apk'),'https://github.com/Zmrn/RemoteCodex/releases/download/v0.10.29/RemoteCodex.apk');
  for(const version of ['../latest','0.10.29/other','01.2.3'])assert.throws(()=>releaseAssetUrl(version,'RemoteCodex.exe'));
  assert.throws(()=>releaseAssetUrl('0.10.29','../other.exe'));
});
test('update redirects reject old servers, downgrade, credentials, unrelated hosts and loops before a second request', async () => {
  for(const location of ['http://github.com/Zmrn/RemoteCodex/releases/download/v1.0.0/file', 'https://example.test/file',
    'https://release-assets.githubusercontent.com.evil.test/file','https://secret@github.com/Zmrn/RemoteCodex/releases/file',
    'https://github.com/Other/Repo/releases/file','https://github.com:8443/Zmrn/RemoteCodex/releases/file']) {
    let calls=0;
    await assert.rejects(fetchUpdateAsset(updateSource.manifestUrl,{fetcher:async()=>{calls++;return new Response(null,{status:302,headers:{location}});}}));
    assert.equal(calls,1);
  }
  let calls=0;
  await assert.rejects(fetchUpdateAsset(updateSource.manifestUrl,{fetcher:async()=>{calls++;return new Response(null,{status:302,headers:{location:updateSource.manifestUrl}});}}),/重定向/);
  assert.equal(calls,6);
  const abort=new AbortController();abort.abort();
  await assert.rejects(fetchUpdateAsset(updateSource.manifestUrl,{signal:abort.signal,fetcher:async(_,options)=>{options.signal.throwIfAborted();}}),/abort/i);
  await assert.rejects(readUpdateBytes(new Response('oversized'), 4),/大小/);
  await assert.rejects(readUpdateBytes(new Response('',{headers:{'content-length':'100'}}),4),/大小/);
});
function fixture() {
  const keys=generateKeyPairSync('rsa',{modulusLength:2048}), version='0.10.29';
  const run={id:123,head_sha:'a'.repeat(40),head_branch:'main',path:'.github/workflows/build.yml',conclusion:'success'};
  const support={catalogSha256:'b'.repeat(64)}, notes=Buffer.from('Synthetic release notes');
  const digest=b=>createHash('sha256').update(b).digest('hex');
  const files=new Map([['RELEASE-NOTES.md',notes],['GITHUB-BUILD.json',Buffer.from(JSON.stringify({version,commit:run.head_sha,runId:run.id,updateBaseUrl:updateSource.baseUrl}))]]);
  for(const [file,manifest,report,platform] of [['RemoteCodex.exe','latest.json','RemoteCodex.build.json','windows-x64'],['RemoteCodex.apk','android-latest.json','RemoteCodex.apk.build.json','android']]) {
    const data=Buffer.alloc(2048,7);if(file.endsWith('exe'))data.write('MZ');
    const meta={schema:1,version,platform,file,bytes:data.length,sha256:digest(data),desktopCompatibility:support,releaseNotesSha256:digest(notes),
      ...(platform==='android'?{packageName:'com.anso.remotecodex',versionCode:10029}:{})};
    const payload=Buffer.from(JSON.stringify(meta));
    files.set(file,data);files.set(report,Buffer.from(JSON.stringify(meta)));files.set(manifest,Buffer.from(JSON.stringify({payload:payload.toString('base64'),signature:sign('sha256',payload,keys.privateKey).toString('base64')})));
  }
  fs.mkdirSync(new URL('../work/',import.meta.url),{recursive:true});
  const folder=fs.mkdtempSync(fileURLToPath(new URL('../work/github-release-test-',import.meta.url)));
  for(const [name,data]of files)fs.writeFileSync(path.join(folder,name),data);
  return {files,folder,run,publicKey:keys.publicKey,bundle:verifyReleaseBundle(folder,run,keys.publicKey)};
}
function fakeClient() {
  let release=null, next=1;const assets=[],bytes=new Map(),events=[];
  const client={events,assets,get release(){return release;},latest:null,ref:null,failUpload:false,failPublish:false,corrupt:false,
    async get(route){if(route==='releases/latest')return this.latest;if(route.startsWith('git/ref/'))return this.ref;
      if(route.startsWith('releases?'))return release?[release]:[];
      if(route.startsWith('releases/tags/'))return release&&!release.draft?release:null;
      if(route.includes('/assets?'))return assets;if(route.startsWith('releases/'))return release;throw Error(route);},
    async mutate(route,method,body){events.push([method,body]);if(method==='POST'){release={...body,id:1,html_url:'https://github.com/Zmrn/RemoteCodex/releases/tag/'+body.tag_name};return release;}
      assert.equal(assets.length,releaseFiles.length);release={...release,...body};if(this.failPublish){this.failPublish=false;throw Error('result lost');}return release;},
    async upload(id,name,data){assert.ok(release.draft);const asset={id:next++,name,size:data.length,state:'uploaded'};assets.push(asset);bytes.set(asset.id,data);if(this.failUpload){this.failUpload=false;throw Error('upload response lost');}return asset;},
    async readAsset(id){return this.corrupt?Buffer.from('corrupt'):bytes.get(id);}};
  return client;
}
test('release publication requires matching signed dual artifacts, provenance and GitHub channel',()=>{
  const f=fixture(); assert.equal(f.bundle.version,'0.10.29');
  for(const change of [{conclusion:'failure'},{head_branch:'topic'},{head_sha:'c'.repeat(40)}])assert.throws(()=>verifyReleaseBundle(f.folder,{...f.run,...change},f.publicKey));
  const info=JSON.parse(f.files.get('GITHUB-BUILD.json'));fs.writeFileSync(path.join(f.folder,'GITHUB-BUILD.json'),JSON.stringify({...info,updateBaseUrl:'http://old-server/'}));
  assert.throws(()=>verifyReleaseBundle(f.folder,f.run,f.publicKey),/provenance/);
  fs.writeFileSync(path.join(f.folder,'GITHUB-BUILD.json'),f.files.get('GITHUB-BUILD.json'));
  fs.appendFileSync(path.join(f.folder,'RemoteCodex.apk'),'corrupt');assert.throws(()=>verifyReleaseBundle(f.folder,f.run,f.publicKey),/artifacts/);
});
test('publish stages and rereads all assets before making a release public; retries do not rewrite published assets',async()=>{
  const f=fixture(),client=fakeClient();
  assert.equal((await publishRelease(client,f.bundle)).published,true);
  assert.equal(client.events[0][1].draft,true);assert.equal(client.events[0][1].target_commitish,f.run.head_sha);
  assert.equal(client.release.draft,false);assert.deepEqual(client.assets.map(a=>a.name),releaseFiles);
  const writes=client.events.length;assert.equal((await publishRelease(client,f.bundle)).alreadyPublished,true);assert.equal(client.events.length,writes);
});
test('unknown upload/publication results resume the same draft without duplicate assets or repeat publication',async()=>{
  const f=fixture(),client=fakeClient();client.failUpload=true;
  await assert.rejects(publishRelease(client,f.bundle),/lost/);assert.equal(client.release.draft,true);
  client.failPublish=true;await assert.rejects(publishRelease(client,f.bundle),/lost/);
  assert.equal((await publishRelease(client,f.bundle)).alreadyPublished,true);
  assert.equal(client.assets.length,8);assert.equal(client.events.filter(([method])=>method==='POST').length,1);
});
test('corrupt assets, another version owner, conflicting tags and rollback prevent publication',async()=>{
  const f=fixture(),client=fakeClient();client.corrupt=true;
  await assert.rejects(publishRelease(client,f.bundle),/verification/);assert.equal(client.release.draft,true);
  client.corrupt=false;await assert.rejects(publishRelease(client,{...f.bundle,runId:'999'}),/another build/);
  const other=fakeClient();other.latest={tag_name:'v0.10.30'};await assert.rejects(publishRelease(other,f.bundle),/rollback/);assert.equal(other.events.length,0);
  other.latest=null;other.ref={object:{type:'commit',sha:'d'.repeat(40)}};await assert.rejects(publishRelease(other,f.bundle),/another commit/);
});
