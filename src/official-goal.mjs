import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn, execFile } from 'node:child_process';
import { createInterface } from 'node:readline';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

export function goalInput(objective, tokenBudget) {
  if (typeof objective !== 'string' || !objective.trim() || objective.length > 4000)
    throw Error('目标须为 1–4000 个字符');
  if (tokenBudget !== undefined && tokenBudget !== null &&
      (!Number.isSafeInteger(tokenBudget) || tokenBudget < 1 || tokenBudget > 10_000_000))
    throw Error('Token 预算须为 1–10000000 的整数');
  return { objective: objective.trim(), ...(tokenBudget == null ? {} : { tokenBudget }) };
}

export function goalPrompt(goal, { edit = false } = {}) {
  const data = JSON.stringify({ objective: goal.objective,
    ...(goal.tokenBudget == null ? {} : { token_budget: goal.tokenBudget }) });
  return edit
    ? `请使用官方 Goal 工具把当前目标更新为下面 JSON 中的 objective，保持目标文字原样；${goal.tokenBudget == null ? '沿用当前 Token 预算。' : '将 token_budget 设为给定数值。'}更新后继续执行新目标。请勿仅在聊天里确认，必须实际调用 Goal 工具。\n${data}`
    : `请进入 Goal 模式：先调用官方 create_goal 工具，将下面 JSON 中的 objective 原样设为目标${goal.tokenBudget == null ? '' : '，并使用给定 token_budget'}，然后开始执行。请勿把本段设置说明写入目标，也不要只在聊天里确认。\n${data}`;
}
export function goalSyncPrompt(goal) {
  return `当前官方 Goal 目标已被用户改为下面 JSON 的 objective。请立即按新目标调整当前工作，调用 get_goal 核对，再调用 update_goal 将状态设为 active，以便当前桌面会话同步目标；不要调用 create_goal，也不要把本段说明当作目标。\n${JSON.stringify({ objective: goal.objective })}`;
}

async function officialBinary() {
  if (process.platform !== 'win32') throw Error('官方 Goal 接口目前仅支持 Windows 目标设备');
  const root = path.join(process.env.LOCALAPPDATA ?? path.join(os.homedir(), 'AppData', 'Local'), 'OpenAI', 'Codex', 'bin');
  const folders = await fs.readdir(root, { withFileTypes: true });
  const candidates = [];
  for (const folder of folders) {
    if (!folder.isDirectory() || !/^[a-f0-9]{8,64}$/i.test(folder.name)) continue;
    const file = path.join(root, folder.name, 'codex.exe');
    try { const stat = await fs.stat(file); if (stat.isFile()) candidates.push({ file, modified: stat.mtimeMs }); } catch {}
  }
  candidates.sort((a, b) => b.modified - a.modified);
  for (const candidate of candidates) {
    const quoted = candidate.file.replaceAll("'", "''");
    const script = `$s=Get-AuthenticodeSignature -LiteralPath '${quoted}'; [pscustomobject]@{status=[string]$s.Status;subject=$s.SignerCertificate.Subject} | ConvertTo-Json -Compress`;
    try {
      const modules = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'Modules');
      const { stdout } = await exec('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script],
        { windowsHide: true, timeout: 12000, maxBuffer: 4096, env: { ...process.env, PSModulePath: modules } });
      const signature = JSON.parse(stdout);
      if (signature.status === 'Valid' && /OpenAI/i.test(signature.subject ?? '')) return candidate.file;
    } catch {}
  }
  throw Error('未找到签名有效的官方 Codex app-server；无法确认 Goal 状态');
}

