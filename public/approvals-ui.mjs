import { browserApproval, approvalLabels } from './approval-content.mjs';
const node = (tag, text, cls) => { const n = document.createElement(tag); if (text) n.textContent = text; if (cls) n.className = cls; return n; };
export class ApprovalsUI {
  constructor({ submit, openOfficial, refresh }) { Object.assign(this, { submit, openOfficial, refresh }); this.attempts = new Map(); }
  key(context, approval) { return [context.agent, context.id, approval.requestId, approval.token].join(':'); }
  card(approval, context) {
    const key = this.key(context, approval), card = node('section', '', 'approval-card');
    const command = approval.kind === 'command';
    card.dataset.approvalId = approval.requestId; card.setAttribute('aria-label', command ? '终端命令审批' : approval.supported ? '浏览器访问授权' : '工具授权');
    card.append(node('small', command ? '终端 · 等待审批' : approval.supported ? 'Browser · 等待授权' : '工具 · 等待授权', 'field-help'),
      node('h3', command ? '允许执行这条命令？' : approval.supported ? '允许访问这个网站？' : '待处理的工具授权'));
    if (approval.origin) card.append(node('code', approval.origin, 'approval-origin'));
    if (approval.reason) card.append(node('p', approval.reason));
    if (approval.message) card.append(node('p', approval.message, 'field-help'));
    if (command && approval.command) {
      const code = node('pre', '', 'approval-command'); code.append(node('code', approval.command)); card.append(code);
      if (approval.cwd) card.append(node('p', '工作目录：' + approval.cwd, 'field-help'));
      if (approval.prefix) {
        const scope = node('div', '', 'approval-scope'); scope.append(node('small', '同前缀命令的授权范围', 'field-help'));
        scope.append(node('p', '允许类似命令会同时授权以下前缀匹配的命令；仅执行当前命令请选择“允许一次”。', 'field-help'),
          node('pre', JSON.stringify(approval.prefix), 'approval-command')); card.append(scope);
      }
    }
    const actions = node('div', '', 'approval-actions'), detail = node('p', '', 'approval-status'); detail.setAttribute('role', 'status');
    const prior = this.attempts.get(key);
    card.approvalKey = key;
    card.approvalSignature = JSON.stringify([context.epoch, context.connected, context.writable, approval, prior ?? null]);
    detail.textContent = !context.connected ? '连接中断，重新连接后再处理。' : !context.writable ? '目标设备尚未支持此授权，请更新目标 Remote Codex。'
      : !approval.supported ? '此请求格式或授权范围尚未支持，请在官方应用中处理。' : prior?.message ?? '';
    for (const decision of approval.decisions ?? []) {
      const button = node('button', approvalLabels[decision], decision === 'once' ? 'approval-primary' : ''); button.type = 'button';
      button.disabled = !context.connected || !context.writable || !!prior?.locked;
      button.onclick = async () => {
        if (this.attempts.get(key)?.locked) return;
        const status = { locked: true, message: '正在提交…' }; this.attempts.set(key, status);
        for (const b of actions.querySelectorAll('button')) b.disabled = true;
        detail.textContent = status.message;
        try {
          const result = await this.submit(context, { approvalRequestId: approval.requestId, token: approval.token, decision });
          if (result.status === 'not-sent') { status.locked = false; status.message = result.error || '未发送，请刷新后重试。'; }
          else status.message = result.status === 'accepted' ? '已提交，等待官方状态确认。' : '提交结果未知，请刷新核对，不要重复提交。';
        } catch { status.message = '提交结果未知，请刷新核对，不要重复提交。'; }
        detail.textContent = status.message;
        if (!status.locked && card.isConnected) for (const b of actions.querySelectorAll('button')) b.disabled = !context.connected || !context.writable;
        this.refresh(context);
      };
      actions.append(button);
    }
    card.append(actions, detail);
    const open = node('button', '在官方应用中处理', 'approval-official'); open.type = 'button'; open.disabled = !context.connected;
    open.onclick = () => this.openOfficial(context).catch(() => { detail.textContent = '无法打开官方窗口，请在目标电脑上处理。'; });
    card.append(open);
    if (approval.decisions?.includes('site')) card.append(node('small', '“始终允许此网站”仅授权上方网站；允许所有网站请在官方应用中设置。', 'field-help'));
    return card;
  }
  history(item) {
    if (item.type !== 'mcpServerElicitation') return null;
    const parsed = browserApproval(item.params), card = node('section', '', 'approval-card approval-history');
    card.append(node('small', parsed ? 'Browser · 网站授权' : '工具授权', 'field-help'));
    card.append(node('p', parsed?.origin ?? String(item.params?.message ?? '授权请求')));
    const text = item.completed === true ? ({ accept: '官方记录：已允许', decline: '官方记录：已拒绝', cancel: '官方记录：已取消' })[item.action] ?? '官方记录：请求已结束'
      : '等待官方实时状态，历史记录不能用于重复授权。';
    card.append(node('small', text, 'field-help')); return card;
  }
}
