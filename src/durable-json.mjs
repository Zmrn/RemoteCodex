import fs from 'node:fs';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';

const hash=raw=>createHash('sha256').update(raw).digest('hex');
export function replaceDurable(file,raw,io=fs){
  io.mkdirSync(path.dirname(file),{recursive:true});
  const temp=file+'.'+randomUUID()+'.tmp';
  try{const fd=io.openSync(temp,'wx',0o600);try{io.writeFileSync(fd,raw);io.fsyncSync(fd);}finally{io.closeSync(fd);}io.renameSync(temp,file);}
  finally{try{io.unlinkSync(temp);}catch(e){if(e.code!=='ENOENT')throw e;}}
}
// Keep the legacy primary JSON format. A checksummed, committed copy is written
// before the primary. Recovery never replaces a damaged primary during reads.
export class DurableJson {
  constructor(file,{label,empty,validate=value=>value&&typeof value==='object'&&!Array.isArray(value),recoveryReadOnly=false,io=fs}){
    Object.assign(this,{file,label,empty,validate,recoveryReadOnly,io});this.backup=file+'.recovery.json';this.health={status:'healthy',writable:true,message:''};
    this.value=this.load();
  }
  read(file){try{return {raw:this.io.readFileSync(file,'utf8')};}catch(e){return e.code==='ENOENT'?{missing:true}:{unreadable:true};}}
  parse(raw){const value=JSON.parse(raw.replace(/^\uFEFF/,''));if(!this.validate(value))throw Error();return value;}
  load(){
    const primary=this.read(this.file),backup=this.read(this.backup);this.primaryHash=primary.raw===undefined?null:hash(primary.raw);
    let value,copy,copyRaw;
    try{if(primary.raw!==undefined)value=this.parse(primary.raw);}catch{}
    try{if(backup.raw!==undefined){const envelope=JSON.parse(backup.raw);if(envelope.format!==1||typeof envelope.payload!=='string'||hash(envelope.payload)!==envelope.sha256)throw Error();copy=this.parse(envelope.payload);copyRaw=envelope.payload;}}catch{}
    if(value!==undefined){
      if(copy!==undefined&&copyRaw!==primary.raw){
        // A committed copy can be newer even when the old primary still parses.
        // Do not erase either side or permit replay after an uncertain save.
        this.health={status:'recovered',writable:false,message:this.label+'与保护副本不一致；已保留两份数据并暂停修改，请联系维护核对'};
        return copy;
      }
      if(backup.unreadable){this.health={status:'blocked',writable:false,message:this.label+'保护副本暂不可读；已保留原文件，相关修改已暂停'};return value;}
      // Establish a baseline without rewriting the user's primary file.
      try{this.commitCopy(primary.raw);}catch{this.health={status:'blocked',writable:false,message:this.label+'保护副本无法保存；已保留原配置，相关修改已暂停'};}
      return value;
    }
    if(primary.unreadable||backup.unreadable){this.health={status:'blocked',writable:false,message:this.label+'暂时无法读取；已保留原文件，相关修改已暂停'};return copy??structuredClone(this.empty);}
    if(copy!==undefined){this.health={status:'recovered',writable:!this.recoveryReadOnly,message:this.label+'从校验副本读取，原文件已保留'+(this.recoveryReadOnly?'；为避免重复提交，任务写入已暂停':'')};return copy;}
    if(primary.missing&&backup.missing)return structuredClone(this.empty);
    this.health={status:'blocked',writable:false,message:this.label+'与保护副本无法校验；已保留原文件，相关修改已暂停'};
    return structuredClone(this.empty);
  }
  commitCopy(raw){replaceDurable(this.backup,JSON.stringify({format:1,sha256:hash(raw),payload:raw}),this.io);}
  assertWritable(){if(!this.health.writable)throw Error(this.health.message);}
  write(value){
    this.assertWritable();if(!this.validate(value))throw Error(this.label+'格式无效');
    const current=this.read(this.file),digest=current.raw===undefined?null:hash(current.raw);
    if(current.unreadable||digest!==this.primaryHash){this.health={status:'blocked',writable:false,message:this.label+'已变化或暂不可读；请重新启动 Remote Codex 读取，未覆盖原配置'};throw Error(this.health.message);}
    const raw=JSON.stringify(value,null,2);
    // Preserve damaged bytes before an explicit mutation repairs the primary.
    if(this.health.status==='recovered'&&current.raw!==undefined)replaceDurable(this.file+'.damaged-'+randomUUID(),current.raw,this.io);
    try{this.commitCopy(raw);replaceDurable(this.file,raw,this.io);}
    catch(cause){this.health={status:'blocked',writable:false,message:this.label+'保存未完成；请重新启动 Remote Codex 核对，勿重复提交'};throw Error(this.health.message,{cause});}
    this.primaryHash=hash(raw);this.value=value;this.health={status:'healthy',writable:true,message:''};return value;
  }
}
