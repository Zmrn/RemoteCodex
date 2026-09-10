// Shared projection: only connectivity and capabilities, never tasks or secrets.
const version=v=>typeof v==='string'&&/^\d+\.\d+\.\d+(?:\.\d+)?$/.test(v)?v:null;
const array=v=>Array.isArray(v)?v:[];
export function diagnosticStatus(status){
  const c=status?.desktopCompatibility??{};
  return {bridgeVersion:version(status?.bridgeVersion),connected:status?.connected===true,
    officialVersion:version(c.detectedVersion),verifiedVersions:array(c.verifiedVersions).slice(0,20).map(version).filter(Boolean),
    codexWritable:status?.existingCodexWritable===true,chatRead:status?.chat?.read===true,chatSend:status?.chat?.sendText===true,
    chatCreate:status?.chat?.create===true,chatImages:status?.chat?.images===true,
    officialOnly:status?.taskSummary?.schemaVersion===2&&status?.taskSummary?.statePolicy==='official-only',
    storage:array(status?.storageHealth).slice(0,10).filter(s=>s&&['healthy','recovered','blocked'].includes(s.status)).map(s=>({status:s.status,writable:s.writable===true}))};
}
export function diagnosticChecks(o){
  const result=[],add=(key,title,status,detail,action)=>result.push({key,title,status,detail,action});
  const config=['device-missing','config-unreadable','key-unavailable','endpoint-invalid'].includes(o.failure);
  add('config','设备配置',config?'error':'ok',({'device-missing':'设备已移除，请重新选择。','config-unreadable':'设备配置无法读取，原数据已保留。请重新打开 Remote Codex，若仍失败请保留数据联系维护。','key-unavailable':'访问密钥未填写或无法解密，请编辑设备重新配对。','endpoint-invalid':'地址不属于允许的 Tailscale 地址范围，请核对配置。'})[o.failure]??'已读取保存的设备配置。',config?'edit':null);
  if(o.local)add('network','网络与鉴权','ok','当前为本机直连，无需通过 Tailscale 连接自己。');
  else{
    add('dns','地址解析',config?'skipped':o.resolved?'ok':['dns-failed','dns-timeout','diagnostic-busy'].includes(o.failure)?'error':'unknown',o.resolved?'已解析到允许的 Tailscale 地址。':o.failure==='diagnostic-busy'?'已有检测尚未结束，请稍后重试。':'请确认 Tailscale 已连接；使用设备名时还需名称能够解析。','retry');
    add('tcp','目标端口',!o.resolved?'skipped':o.tcp?'ok':o.failure==='connection-refused'?'error':o.failure==='connection-timeout'?'error':'unknown',o.tcp?'已与目标端口建立连接。':o.failure==='connection-refused'?'目标端口拒绝连接。请在目标电脑开启 Remote Codex 远程接入，并核对端口。':'未能确认端口可达。可能与网络、目标睡眠或接入未开启有关；本次检测不能确定唯一原因。','retry');
    add('auth','访问鉴权',!o.tcp?'skipped':[401,403].includes(o.httpStatus)?'error':o.bridge?'ok':'unknown',[401,403].includes(o.httpStatus)?'目标拒绝了当前访问密钥，请重新配对。':o.bridge?'已获得有效桥接状态响应。':'未获得有效鉴权结果，请核对目标是否为 Remote Codex。',[401,403].includes(o.httpStatus)?'edit':null);
  }
  const b=o.bridge;
  add('bridge','Remote Codex 桥接',b?'ok':config?'skipped':'error',b?'桥接状态接口可用'+(b.bridgeVersion?' · '+b.bridgeVersion:' · 旧端未提供版本')+'。':o.failure==='response-timeout'?'端口已连通，但状态响应超时。请检查目标电脑的 Remote Codex。':'未取得有效桥接状态；请核对目标软件和访问端口。','retry');
  add('official','官方桌面连接',!b?'skipped':b.connected?'ok':'error',!b?'等待桥接状态。':b.connected?'桥接已连接官方桌面。':'桥接可以访问，但尚未连接官方桌面。请在目标电脑确认官方应用已打开并登录，再重试。','retry');
  add('compatibility','版本与能力',!b?'skipped':!b.connected?'unknown':b.codexWritable?'ok':'warning',!b?'等待官方版本信息。':
    (b.officialVersion?'官方版本 '+b.officialVersion+'。':'官方版本尚未确认。')+(b.codexWritable?' 部分 Codex 写入入口可用，具体功能见官方接口兼容性。':' Codex 写入当前不可用，请查看配置保护与具体接口原因。')+(b.officialOnly?' 统计使用官方状态，无法读取的任务仍为未知。':' 官方状态统计协议未确认，请检查目标更新。')+' Chat 新建'+(b.chatCreate?'可用':'未支持')+'，图片输入'+(b.chatImages?'可用':'未支持')+'；生成图片显示仍需独立验证。','updates');
  if(b?.storage?.some(s=>s.status!=='healthy'))add('storage','配置保护',b.storage.some(s=>!s.writable)?'error':'warning',b.storage.some(s=>!s.writable)?'部分配置处于保护状态，相关写入已暂停。原数据已保留，请重新启动 Remote Codex 读取；若仍失败请联系维护，勿清空数据。':'部分配置从校验副本恢复，原文件已保留。');
  if(o.failure==='target-changed')return [{key:'changed',title:'设备配置已变化',status:'warning',detail:'检测期间目标已改变，本次结果已丢弃，请重新检测。',action:'retry'}];
  return result;
}
export function diagnosticExport(o){
  const b=o.bridge,failures=['device-missing','config-unreadable','key-unavailable','endpoint-invalid','dns-timeout','dns-failed','diagnostic-busy','authentication-failed','http-error','invalid-response','connection-interrupted','connection-refused','response-timeout','connection-timeout','target-changed'];
  const safe=b?diagnosticStatus({bridgeVersion:b.bridgeVersion,connected:b.connected,desktopCompatibility:{detectedVersion:b.officialVersion,verifiedVersions:b.verifiedVersions},existingCodexWritable:b.codexWritable,chat:{read:b.chatRead,sendText:b.chatSend,create:b.chatCreate,images:b.chatImages},taskSummary:b.officialOnly?{schemaVersion:2,statePolicy:'official-only'}:null,storageHealth:b.storage}):null;
  return JSON.stringify({schemaVersion:1,checkedAt:typeof o.checkedAt==='string'&&/^\d{4}-\d{2}-\d{2}T[\d:.+-]+Z?$/.test(o.checkedAt)?o.checkedAt:null,local:!!o.local,failure:failures.includes(o.failure)?o.failure:null,resolved:!!o.resolved,tcp:!!o.tcp,httpStatus:Number.isInteger(o.httpStatus)&&o.httpStatus>=100&&o.httpStatus<=599?o.httpStatus:null,bridge:safe},null,2);
}
