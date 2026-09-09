import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { readAgents } from "./agent-storage.mjs";

const digest = value => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const configFiles = ["agents.json", "agents.json.bak", "remote-access.json", "update-settings.json"];
function saveSnapshot(file, bytes) {
  const fd = fs.openSync(file, "wx", 0o600);
  try { fs.writeFileSync(fd, bytes); fs.fsyncSync(fd); }
  finally { fs.closeSync(fd); }
}

// The update helper calls this after the old bridge exits, before replacing the
// EXE. Backups contain only the original DPAPI-sealed keys, never plaintext.
export function captureDeviceUpdate(dataDir, destination) {
  const db = readAgents(path.join(dataDir, "agents.json"), true)?.db;
  fs.mkdirSync(destination, { recursive: true });
  for (const name of configFiles) {
    let bytes;
    try { bytes = fs.readFileSync(path.join(dataDir, name)); }
    catch (error) { if (error.code === "ENOENT") continue; throw error; }
    saveSnapshot(path.join(destination, name), bytes);
  }
  if (db) saveSnapshot(path.join(destination, "effective-agents.json"), JSON.stringify(db, null, 2));
  return { items: db?.items ?? [], snapshotDirectory: destination };
}

export function verifyDeviceUpdate(dataDir, snapshot) {
  const after = readAgents(path.join(dataDir, "agents.json"), true)?.db;
  if (digest(after?.items ?? []) !== digest(snapshot.items))
    throw Error("更新后设备配置发生变化；已保留更新前快照，不能将本次更新标记为成功");
  for (const name of ["remote-access.json", "update-settings.json"]) {
    const before = path.join(snapshot.snapshotDirectory, name), current = path.join(dataDir, name);
    if (fs.existsSync(before) && (!fs.existsSync(current) ||
        digest(JSON.parse(fs.readFileSync(before, "utf8"))) !== digest(JSON.parse(fs.readFileSync(current, "utf8")))))
      throw Error("更新后接入或更新设置发生变化；已保留更新前快照，不能将本次更新标记为成功");
  }
}
