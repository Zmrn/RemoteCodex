const node = (tag, text, cls) => { const e = document.createElement(tag); if (text) e.textContent = text; if (cls) e.className = cls; return e; };
const bad = value => ['missing', 'mismatch'].includes(value?.status);
export const rowStatus = row => bad(row.running) || bad(row.latest) ? 'error'
  : row.running?.status !== 'matched' || row.latest?.status !== 'matched' ? 'warning' : 'ok';
export function compatibilityExport(report) {
  // The endpoint projects protocol metadata only. Do not export unknown future fields.
  const observation = s => ({ status: s?.status, version: s?.version, detail: s?.detail, missingFields: s?.missingFields });
  return JSON.stringify({ schemaVersion: 1, remoteVersion: report.remoteVersion, checkedAt: report.checkedAt,
    catalogSha256: report.catalogSha256, active: { version: report.active.version, connected: report.active.connected,
      writeSupported: report.active.writeSupported, readStateSupported: report.active.readStateSupported },
    latest: { version: report.latest.version, source: report.latest.source, writeSupported: report.latest.writeSupported,
      readStateSupported: report.latest.readStateSupported }, supportedVersions: report.supportedVersions,
    checkScope: report.checkScope,
    rows: report.rows.map(r => ({ kind: r.kind, name: r.name, purpose: r.purpose, expected: { version: r.expected?.version, request: r.expected?.request },
      running: observation(r.running), latest: observation(r.latest) })), limits: report.limits, taskWrites: 0 }, null, 2);
}

