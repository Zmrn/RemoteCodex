import fs from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { PYTHON } from "./runtime.mjs";

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

export function readAgents(file, allowEmpty) {
  const main = read(file), backup = read(file + ".bak");
  if (main.value && (!backup.value || (main.value.revision ?? 0) >= (backup.value.revision ?? 0)))
    return { db: main.value, storage: { source: "primary", recovered: false } };
  if (backup.value)
    return { db: backup.value, storage: { source: "backup", recovered: true,
      warning: "设备配置主副本未完成或已损坏，已从备份恢复读取" } };
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

export function writeAgents(file, db) {
  const next = { ...data(db), revision: (db.revision ?? 0) + 1 };
  const snapshot = { format: 1, ...next, checksum: checksum(next) };
  validate(snapshot);
  const raw = JSON.stringify(snapshot, null, 2);
  // The backup is also a committed replica. A crash between these two atomic
  // replacements is recovered by choosing the highest valid revision.
  replace(file + ".bak", raw);
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
