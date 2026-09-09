import fs from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { PYTHON, INSTANCE } from "./runtime.mjs";

const checksum = value => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const data = value => ({ revision: value.revision ?? 0, selectedId: value.selectedId, items: value.items });

function validate(value) {
  if (!value || !Array.isArray(value.items) || !value.items.length ||
      !Number.isSafeInteger(value.revision ?? 0) || (value.revision ?? 0) < 0)
    throw Error("Invalid device registry");
  const ids = new Set();
  for (const row of value.items) {
    if (!row || typeof row.id !== "string" || !row.id || ids.has(row.id) ||
        typeof row.name !== "string" || !row.name.trim() ||
        typeof row.host !== "string" || !Number.isInteger(row.port) || row.port < 1 || row.port > 65535 ||
        (row.id === "local" ? row.kind !== "local" : row.kind !== "remote") ||
        (row.sealedKey !== undefined && typeof row.sealedKey !== "string"))
      throw Error("Invalid device registry");
    ids.add(row.id);
  }
  if (!ids.has("local") || !ids.has(value.selectedId)) throw Error("Invalid device selection");
  if ((value.format !== undefined || value.checksum !== undefined || value.revision !== undefined) &&
      (value.format !== 1 || value.checksum !== checksum(data(value))))
    throw Error("Invalid device registry checksum");
  return value;
}

function read(file) {
  let raw;
  try { raw = fs.readFileSync(file, "utf8"); }
  catch (error) {
    if (error.code === "ENOENT") return { missing: true };
    // Access errors must not silently turn an existing installation into a new one.
    throw Error("无法读取设备配置，请检查文件访问权限；未重置已有设备", { cause: error });
  }
  try { return { value: validate(JSON.parse(raw.replace(/^\uFEFF/, ""))) }; }
  catch { return { invalid: true }; }
}

// Independent, immutable checkpoints survive an accidental replacement of both
// rolling replicas. Selection-only writes do not consume device history.
function history(file) {
  const dir = file + ".history";
  let names;
  try { names = fs.readdirSync(dir).filter(n => /^\d{16}-[a-f0-9]{64}\.json$/.test(n)).sort().reverse(); }
  catch (error) {
    if (error.code === "ENOENT") return null;
    throw Error("无法读取设备配置历史；未重置已有设备", { cause: error });
  }
  if (!names.length) return null;
  try {
    const entry = JSON.parse(fs.readFileSync(path.join(dir, names[0]), "utf8"));
    validate(entry.registry);
    const { checksum: digest, ...body } = entry;
    if (digest !== checksum(body) || names[0] !== historyName(entry.registry)) throw Error();
    // Two different states claiming the same revision must never be guessed.
    if (names[1]?.slice(0, 16) === names[0].slice(0, 16)) throw Error();
    return entry.registry;
  } catch (cause) {
    throw Error("最新设备配置历史无法校验；已保留原文件，未重置已有设备", { cause });
  }
}
const historyName = db => String(db.revision).padStart(16, "0") + "-" + db.checksum + ".json";
function checkpoint(file, db, operation) {
  const dir = file + ".history";
  fs.mkdirSync(dir, { recursive: true });
  const target = path.join(dir, historyName(db));
  const body = { registry: db, operation, at: new Date().toISOString(), pid: process.pid, version: INSTANCE.version };
  // The caller holds the registry lock; an existing checkpoint is immutable.
  if (!fs.existsSync(target)) replace(target, JSON.stringify({ ...body, checksum: checksum(body) }, null, 2));
}

// Called under the same OS lock before a server exposes its first API request.
export function preserveAgents(file) {
  const saved = readAgents(file, true)?.db;
  const archived = history(file);
  if (saved && (!archived || checksum(saved.items) !== checksum(archived.items))) {
    const prior = data(saved);
    checkpoint(file, { format: 1, ...prior, checksum: checksum(prior) }, { type: "baseline" });
  }
}

export function readAgents(file, allowEmpty) {
  const main = read(file), backup = read(file + ".bak");
  const archived = history(file);
  if (main.value && backup.value && (main.value.revision ?? 0) === (backup.value.revision ?? 0) &&
      checksum(data(main.value)) !== checksum(data(backup.value)))
    throw Error("设备配置同一修订内容冲突；已保留原文件，未重置已有设备");
  let saved;
  if (main.value && (!backup.value || (main.value.revision ?? 0) >= (backup.value.revision ?? 0)))
    saved = { db: main.value, storage: { source: "primary", recovered: false } };
  else if (backup.value)
    saved = { db: backup.value, storage: { source: "backup", recovered: true,
      warning: "设备配置主副本未完成或已损坏，已从备份恢复读取" } };
  if (archived && (!saved || archived.revision > (saved.db.revision ?? 0)))
    return { db: archived, storage: { source: "history", recovered: true,
      warning: "设备配置副本缺失、损坏或发生回退，已从独立历史恢复读取" } };
  if (archived && saved && archived.revision === saved.db.revision && archived.checksum !== saved.db.checksum)
    throw Error("设备配置同一修订内容冲突；已保留原文件，未重置已有设备");
  if (archived && saved && (saved.db.revision ?? 0) > archived.revision &&
      archived.items.some(a => !saved.db.items.some(b => b.id === a.id)))
    throw Error("检测到没有独立历史记录的设备删除；已保留全部副本，请核对后恢复，未重置已有设备");
  if (saved) return saved;
  if (main.missing && backup.missing && allowEmpty) return null;
  throw Error("设备配置及备份无法读取；已保留原文件，未重置已有设备");
}

