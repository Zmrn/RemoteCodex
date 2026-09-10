// A bounded, read-only view of the verified desktop's own local history.
// The index contains offsets/IDs, not a second conversation or runtime state.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { OFFICIAL } from './official-protocol.mjs';
const spec = OFFICIAL.storage.rolloutHistory;
const uuid = value => typeof value === 'string' && /^[a-f0-9-]{36}$/.test(value);
const hash = value => createHash('sha256').update(value).digest('hex');
const stamp = stat => [stat.dev, stat.ino, stat.size, stat.mtimeNs, stat.ctimeNs].join(':');
const beneath = (base, file) => { const relative = path.relative(base, file); return relative && !relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative); };
const recordTypes = new Set(['UserMessage','AgentMessage','CommandExecution','FileChange','FunctionCallOutput']);
const visible = item => recordTypes.has(item?.type) || item?.type === 'Extension' && item.kind === 'image_gen.generation';
const changed = () => Error('官方历史已变化，请刷新会话后继续加载；已显示内容和草稿已保留');

async function locate(home, id) {
  if (!uuid(id) || !path.isAbsolute(home) || /^[\\/]{2}/.test(home)) throw Error('官方本机历史目录不可用');
  const realHome = await fsp.realpath(home), matches = [];
  let count = 0;
  async function walk(directory, depth) {
    let entries;
    try { entries = await fsp.readdir(directory, { withFileTypes: true }); }
    catch (error) { if (error.code === 'ENOENT') return; throw error; }
    for (const entry of entries) {
      if (++count > spec.maxDirectoryEntries) throw Error('官方历史目录过大，无法确定任务文件');
      const file = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory() && depth < 3 && /^\d{2,4}$/.test(entry.name)) await walk(file, depth + 1);
      else if (entry.isFile() && entry.name.endsWith('-' + id + '.jsonl') && entry.name.startsWith('rollout-')) matches.push(file);
    }
  }
  for (const name of spec.directories) {
    const directory = path.join(realHome, name);
    try { if ((await fsp.lstat(directory)).isSymbolicLink()) continue; } catch (e) { if (e.code === 'ENOENT') continue; throw e; }
    await walk(directory, 0);
  }
  if (matches.length !== 1) throw Error('未能唯一确认此任务的官方本机历史文件');
  const real = await fsp.realpath(matches[0]);
  if (!beneath(realHome, real) || real !== path.resolve(matches[0])) throw Error('官方历史路径已变化');
  return real;
}

// Skip large raw model/tool payloads without assembling their lines in memory.
// Only the official completed-item event format is projected into display items.
async function* records(file, limit, check) {
  const stream = fs.createReadStream(file, { highWaterMark: 256 * 1024, start: 0, end: limit - 1 });
  let fragments = [], length = 0, offset = 0, prefix = Buffer.alloc(0), wanted = null;
  try {
    for await (const chunk of stream) {
      check();
      let start = 0;
      while (start < chunk.length) {
        const lf = chunk.indexOf(10, start), end = lf < 0 ? chunk.length : lf;
        const part = chunk.subarray(start, end);
        length += part.length;
        if (prefix.length < 1024) prefix = Buffer.concat([prefix, part.subarray(0, 1024 - prefix.length)]);
        if (wanted === null) {
          const type = /"type"\s*:\s*"([^"]+)"/.exec(prefix.toString('utf8'))?.[1];
          if (type) wanted = type === 'session_meta' || type === 'event_msg';
          else if (prefix.length === 1024) throw Error('官方历史记录格式无法识别');
        }
        if (wanted !== false) {
          if (length > spec.maxRecordBytes) throw Error('单条官方历史记录超过安全读取上限，已保留当前内容');
          fragments.push(part);
        } else fragments = [];
        if (lf < 0) break;
        if (wanted !== false) {
          let value; const bytes = Buffer.concat(fragments, length);
          try { value = JSON.parse(bytes.toString('utf8')); } catch { throw Error('官方历史中存在无法解析的完整记录，未跳过该位置'); }
          yield { value, offset, length, digest: hash(bytes) };
        }
        offset += length + 1; start = lf + 1;
        fragments = []; length = 0; prefix = Buffer.alloc(0); wanted = null;
      }
    }
    // A writer may not have completed the final line yet. Never parse a torn record.
  } finally {
    // A consumer can reject a yielded record before the stream reaches EOF.
    // destroy() starts asynchronous close; await it so Windows does not retain
    // the history handle after a failed/cancelled scan has returned.
    if (!stream.closed) await new Promise(resolve => {
      stream.once('close', resolve);
      stream.destroy();
    });
  }
}

