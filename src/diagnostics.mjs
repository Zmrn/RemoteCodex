import http from 'node:http';
import {validateEndpoint,resolveAgent} from './agents.mjs';
import {diagnosticStatus} from '../public/diagnostic-state.mjs';
const timeout=(promise,ms)=>Promise.race([promise,new Promise((_,reject)=>{const timer=setTimeout(()=>reject(Object.assign(Error(),{code:'DNS_TIMEOUT'})),ms);timer.unref();promise.finally(()=>clearTimeout(timer)).catch(()=>{});})]);
const signature=a=>JSON.stringify([a.id,a.kind,a.host,a.port,a.sealedKey]);
export async function diagnoseDevice(agents,id,{localStatus,resolve=resolveAgent,request=http.request}={}){
  const out={schemaVersion:1,checkedAt:new Date().toISOString(),local:id==='local',resolved:false,tcp:false};let agent,identity;
  try{agent=agents.get(id);identity=signature(agent);}catch{out.failure='config-unreadable';return out;}
  if(agent.kind==='local'){out.bridge=diagnosticStatus(localStatus());return out;}
  try{validateEndpoint(agent.host,agent.port);}catch{out.failure='endpoint-invalid';return out;}
  let key;try{key=await agents.key(id);}catch{out.failure='key-unavailable';return out;}
  let host;try{host=await timeout(resolve(agent.host),3000);out.resolved=true;}catch(e){out.failure=e.code==='DNS_TIMEOUT'?'dns-timeout':'dns-failed';return out;}
  await new Promise(done=>{
    let finished=false,timer;const finish=failure=>{if(finished)return;finished=true;clearTimeout(timer);if(failure)out.failure=failure;req.destroy();done();};
    const req=request({hostname:host,port:agent.port,path:'/bridge/v1/api/status',method:'GET',headers:{Authorization:'Bearer '+key,'Accept-Encoding':'identity'},agent:false},res=>{
      out.httpStatus=res.statusCode;
      if([401,403].includes(res.statusCode)){res.resume();finish('authentication-failed');return;}
      if(res.statusCode!==200){res.resume();finish('http-error');return;}
      let raw='';res.on('data',chunk=>{raw+=chunk;if(Buffer.byteLength(raw)>1024*1024){req.destroy();finish('invalid-response');}});
      res.on('end',()=>{try{const value=JSON.parse(raw);if(typeof value.connected!=='boolean'||value.source!=='official-desktop-IPC-live')throw Error();out.bridge=diagnosticStatus(value);finish();}catch{finish('invalid-response');}});
      res.on('error',()=>finish('connection-interrupted'));
    });
    req.on('socket',socket=>socket.once('connect',()=>{out.tcp=true;}));
    req.on('error',e=>finish(e.code==='ECONNREFUSED'?'connection-refused':'connection-interrupted'));
    timer=setTimeout(()=>{finish(out.tcp?'response-timeout':'connection-timeout');req.destroy();},7000);req.end();
  });
  try{if(signature(agents.get(id))!==identity)return {schemaVersion:1,checkedAt:out.checkedAt,failure:'target-changed',local:out.local};}catch{return {schemaVersion:1,checkedAt:out.checkedAt,failure:'target-changed',local:out.local};}
  return out;
}
