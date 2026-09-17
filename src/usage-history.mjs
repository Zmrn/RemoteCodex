import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export const SAMPLE_MS = 5 * 60 * 1000;
export const RETENTION_MS = 365 * 86400000;
const validDays = days => [1, 7, 30].includes(days);
export const historyWindows = usage => {
  if (usage?.source !== 'official-desktop-app-tools-live' || usage.status !== 'available') return [];
  const rows = new Map();
  for (const [field, duration] of [['weekly', 10080], ['fiveHour', 300]]) {
    for (const row of usage[field] ?? []) {
      if (typeof row?.limitId !== 'string' || !row.limitId || row.limitId.length > 200 ||
        typeof row.remainingPercent !== 'number' || !Number.isFinite(row.remainingPercent) ||
        row.remainingPercent < 0 || row.remainingPercent > 100) continue;
      const key = JSON.stringify([row.limitId, duration]);
      const value = { limitId: row.limitId, duration, remaining: row.remainingPercent,
        label: typeof row.label === 'string' ? row.label.slice(0, 120) : row.limitId,
        resetsAt: Number.isFinite(row.resetsAt) && row.resetsAt > 0 ? row.resetsAt : null };
      rows.set(key, rows.has(key) ? null : value); // Ambiguous duplicate windows are not inferred.
    }
  }
  return [...rows.values()].filter(Boolean).slice(0, 32);
};

// A dedicated SQLite database: transactional pruning+sampling, no rewrites of
// device settings, credentials, drafts or official state. Multiple processes
// serialize in SQLite, and an older observation cannot replace a newer sample.
export class UsageHistory {
  constructor(dataDir, { now = Date.now } = {}) {
    this.file = path.join(dataDir, 'usage-history.sqlite'); this.now = now;
  }
  open() {
    if (this.db) return this.db;
    let db;
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      db = new DatabaseSync(this.file);
      db.exec('PRAGMA busy_timeout=2000; PRAGMA synchronous=FULL; PRAGMA secure_delete=ON;');
      if (db.prepare('PRAGMA quick_check').get().quick_check !== 'ok') throw Error('Integrity check failed');
      const version = db.prepare('PRAGMA user_version').get().user_version;
      if (version !== 0 && version !== 1) throw Error('Unknown schema');
      if (!version) {
        db.exec('BEGIN IMMEDIATE');
        try {
          // Recheck after acquiring the transaction: another instance may have initialized it.
          if (!db.prepare('PRAGMA user_version').get().user_version) {
            if (db.prepare("SELECT name FROM sqlite_master WHERE type='table'").get()) throw Error('Unexpected database');
            db.exec(`CREATE TABLE samples(
              slot INTEGER NOT NULL, limit_id TEXT NOT NULL, duration INTEGER NOT NULL,
              at INTEGER NOT NULL, remaining REAL NOT NULL, resets_at REAL,
              label TEXT NOT NULL, segment TEXT NOT NULL,
              PRIMARY KEY(slot,limit_id,duration)
            ) WITHOUT ROWID;
            CREATE INDEX samples_at ON samples(at);
            PRAGMA user_version=1;`);
          }
          db.exec('COMMIT');
        } catch (e) { db.exec('ROLLBACK'); throw e; }
      }
      this.db = db; return db;
    } catch (cause) {
      db?.close();
      throw Error('额度历史无法读取，原文件已保留；请检查目标设备的数据目录后重试', { cause });
    }
  }
  transaction(fn) {
    const db = this.open(); db.exec('BEGIN IMMEDIATE');
    try { const result = fn(db); db.exec('COMMIT'); return result; }
    catch (e) { db.exec('ROLLBACK'); throw e; }
  }
  prune() {
    if (!this.db && !fs.existsSync(this.file)) return;
    return this.transaction(db => db.prepare('DELETE FROM samples WHERE at < ?').run(this.now() - RETENTION_MS));
  }
  record(usage, segment) {
    const at = Date.parse(usage?.observedAt), now = this.now();
    const rows = historyWindows(usage);
    if (!Number.isSafeInteger(at) || at <= 0 || at > now || now - at > SAMPLE_MS * 2 ||
      typeof segment !== 'string' || !segment || segment.length > 80 || !rows.length) return false;
    this.transaction(db => {
      db.prepare('DELETE FROM samples WHERE at < ?').run(now - RETENTION_MS);
      const insert = db.prepare(`INSERT INTO samples(slot,limit_id,duration,at,remaining,resets_at,label,segment)
        VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(slot,limit_id,duration) DO UPDATE SET
        at=excluded.at,remaining=excluded.remaining,resets_at=excluded.resets_at,label=excluded.label,segment=excluded.segment
        WHERE excluded.at > samples.at`);
      for (const row of rows) insert.run(Math.floor(at / SAMPLE_MS), row.limitId, row.duration, at, row.remaining, row.resetsAt, row.label, segment);
    });
    return true;
  }
  read(days = 7) {
    if (!validDays(days)) throw Error('仅支持最近 1 天、7 天或 30 天');
    const now = this.now();
    const rows = this.transaction(db => {
      db.prepare('DELETE FROM samples WHERE at < ?').run(now - RETENTION_MS);
      return db.prepare('SELECT limit_id,duration,at,remaining,resets_at,label,segment FROM samples WHERE at >= ? AND at <= ? ORDER BY at').all(now - days * 86400000, now);
    });
    const series = new Map();
    for (const row of rows) {
      const key = JSON.stringify([row.limit_id, row.duration]);
      if (!series.has(key)) series.set(key, { key, limitId: row.limit_id, windowDurationMins: row.duration, label: row.label, points: [] });
      const entry = series.get(key); entry.label = row.label;
      entry.points.push({ at: row.at, remainingPercent: row.remaining, resetsAt: row.resets_at, segment: row.segment });
    }
    return { schemaVersion: 1, source: 'target-device-local-observations', days, from: now - days * 86400000, to: now,
      retentionDays: 365, sampleMinutes: SAMPLE_MS / 60000,
      series: [...series.values()].sort((a, b) => Number(b.limitId === 'codex') - Number(a.limitId === 'codex') ||
        a.limitId.localeCompare(b.limitId) || b.windowDurationMins - a.windowDurationMins) };
  }
  close() { this.db?.close(); this.db = null; }
}