// New goals are created through the desktop-owned conversation so its auto-run
// loop observes them. Existing goals use the official app-server set method;
// the separate process may not notify the desktop owner in real time.
export class OfficialGoalReader {
  constructor({ binaryResolver = officialBinary, spawnProcess = spawn } = {}) {
    this.binaryResolver = binaryResolver;
    this.spawnProcess = spawnProcess;
    this.pending = new Map();
    this.nextId = 0;
    this.generation = 0;
  }
  async connect(home) {
    if (!home || !path.isAbsolute(home)) throw Error('官方 Codex 数据目录不可用');
    if (this.connecting?.home === home) return this.connecting.promise;
    if (this.child && this.home === home && this.child.exitCode === null) return;
    const promise = this.open(home);
    this.connecting = { home, promise };
    try { await promise; } finally { if (this.connecting?.promise === promise) this.connecting = null; }
  }
  async open(home) {
    this.close();
    const generation = this.generation;
    const binary = await this.binaryResolver();
    if (generation !== this.generation) throw Error('官方 Goal 连接已变化，请重试');
    const child = this.spawnProcess(binary, ['app-server', '--stdio'], {
      windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, CODEX_HOME: home },
    });
    this.child = child;
    this.home = home;
    this.lines = createInterface({ input: child.stdout });
    this.lines.on('line', line => {
      if (line.length > 2_000_000) return;
      let message;
      try { message = JSON.parse(line); } catch { return; }
      const item = this.pending.get(message.id);
      if (!item) return;
      this.pending.delete(message.id);
      clearTimeout(item.timer);
      if (message.error) item.reject(Error(message.error.message ?? JSON.stringify(message.error)));
      else item.resolve(message.result);
    });
    const failPending = reason => {
      if (this.child !== child) return;
      this.child = null;
      for (const item of this.pending.values()) { clearTimeout(item.timer); item.reject(reason); }
      this.pending.clear();
    };
    child.once('error', error => failPending(Error('官方 Goal 读取进程启动失败：' + error.message)));
    child.once('exit', () => failPending(Error('官方 Goal 读取进程已结束')));
    child.stderr.on('data', () => {});
    try {
      await this.request('initialize', { clientInfo: { name: 'remote_codex_goal_reader', version: '1.0.0' } });
      child.stdin.write(JSON.stringify({ method: 'initialized' }) + '\n');
    } catch (error) { this.close(); throw error; }
  }
  request(method, params, timeoutMs = 15000) {
    const child = this.child;
    if (!child || child.exitCode !== null || child.stdin.destroyed) return Promise.reject(Error('官方 Goal 读取进程不可用'));
    return new Promise((resolve, reject) => {
      const id = ++this.nextId;
      const timer = setTimeout(() => { this.pending.delete(id); reject(Error('官方 Goal 读取超时')); }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      child.stdin.write(JSON.stringify({ id, method, params }) + '\n', error => {
        if (error && this.pending.delete(id)) { clearTimeout(timer); reject(error); }
      });
    });
  }
  async get(home, threadId) {
    if (!/^[a-f0-9-]{36}$/.test(threadId)) throw Error('Invalid official task ID');
    await this.connect(home);
    const response = await this.request('thread/goal/get', { threadId });
    if (!response || !Object.hasOwn(response, 'goal')) throw Error('官方 Goal 回执缺少目标状态');
    return response.goal;
  }
  async set(home, threadId, goal) {
    if (!/^[a-f0-9-]{36}$/.test(threadId)) throw Error('Invalid official task ID');
    await this.connect(home);
    const response = await this.request('thread/goal/set', {
      threadId, objective: goal.objective, status: 'active',
      ...(goal.tokenBudget == null ? {} : { tokenBudget: goal.tokenBudget }),
    }, 30000);
    if (response?.goal?.objective !== goal.objective || response.goal.status !== 'active')
      throw Error('官方目标更新回执未确认目标内容，请刷新核对');
    return response.goal;
  }
  async awaitObjective(home, threadId, objective, timeoutMs = 30000, tokenBudget) {
    const end = Date.now() + timeoutMs;
    let last = null;
    do {
      last = await this.get(home, threadId);
      if (last?.objective === objective && (tokenBudget === undefined || last.tokenBudget === tokenBudget))
        return { confirmed: true, goal: last };
      await wait(Math.min(1000, Math.max(0, end - Date.now())));
    } while (Date.now() < end);
    return { confirmed: false, goal: last };
  }
  close() {
    this.generation++;
    const child = this.child;
    this.child = null;
    this.home = null;
    this.lines?.close();
    for (const item of this.pending.values()) { clearTimeout(item.timer); item.reject(Error('官方 Goal 读取进程已关闭')); }
    this.pending.clear();
    child?.stdin?.end();
    child?.kill();
  }
}