function replace(file, raw) {
  const temp = file + "." + randomUUID() + ".tmp";
  try {
    const fd = fs.openSync(temp, "wx", 0o600);
    try { fs.writeFileSync(fd, raw); fs.fsyncSync(fd); }
    finally { fs.closeSync(fd); }
    fs.renameSync(temp, file);
  } finally {
    try { fs.unlinkSync(temp); } catch (e) { if (e.code !== "ENOENT") throw e; }
  }
}

export function writeAgents(file, db, operation = { type: "save" }) {
  const before = readAgents(file, true)?.db;
  if (before && (before.revision ?? 0) !== (db.revision ?? 0))
    throw Error("设备配置已变化，请刷新后重试；未覆盖已有设备");
  const removed = before?.items.filter(a => !db.items.some(b => b.id === a.id)) ?? [];
  if (removed.some(a => operation.type !== "remove" || a.id !== operation.id))
    throw Error("拒绝非删除操作移除已有设备；未覆盖已有设备");
  if (operation.type === "select" && before && checksum(before.items) !== checksum(db.items))
    throw Error("切换设备不能修改设备配置；未覆盖已有设备");
  if (before && before.items.some(a => a.id !== operation.id &&
      checksum(a) !== checksum(db.items.find(b => b.id === a.id))))
    throw Error("拒绝修改本次操作以外的设备；未覆盖已有设备");
  const next = { ...data(db), revision: (db.revision ?? 0) + 1 };
  const snapshot = { format: 1, ...next, checksum: checksum(next) };
  validate(snapshot);
  const raw = JSON.stringify(snapshot, null, 2);
  const archived = history(file);
  // Capture the pre-upgrade state too. Legacy data is normalized without
  // changing IDs or sealed keys. No history is silently overwritten or pruned.
  if (before && (!archived || checksum(before.items) !== checksum(archived.items))) {
    const prior = data(before);
    checkpoint(file, { format: 1, ...prior, checksum: checksum(prior) }, { type: "baseline" });
  }
  if (!before || checksum(before.items) !== checksum(snapshot.items))
    checkpoint(file, snapshot, operation);
  // The backup is also a committed replica. A crash between these two atomic
  // replacements is recovered by choosing the highest valid revision. Device
  // changes are committed by the checkpoint first, including explicit deletes.
  try { replace(file + ".bak", raw); }
  catch (cause) {
    throw Error("设备配置副本写入失败；请刷新确认独立历史中的保存结果，勿重复新增设备", { cause });
  }
  try { replace(file, raw); }
  catch (cause) {
    throw Error("设备配置备份已保存，但主副本写入失败；请刷新确认，勿重复新增设备", { cause });
  }
  return snapshot;
}

// An OS-owned byte lock survives neither a launcher crash nor a killed helper.
// A persistent lock file is harmless; no PID guessing or stale-lock deletion.
export function lockAgents(file) {
  return new Promise((resolve, reject) => {
    const child = spawn(PYTHON, [fileURLToPath(new URL("./win_agent_lock.py", import.meta.url)), file + ".lock"],
      { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
    let ready = false, output = "";
    const failure = () => reject(Error("设备配置正被占用或无法锁定，请稍后重试；未覆盖已有设备"));
    const timer = setTimeout(() => { child.kill(); failure(); }, 15000);
    child.stderr.resume();
    child.stdin.on("error", () => {});
    child.once("error", () => { clearTimeout(timer); failure(); });
    child.once("close", () => { clearTimeout(timer); if (!ready) failure(); });
    child.stdout.on("data", chunk => {
      output += chunk;
      if (!ready && /LOCKED\r?\n/.test(output)) {
        ready = true;
        clearTimeout(timer);
        resolve(async work => {
          try {
            if (child.exitCode !== null || child.killed) throw Error("设备配置锁已断开，请重试");
            // work is synchronous, so the lock cannot be released mid-transaction.
            return work();
          } finally {
            const closed = new Promise(r => child.once("close", r));
            child.stdin.end();
            if (child.exitCode === null) await closed;
          }
        });
      }
    });
  });
}
