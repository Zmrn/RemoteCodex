import {diagnosticChecks,diagnosticExport} from './diagnostic-state.mjs';
const node=(tag,text,cls)=>{const e=document.createElement(tag);if(text)e.textContent=text;if(cls)e.className=cls;return e;};
export class ConnectionDiagnostics {
  constructor({api,getAgent,getAgents,retry,edit,updates,toast}){
    Object.assign(this,{api,getAgent,getAgents,retry,edit,updates,toast});this.sequence=0;
    this.dialog=node('dialog',null,'diagnostics-dialog');this.dialog.id='connection-diagnostics';
    const header=node('header'),title=node('h2','连接诊断'),close=node('button','×','icon-button');close.setAttribute('aria-label','关闭连接诊断');close.onclick=()=>this.dialog.close();header.append(title,close);
    this.select=node('select');this.select.id='diagnostic-device';this.select.setAttribute('aria-label','选择要诊断的设备');this.select.onchange=()=>this.run();
    this.summary=node('p','检测不会发送消息或修改网络设置。','field-help');this.summary.setAttribute('role','status');
    this.rows=node('div',null,'diagnostic-checks');this.rows.id='diagnostic-checks';
    const footer=node('div',null,'diagnostic-actions');this.again=node('button','重新检测');this.again.onclick=()=>this.run();this.copy=node('button','复制脱敏诊断');this.copy.disabled=true;this.copy.onclick=async()=>{try{await navigator.clipboard.writeText(diagnosticExport(this.observation));toast('已复制，不包含地址、密钥或任务内容');}catch{this.summary.textContent='复制失败，请选中下方诊断文本手动复制。';const text=node('textarea');text.readOnly=true;text.value=diagnosticExport(this.observation);this.rows.append(text);text.select();}};footer.append(this.again,this.copy);
    this.dialog.append(header,this.select,this.summary,this.rows,footer);document.body.append(this.dialog);
    this.dialog.addEventListener('close',()=>{this.sequence++;this.abort?.abort();});
  }
  open(){this.select.replaceChildren(...this.getAgents().map(a=>new Option(a.name,a.id)));const id=this.getAgent()?.id;if(id)this.select.value=id;if(!this.dialog.open)this.dialog.showModal();this.run();}
  async run(){
    const id=this.select.value,sequence=++this.sequence;this.abort?.abort();this.abort=new AbortController();this.observation=null;this.copy.disabled=true;this.again.disabled=true;this.rows.replaceChildren();
    if(!id){this.summary.textContent='请先添加设备；若设备列表无法读取，请保留原数据并重新打开 Remote Codex。';this.again.disabled=false;return;}
    this.summary.textContent='正在检查保存的配置、网络和官方连接…';
    try{
      const result=await this.api('/api/diagnostics?agent='+encodeURIComponent(id),undefined,{signal:AbortSignal.any([this.abort.signal,AbortSignal.timeout(25000)])});
      if(sequence!==this.sequence||!this.dialog.open)return;if(result.schemaVersion!==1)throw Error('当前控制端尚不支持诊断，请更新 Remote Codex。');
      this.observation=result;this.copy.disabled=false;const checks=diagnosticChecks(result);
      this.summary.textContent=(checks.some(c=>['error','warning','unknown'].includes(c.status))?'检测发现需要关注的项目。':'连接检查通过。')+' 检测为当前快照，不代表所有任务均可读取。';
      for(const check of checks){
        const row=node('section',null,'diagnostic-check');row.dataset.status=check.status;row.dataset.check=check.key;
        const heading=node('div',null,'diagnostic-heading');heading.append(node('strong',check.title),node('span',({ok:'通过',error:'异常',warning:'注意',unknown:'未知',skipped:'未检测'})[check.status],'badge'));
        row.append(heading,node('p',check.detail));
        if(check.action&&check.status!=='ok'&&check.status!=='skipped'){
          const action=node('button',({retry:'重试连接',edit:'编辑设备',updates:'检查目标更新'})[check.action]);
          action.onclick=async()=>{if(sequence!==this.sequence)return;action.disabled=true;try{
            if(check.action==='edit'){this.dialog.close();this.edit(id);return;}
            await (check.action==='updates'?this.updates(id):this.retry(id));if(sequence===this.sequence)await this.run();
          }catch(e){if(sequence===this.sequence)this.summary.textContent='操作未完成：'+e.message;}finally{action.disabled=false;}};row.append(action);
        }
        this.rows.append(row);
      }
    }catch(e){if(sequence===this.sequence&&this.dialog.open)this.summary.textContent=e.name==='TimeoutError'?'检测超时，请稍后重试。':e.name==='AbortError'?'检测已取消。':e.message;}
    finally{if(sequence===this.sequence)this.again.disabled=false;}
  }
}