function textContent(content) {
  if (!Array.isArray(content)) throw Error('官方消息正文结构尚不支持');
  return content.filter(c => ['text','Text','input_text','output_text'].includes(c?.type)).map(c => {
    if (typeof c.text !== 'string') throw Error('官方消息文字结构尚不支持'); return c.text;
  }).join('\n');
}
function readRecord(index, entry) {
  if (fs.realpathSync(index.file) !== index.file || stamp(fs.statSync(index.file, { bigint: true })) !== index.stamp) throw changed();
  const fd = fs.openSync(index.file, 'r');
  try {
    if (stamp(fs.fstatSync(fd, { bigint: true })) !== index.stamp) throw changed();
    const bytes = Buffer.alloc(entry.length);
    let count = 0;
    while (count < bytes.length) { const n = fs.readSync(fd, bytes, count, bytes.length - count, entry.offset + count); if (!n) throw changed(); count += n; }
    if (stamp(fs.fstatSync(fd, { bigint: true })) !== index.stamp || hash(bytes) !== entry.digest) throw changed();
    return JSON.parse(bytes.toString('utf8')).payload.item;
  } finally { fs.closeSync(fd); }
}

export class RolloutHistory {
  constructor({ maxIndexes = 4, check = () => {} } = {}) {
    this.maxIndexes = maxIndexes; this.check = check; this.indexes = new Map(); this.cursors = new Map(); this.pending = new Map();
  }
  clear() { this.indexes.clear(); this.cursors.clear(); this.pending.clear(); }
  assertCurrent(id, revision) {
    const index = this.indexes.get(id);
    if (!index || index.revision !== revision || fs.realpathSync(index.file) !== index.file ||
        stamp(fs.statSync(index.file, {bigint:true})) !== index.stamp) throw changed();
  }
  async index(home, id, check) {
    const file = await locate(home, id); check();
    const stat = await fsp.stat(file, { bigint: true });
    if (!stat.isFile() || stat.size === 0n || stat.size > BigInt(spec.maxFileBytes)) throw Error('官方历史文件大小不在可读取范围内');
    const signature = stamp(stat), existing = this.indexes.get(id);
    if (existing?.file === file && existing.stamp === signature) return existing;
    const key = id + ':' + file + ':' + signature;
    if (this.pending.has(key)) return this.pending.get(key);
    const work = this.build(file, id, signature, Number(stat.size), check);
    this.pending.set(key, work);
    try {
      const index = await work; check();
      this.indexes.delete(id); this.indexes.set(id, index);
      while (this.indexes.size > this.maxIndexes) this.indexes.delete(this.indexes.keys().next().value);
      return index;
    } finally { this.pending.delete(key); }
  }
  async build(file, id, signature, size, check) {
    const turns = new Map(); let meta = false, items = 0;
    const deadline = Date.now() + spec.maxScanMs;
    const current = () => { check(); this.check(); if (Date.now() > deadline) throw Error('官方历史扫描超时，已保留当前内容'); };
    for await (const record of records(file, size, current)) {
      const { value } = record, p = value.payload;
      if (value.type === 'session_meta') {
        if (record.offset !== 0 || p?.id !== id) throw Error('官方历史与当前任务身份不一致');
        meta = true; continue;
      }
      if (!meta || !p || typeof p.type !== 'string') throw Error('官方历史缺少可确认的任务身份');
      if (p.type === 'thread_rolled_back') {
        if (!Number.isSafeInteger(p.num_turns) || p.num_turns < 0 || p.num_turns > turns.size) throw Error('官方历史回退记录无法识别');
        if (p.num_turns) for (const turnId of [...turns.keys()].slice(-p.num_turns)) turns.delete(turnId);
        continue;
      }
      if (!['task_started','item_completed'].includes(p.type)) continue;
      if (!uuid(p.turn_id) || p.thread_id && p.thread_id !== id) throw Error('官方历史轮次身份无法确认');
      if (!turns.has(p.turn_id)) turns.set(p.turn_id, { id:p.turn_id, startedAt:Date.parse(value.timestamp) / 1000, entries:new Map() });
      const turn = turns.get(p.turn_id);
      if (p.type === 'task_started') { if (Number.isFinite(p.started_at)) turn.startedAt = p.started_at / 1000; continue; }
      if (!visible(p.item)) continue;
      if (typeof p.item.id !== 'string' || !p.item.id || p.item.id.length > 256) throw Error('官方历史消息身份无法确认');
      if (++items > spec.maxItems) throw Error('官方历史索引超过安全上限');
      const { offset, length, digest } = record;
      turn.entries.set(p.item.id, { offset, length, digest, itemId:p.item.id, turnId:p.turn_id });
    }
    current();
    if (!meta || stamp(await fsp.stat(file, { bigint:true })) !== signature) throw changed();
    const rows = [...turns.values()].reverse().flatMap(turn => [...turn.entries.values()].map((e,n) => ({...e, itemIndex:n})).reverse());
    if (!rows.length) throw Error('官方历史没有可识别的完整消息，未返回空成功页');
    return { file, stamp:signature, revision:randomUUID(), rows, turns };
  }
  async read({ home, thread, cursor = null, beforeTurnId = null, media, check = () => {} }) {
    if (thread?.kind !== 'codex' || thread.hostId !== OFFICIAL.discovery.hostId || !uuid(thread.id)) throw Error('仅支持当前官方本机 Codex 历史');
    const index = await this.index(home, thread.id, check); check();
    let offset = 0;
    if (cursor) {
      const saved = this.cursors.get(cursor);
      if (!saved || saved.id !== thread.id || saved.revision !== index.revision) throw changed();
      offset = saved.offset;
    } else if (beforeTurnId) {
      const boundary = [...index.turns.keys()].indexOf(beforeTurnId);
      if (boundary < 0) throw Error('无法对齐官方历史游标，未跳过未知内容；请重新打开会话');
      const older = new Set([...index.turns.keys()].slice(0, boundary));
      offset = index.rows.findIndex(e => older.has(e.turnId));
      if (offset < 0) throw Error('官方历史游标与本机文件不一致，请重新打开会话');
    }
    const turns = new Map(); let bytes = 0, end = offset;
    for (; end < index.rows.length && end - offset < 40; end++) {
      check(); const entry = index.rows[end], raw = readRecord(index, entry);
      const item = this.item(index, entry, raw, thread.id, media, check);
      const length = Buffer.byteLength(JSON.stringify(item));
      if (end > offset && bytes + length > 128 * 1024) break;
      bytes += length;
      if (!turns.has(entry.turnId)) {
        const original = index.turns.get(entry.turnId);
        turns.set(entry.turnId, { id:entry.turnId, status:'history', startedAt:original.startedAt, items:[],
          bridgeHistoryItemIds:[...original.entries.keys()] });
      }
      turns.get(entry.turnId).items.unshift({ ...item, bridgeItemIndex:entry.itemIndex });
    }
    if (stamp(await fsp.stat(index.file, {bigint:true})) !== index.stamp) throw changed();
    check(); let nextCursor = null;
    if (end < index.rows.length) {
      nextCursor = 'rollout:' + randomUUID();
      this.cursors.set(nextCursor,{ id:thread.id, revision:index.revision, offset:end });
      while (this.cursors.size > 1024) this.cursors.delete(this.cursors.keys().next().value);
    }
    // Completion events in a file do not authorize sending, stopping or clearing unread.
    return { thread:{ ...thread, status:typeof thread.status === 'string' ? {type:thread.status} : thread.status ?? {type:'unknown'} },
      turns:[...turns.values()], history:{ source:'official-rollout', revision:index.revision },
      page:{ order:'newest_first', nextCursor, hasMore:!!nextCursor }, bridgeHistoryFallback:true };
  }
  item(index, entry, raw, threadId, media, check) {
    const images = [], base = { id:raw.id, status:'history' };
    const source = {file:index.file,stamp:index.stamp}, revision = index.revision;
    const lazy = (field, name) => {
      const ref = media.addDeferred(threadId, revision + ':' + entry.offset + ':' + field, () => {
        check(); const current = readRecord(source, entry);
        const image = field === 'result' ? current.result : current.content?.[Number(field)]?.url ?? current.content?.[Number(field)]?.image_url;
        if (typeof image !== 'string') throw Error('官方图片记录格式尚不支持');
        return image.startsWith('data:') ? image : 'data:image/png;base64,' + image;
      }, name);
      const image = field === 'result' ? raw.result : raw.content?.[Number(field)]?.url ?? raw.content?.[Number(field)]?.image_url;
      images.push({ ...ref, contentKey: hash(typeof image === 'string' ? image : entry.digest + ':' + field) });
    };
    if (raw.type === 'AgentMessage') return {...base,type:'agentMessage',text:textContent(raw.content)};
    if (raw.type === 'UserMessage') {
      for (const [n,c] of (raw.content ?? []).entries()) if (['image','Image','input_image'].includes(c?.type)) lazy(String(n),'图片');
      return {...base,type:'userMessage',content:[{type:'text',text:textContent(raw.content)},...(raw.content??[]).filter(c=>c.type==='localImage')],bridgeHistoryImages:images};
    }
    if (raw.type === 'Extension') {
      if (typeof raw.result === 'string' && raw.result) lazy('result','生成图片.png');
      return {...base,type:'imageGeneration',savedPath:images.length ? undefined : raw.savedPath,bridgeHistoryImages:images};
    }
    if (raw.type === 'CommandExecution') return {...base,type:'commandExecution',command:Array.isArray(raw.command)?raw.command.join(' '):raw.command,
      output:String(raw.aggregated_output??raw.stdout??'').slice(0,6000)};
    if (raw.type === 'FileChange') return {...base,type:'fileChange',changes:Object.entries(raw.changes??{}).map(([file,value])=>({path:file,kind:value.type,diff:String(value.unified_diff??value.content??'').slice(0,12000)}))};
    return {...base,type:'functionCallOutput',namespace:raw.namespace,output:String(raw.output??'').slice(0,12000)};
  }
}
