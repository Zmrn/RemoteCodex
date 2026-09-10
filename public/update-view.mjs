const version = value => typeof value === 'string' && /^\d+\.\d+\.\d+$/.test(value) ? value : null;
const compare = (a, b) => {
  const x = a.split('.').map(Number), y = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return Math.sign(x[i] - y[i]);
  return 0;
};

export function updateView(state = {}) {
  const current = version(state.currentVersion), latest = version(state.latestVersion);
  // Never relabel a cached package using the latest remote manifest.
  const downloaded = version(state.downloadedVersion), downloading = version(state.downloadVersion);
  const phase = state.phase, active = ['downloading', 'verifying', 'waiting', 'installing'].includes(phase);
  const progress = ['waiting', 'installing'].includes(phase) ? 100 : Math.max(0, Math.min(100, Number(state.progress) || 0));
  const date = state.checkedAt ? new Date(state.checkedAt) : null;
  const checked = date && Number.isFinite(date.getTime()) ? date.toLocaleString('zh-CN', { hour12: false }) : null;
  const target = downloading || downloaded || '版本未确认';
  const label = ({ idle: '尚未检查更新', checking: '正在检查远端最新版…',
    current: !latest || !current ? '检查结果缺少版本，请重新检查更新' : compare(current, latest) > 0 ? '当前版本高于远端发布版' : '已是最新版本',
    available: '发现可用更新', downloading: `正在下载 ${target} · ${progress}%`, verifying: '正在校验安装包…',
    waiting: !downloaded ? '下载已结束，安装包版本需要重新确认' : state.platform === 'android' ? '下载完成，安装时由 Android 系统确认' : state.automatic ? '下载完成，等待草稿或编辑结束后自动安装' : '下载完成，可点击安装',
    installing: `正在安装 ${target}，稍后自动重新打开`, error: state.error || '更新失败，请重试',
  })[phase] || '更新状态未知';
  const rows = [['当前安装', current || '未知'], ['远端最新', latest || '尚未确认']];
  if (phase === 'downloading') rows.push(['正在下载', downloading || '版本未确认']);
  rows.push(['已下载', downloaded ? downloaded + ' · 已校验' : state.packageState === 'none' ? '暂无安装包' : state.packageState === 'unverified' ? '本地安装包待校验' : '版本未确认']);
  let relation = '';
  if (downloaded && latest) relation = compare(downloaded, latest) === 0 ? '已下载包与上次确认的最新版一致' : compare(downloaded, latest) < 0 ? '已下载包较旧，安装时会先获取最新版' : '已下载包高于远端发布版，请重新检查更新';
  const pending = ['checking', 'downloading', 'verifying', 'installing'].includes(phase);
  return { rows, active, progress, label, relation,
    checked: checked ? '上次确认：' + checked : latest ? '尚无最近检查时间，请检查更新' : '检查后显示远端最新版',
    installLabel: latest ? (downloaded === latest ? '安装 ' : '下载并安装 ') + latest : '安装更新',
    checkDisabled: pending, installDisabled: !state.supported || !state.available || pending,
  };
}

export function renderUpdateVersions(container, state) {
  const view = updateView(state), doc = container.ownerDocument;
  container.replaceChildren();
  const list = doc.createElement('dl'); list.className = 'update-versions';
  for (const [label, text] of view.rows) {
    const row = doc.createElement('div'), dt = doc.createElement('dt'), dd = doc.createElement('dd');
    dt.textContent = label; dd.textContent = text; row.append(dt, dd); list.append(row);
  }
  const checked = doc.createElement('p'); checked.className = 'field-help update-checked'; checked.textContent = view.checked;
  container.append(list, checked);
  if (view.relation) { const note = doc.createElement('p'); note.className = 'field-help update-package-note'; note.textContent = view.relation; container.append(note); }
  return view;
}
