import { icon } from './ui.mjs';
const node = (tag, text, cls) => { const e = document.createElement(tag); if (text != null) e.textContent = text; if (cls) e.className = cls; return e; };
const svg = (tag, attrs) => { const e = document.createElementNS('http://www.w3.org/2000/svg', tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); return e; };
const percentage = n => new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 1 }).format(n) + '%';
const date = at => new Date(at).toLocaleString('zh-CN', { hour12: false });
const dayLabel = at => new Date(at).toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' });
const caption = s => s.label + (s.windowDurationMins === 10080 ? ' · 周额度' : ' · 5h 额度');
const binding = a => a && JSON.stringify([a.id, a.kind, a.host, a.port]);

export function chartSegments(points, gapMs = 600000) {
  const segments = [];
  for (const p of points) {
    const current = segments.at(-1), previous = current?.at(-1);
    if (!previous || p.at - previous.at > gapMs || p.segment !== previous.segment || p.resetsAt !== previous.resetsAt) segments.push([p]);
    else current.push(p);
  }
  return segments;
}

export class UsageHistoryView {
  constructor({ request, getAgents, getAgent }) {
    Object.assign(this, { request, getAgents, getAgent }); this.days = 7; this.sequence = 0;
    this.dialog = node('dialog', null, 'usage-history-dialog'); this.dialog.id = 'usage-history-dialog';
    const header = node('header'), title = node('h2', '额度历史'), close = node('button', null, 'icon-button');
    title.id = 'usage-history-title'; this.dialog.setAttribute('aria-labelledby', title.id);
    close.append(icon('close')); close.setAttribute('aria-label', '关闭额度历史'); close.onclick = () => this.dialog.close();
    header.append(title, close);
    const controls = node('div', null, 'usage-history-controls');
    this.device = node('select'); this.device.id = 'usage-history-device'; this.device.setAttribute('aria-label', '查看设备的额度历史');
    this.device.onchange = () => this.load();
    this.range = node('div', null, 'usage-history-ranges'); this.range.setAttribute('role', 'group'); this.range.setAttribute('aria-label', '时间范围');
    for (const days of [1, 7, 30]) {
      const button = node('button', days + ' 天'); button.dataset.days = days;
      button.onclick = () => { this.days = days; this.load(); }; this.range.append(button);
    }
    controls.append(this.device, this.range);
    this.status = node('p', '', 'usage-history-status'); this.status.id = 'usage-history-status'; this.status.setAttribute('role', 'status');
    this.seriesSelect = node('select'); this.seriesSelect.id = 'usage-history-series'; this.seriesSelect.setAttribute('aria-label', '额度窗口');
    this.seriesSelect.onchange = () => this.renderChart();
    this.content = node('div', null, 'usage-history-content');
    const footer = node('footer'), note = node('p', '由目标设备本地记录，每 5 分钟保留一条采样；仅保留最近 365 天。缺测和重置之间不连线。', 'field-help');
    this.refresh = node('button', '重新拉取'); this.refresh.id = 'usage-history-refresh'; this.refresh.onclick = () => this.load();
    footer.append(note, this.refresh);
    this.dialog.append(header, controls, this.status, this.seriesSelect, this.content, footer); document.body.append(this.dialog);
    this.dialog.addEventListener('close', () => {
      this.sequence++; this.abort?.abort(); this.result = null; this.content.replaceChildren(); this.seriesSelect.replaceChildren();
    });
  }
  open() {
    this.device.replaceChildren(...this.getAgents().map(a => new Option(a.name, a.id)));
    if (this.getAgent()?.id) this.device.value = this.getAgent().id;
    if (!this.dialog.open) this.dialog.showModal(); this.load();
  }
  async load() {
    const sequence = ++this.sequence, id = this.device.value, days = this.days;
    const agentBinding = binding(this.getAgents().find(a => a.id === id));
    this.abort?.abort(); this.abort = new AbortController();
    this.result = null; this.content.replaceChildren(); this.seriesSelect.replaceChildren(); this.seriesSelect.hidden = true;
    this.refresh.disabled = true;
    for (const b of this.range.children) b.setAttribute('aria-pressed', String(Number(b.dataset.days) === days));
    this.status.textContent = '正在从目标设备拉取记录…';
    try {
      if (!agentBinding) throw Error('请先添加要查看的设备');
      const result = await this.request(id, '/usage/history?days=' + days, { signal: AbortSignal.any([this.abort.signal, AbortSignal.timeout(20000)]) });
      if (sequence !== this.sequence || !this.dialog.open) return;
      if (agentBinding !== binding(this.getAgents().find(a => a.id === id))) throw Error('目标设备配置已变化，请重新打开额度历史');
      if (result.schemaVersion !== 1 || result.days !== days || !Array.isArray(result.series)) throw Error('目标设备尚不支持额度历史，请更新目标设备的 Remote Codex');
      for (const s of result.series) {
        if (!Array.isArray(s.points) || !s.points.length || ![300, 10080].includes(s.windowDurationMins) ||
          s.points.some((p, i) => !Number.isSafeInteger(p.at) || p.at <= 0 || !Number.isFinite(p.remainingPercent) ||
            p.remainingPercent < 0 || p.remainingPercent > 100 || (i && p.at < s.points[i - 1].at))) throw Error('目标设备返回的历史格式不完整，请更新后重试');
      }
      this.result = result;
      this.seriesSelect.replaceChildren(...result.series.map(s => new Option(caption(s), s.key)));
      this.seriesSelect.hidden = !result.series.length;
      this.status.textContent = result.recording?.error || (result.recording?.connected === false
        ? '官方桌面当前未连接，仍可查看已保存的历史。' : '显示所选设备在采样时登录账号的额度；不会合并其他设备的记录。');
      this.renderChart();
    } catch (e) {
      if (sequence !== this.sequence || !this.dialog.open) return;
      this.status.textContent = e.status === 404 ? '目标设备尚不支持额度历史，请更新目标设备的 Remote Codex。'
        : e.name === 'TimeoutError' ? '拉取超时，请确认目标设备在线后重试。' : '未能读取额度历史：' + e.message;
    } finally { if (sequence === this.sequence) this.refresh.disabled = false; }
  }
  renderChart() {
    this.content.replaceChildren();
    const s = this.result?.series.find(s => s.key === this.seriesSelect.value);
    if (!s) {
      this.content.append(node('p', '最近 ' + this.days + ' 天暂无记录', 'usage-history-empty'),
        node('p', '保持目标设备的 Remote Codex 和官方桌面运行，后续采样会出现在这里。不会补造过去的数据。', 'field-help'));
      return;
    }
    const points = s.points, first = points[0], last = points.at(-1);
    const stats = node('div', null, 'usage-history-stats');
    const values = points.map(p => p.remainingPercent);
    for (const [label, value] of [['最后记录剩余', last.remainingPercent], ['区间最低', Math.min(...values)], ['区间最高', Math.max(...values)]]) {
      const box = node('div'); box.append(node('span', label), node('strong', percentage(value))); stats.append(box);
    }
    const chart = svg('svg', { viewBox: '0 0 720 280', role: 'img', 'aria-label': caption(s) + '剩余额度随时间变化；竖线表示每天零点', class: 'usage-history-chart' });
    const left = 46, right = 704, top = 20, bottom = 234;
    const x = p => last.at === first.at ? (left + right) / 2 : left + (p.at - first.at) / (last.at - first.at) * (right - left);
    const y = p => bottom - p.remainingPercent / 100 * (bottom - top);
    for (const value of [0, 50, 100]) {
      const yy = y({ remainingPercent: value });
      chart.append(svg('line', { x1: left, x2: right, y1: yy, y2: yy, class: 'usage-chart-grid' }));
      const label = svg('text', { x: left - 8, y: yy + 4, 'text-anchor': 'end' }); label.textContent = value + '%'; chart.append(label);
    }
    const midnight = new Date(first.at);
    midnight.setHours(0, 0, 0, 0);
    midnight.setDate(midnight.getDate() + 1);
    for (let day = 0; midnight.getTime() < last.at; day++, midnight.setDate(midnight.getDate() + 1)) {
      const at = midnight.getTime(), xx = x({ at });
      chart.append(svg('line', { x1: xx, x2: xx, y1: top, y2: bottom,
        class: this.days === 30 ? 'usage-chart-day usage-chart-day-dense' : 'usage-chart-day' }));
      if ((this.days !== 30 || (day + 1) % 5 === 0) && xx > left + 34 && xx < right - 34) {
        const label = svg('text', { x: xx, y: 247, 'text-anchor': 'middle', class: 'usage-chart-day-label' });
        label.textContent = dayLabel(at); chart.append(label);
      }
    }
    for (const segment of chartSegments(points)) {
      if (segment.length > 1) chart.append(svg('path', { d: segment.map((p, i) => (i ? 'L' : 'M') + x(p).toFixed(2) + ',' + y(p).toFixed(2)).join(' '), class: 'usage-chart-line' }));
      if (segment.length === 1 || points.length <= 200) for (const p of segment) chart.append(svg('circle', { cx: x(p), cy: y(p), r: 2.8, class: 'usage-chart-dot' }));
    }
    for (const [p, align] of [[first, 'start'], [last, 'end']]) {
      if (first === last && align === 'end') continue;
      const label = svg('text', { x: first === last ? x(first) : align === 'start' ? left : right, y: 270, 'text-anchor': first === last ? 'middle' : align });
      label.textContent = new Date(p.at).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }); chart.append(label);
    }
    const marker = svg('circle', { r: 5, class: 'usage-chart-marker' }); chart.append(marker);
    const selected = node('p', '', 'usage-history-selected'); selected.id = 'usage-history-selected'; selected.setAttribute('aria-live', 'polite');
    const scrub = node('input'); scrub.type = 'range'; scrub.min = 0; scrub.max = points.length - 1; scrub.value = points.length - 1;
    scrub.id = 'usage-history-sample'; scrub.setAttribute('aria-label', '查看采样记录');
    const show = index => {
      const p = points[index]; marker.setAttribute('cx', x(p)); marker.setAttribute('cy', y(p)); scrub.value = index;
      selected.textContent = date(p.at) + ' · 剩余 ' + percentage(p.remainingPercent);
      scrub.setAttribute('aria-valuetext', selected.textContent);
    };
    scrub.oninput = () => show(Number(scrub.value));
    const inspect = e => {
      const rect = chart.getBoundingClientRect(), target = (e.clientX - rect.left) / rect.width * 720;
      let lo = 0, hi = points.length - 1;
      while (lo < hi) { const mid = Math.floor((lo + hi) / 2); if (x(points[mid]) < target) lo = mid + 1; else hi = mid; }
      if (lo && Math.abs(x(points[lo - 1]) - target) < Math.abs(x(points[lo]) - target)) lo--;
      show(lo);
    };
    chart.onpointerdown = inspect; chart.onpointermove = e => { if (e.pointerType === 'mouse' || e.buttons) inspect(e); };
    const count = node('p', points.length + ' 条采样 · ' + date(first.at) + ' 至 ' + date(last.at), 'field-help');
    this.content.append(stats, chart, selected, scrub, count); show(points.length - 1);
  }
}