export class CompatibilityView {
  constructor({ agentApi, getAgent, getAgents, toast }) {
    Object.assign(this, { agentApi, getAgent, getAgents, toast }); this.sequence = 0;
    this.dialog = node('dialog', null, 'diagnostics-dialog compatibility-dialog'); this.dialog.id = 'official-compatibility';
    const header = node('header'), title = node('h2', '官方接口兼容性'), close = node('button', '×', 'icon-button');
    close.setAttribute('aria-label', '关闭兼容性检查'); close.onclick = () => this.dialog.close(); header.append(title, close);
    this.select = node('select'); this.select.id = 'compatibility-device'; this.select.setAttribute('aria-label', '选择检查设备'); this.select.onchange = () => this.run();
    this.summary = node('p', '', 'compatibility-summary'); this.summary.setAttribute('role', 'status');
    this.versions = node('div', '', 'compatibility-versions'); this.versions.id = 'compatibility-versions';
    this.filter = node('input'); this.filter.type = 'checkbox'; this.filter.onchange = () => this.renderRows();
    const label = node('label', '', 'check-label'); label.append(this.filter, document.createTextNode('只看异常和待验证'));
    this.rows = node('div'); this.rows.id = 'compatibility-rows';
    this.note = node('p', '', 'field-help');
    this.refresh = node('button', '重新检查'); this.refresh.onclick = () => this.run();
    this.copy = node('button', '复制检查报告'); this.copy.disabled = true;
    this.copy.onclick = async () => { if (!this.report) return; const text = compatibilityExport(this.report);
      try { await navigator.clipboard.writeText(text); this.toast('已复制接口报告，不包含地址、密钥或任务内容'); }
      catch { const box = node('textarea'); box.readOnly = true; box.value = text; box.setAttribute('aria-label', '可手动复制的兼容性报告'); this.rows.append(box); box.select(); }
    };
    const actions = node('div', '', 'diagnostic-actions'); actions.append(this.refresh, this.copy);
    this.dialog.append(header, this.select, this.summary, this.versions, actions, label, this.rows, this.note); document.body.append(this.dialog);
    this.dialog.addEventListener('close', () => { this.sequence++; this.abort?.abort(); });
  }
  open() {
    this.select.replaceChildren(...this.getAgents().map(a => new Option(a.name, a.id)));
    const id = this.getAgent()?.id; if (id) this.select.value = id;
    if (!this.dialog.open) this.dialog.showModal(); this.run();
  }
  async run() {
    const id = this.select.value, sequence = ++this.sequence;
    this.abort?.abort(); this.abort = new AbortController(); this.report = null;
    this.copy.disabled = true; this.refresh.disabled = true; this.rows.replaceChildren(); this.versions.replaceChildren(); this.note.textContent = '';
    if (!id) { this.summary.textContent = '请先添加并选择一台电脑。'; this.refresh.disabled = false; return; }
    this.summary.textContent = '正在读取官方工具目录、协议表和最新版信息…';
    try {
      const result = await this.agentApi(id, '/compatibility/report', undefined,
        { signal: AbortSignal.any([this.abort.signal, AbortSignal.timeout(60000)]) });
      if (sequence !== this.sequence || !this.dialog.open) return;
      if (result?.schemaVersion !== 1 || !Array.isArray(result.rows) || !result.active || !result.latest) {
        this.summary.textContent = '请先更新目标电脑的 Remote Codex，以支持接口兼容性报告。'; return;
      }
      this.report = result; this.copy.disabled = false; this.render();
    } catch (error) {
      if (sequence === this.sequence && this.dialog.open)
        this.summary.textContent = error.name === 'TimeoutError' ? '检查超时，请重试；不会发送任何任务指令。'
          : '无法取得兼容性报告，请检查设备连接和目标端 Remote Codex 版本。';
    } finally { if (sequence === this.sequence) this.refresh.disabled = false; }
  }
  render() {
    const r = this.report, errors = r.rows.filter(row => rowStatus(row) === 'error').length,
      unknown = r.rows.filter(row => rowStatus(row) === 'warning').length;
    this.summary.textContent = `已用接口 ${r.rows.length} 项 · ${errors} 项异常 · ${unknown} 项待验证`;
    this.versions.replaceChildren();
    for (const [title, version, info] of [
      ['目标 Remote Codex', r.remoteVersion, '接口清单 ' + (r.catalogSha256 || '').slice(0, 12)],
      ['正在运行的官方版', r.active.version, r.active.connected ? '已连接，实时读取工具目录' : '未连接'],
      ['官方最新版', r.latest.version, ({ running: '当前运行版本', 'downloaded-package': '已下载包，仅比较静态协议', unavailable: '暂无此版本的本地协议数据' })[r.latest.source] || '来源未知'],
    ]) {
      const row = node('div'), label = node('span', title), value = node('strong', version || '未知'); row.append(label, value, node('small', info)); this.versions.append(row);
    }
    const timestamp = new Date(r.checkedAt);
    if (Number.isFinite(timestamp.getTime())) this.versions.append(node('p', '检查时间：' + timestamp.toLocaleString('zh-CN', { hour12: false }), 'field-help'));
    for (const [label, value] of [['当前官方版', r.active], ['官方最新版', r.latest]]) {
      if (value.version && !value.writeSupported) this.versions.append(node('p', `${label} ${value.version} 尚未加入支持版本，现有版本保护会限制任务写入。`, 'compatibility-pending'));
      if (value.version && !value.readStateSupported) this.versions.append(node('p', `${label}的官方已读同步尚未验证。`, 'compatibility-pending'));
      if (value.error) this.versions.append(node('p', value.error, 'compatibility-pending'));
    }
    this.note.textContent = r.limits; this.renderRows();
  }
  renderRows() {
    this.rows.replaceChildren(); if (!this.report) return;
    const ordered = this.report.rows.map((r, i) => ({ r, i })).sort((a,b) => ({error:0,warning:1,ok:2})[rowStatus(a.r)] - ({error:0,warning:1,ok:2})[rowStatus(b.r)] || a.i-b.i);
    for (const { r } of ordered) {
      const status = rowStatus(r); if (this.filter.checked && status === 'ok') continue;
      const row = node('section', '', 'compatibility-row'); row.dataset.status = status; row.dataset.command = r.name;
      const heading = node('div', '', 'diagnostic-heading'); heading.append(node('code', r.name), node('span', ({error:'不兼容',warning:'待验证',ok:'声明一致'})[status], 'badge'));
      row.append(heading, node('p', r.purpose, 'field-help'));
      const compare = node('dl', '', 'compatibility-columns');
      const expected = r.expected.version ? `v${r.expected.version}` : '工具目录 + 参数';
      for (const [name, value, observed] of [['Remote 使用', expected, null], ['官方运行版', null, r.running], ['官方最新版', null, r.latest]]) {
        const cell = node('div'), dt = node('dt', name), dd = node('dd', value || (({matched:'一致',missing:'缺失',mismatch:'不匹配',unknown:'待验证'})[observed?.status] || '未知') + (observed?.version ? ` · v${observed.version}` : ''));
        if (observed) { cell.dataset.status = bad(observed) ? 'error' : observed.status === 'matched' ? 'ok' : 'warning'; dd.append(node('small', observed.detail)); }
        cell.append(dt, dd); compare.append(cell);
      }
      row.append(compare);
      if (r.expected.request?.length) row.append(node('p', '所用参数：' + r.expected.request.join('、'), 'compatibility-parameters'));
      this.rows.append(row);
    }
    if (!this.rows.childElementCount) this.rows.append(node('p', '没有异常或待验证的指令。', 'field-help'));
  }
}
