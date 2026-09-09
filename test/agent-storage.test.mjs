import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { Agents } from "../src/agents.mjs";
import { writeAgents } from "../src/agent-storage.mjs";
import { PYTHON } from "../src/runtime.mjs";

const root = path.resolve("test/scratch");
fs.mkdirSync(root, { recursive: true });
const temp = () => fs.mkdtempSync(path.join(root, "agent-storage-"));
const add = (a, n) => a.save({ name: "Fixture " + n, host: "100.70.8." + n, port: 43128 });

test("a stale instance refreshes reads and selection cannot overwrite devices saved by another instance", async () => {
  const dir = temp(), stale = new Agents(dir), writer = new Agents(dir);
  await add(writer, 10);
  const id = writer.list().agents.at(-1).id;
  assert.equal(stale.list().agents.length, 2);
  await stale.select("local");
  assert.equal(new Agents(dir).get(id).name, "Fixture 10");
  await writer.remove(id);
  await stale.save({ id: "local", name: "Renamed" });
  assert.equal(new Agents(dir).list().agents.length, 1);
  await assert.rejects(() => stale.select(id), /设备不存在/);
});

test("saved encrypted keys survive corrupt main, backup recovery and restart; deletion stays deleted", async () => {
  const dir = temp(), a = new Agents(dir);
  const key = "synthetic-storage-probe-only-1234";
  await a.save({ name: "Fixture", host: "100.70.8.10", port: 43128, key });
  const id = a.list().agents.at(-1).id;
  for (const file of [a.file, a.file + ".bak"])
    assert.ok(!fs.readFileSync(file, "utf8").includes(key));
  fs.writeFileSync(a.file, '{"partial":');
  const recovered = new Agents(dir);
  assert.equal(recovered.list().storage.recovered, true);
  assert.equal(await recovered.key(id), key);
  await recovered.remove(id);
  fs.writeFileSync(a.file, "\0".repeat(300));
  assert.equal(new Agents(dir).list().agents.length, 1);
});

test("missing main and valid JSON with altered contents both recover without accepting tampering", async () => {
  const a = new Agents(temp());
  await add(a, 10);
  fs.unlinkSync(a.file);
  assert.equal(a.list().agents.length, 2);
  await a.select("local");
  const altered = JSON.parse(fs.readFileSync(a.file));
  altered.items = altered.items.slice(0, 1);
  fs.writeFileSync(a.file, JSON.stringify(altered));
  assert.equal(a.list().agents.length, 2);
});

test("damaged replicas and unavailable latest history fail without default-only writes", async () => {
  const a = new Agents(temp());
  await add(a, 10);
  fs.writeFileSync(a.file, "broken-main");
  fs.writeFileSync(a.file + ".bak", "broken-backup");
  const archive = fs.readdirSync(a.file + ".history").sort().at(-1);
  fs.writeFileSync(path.join(a.file + ".history", archive), "broken-history");
  assert.throws(() => new Agents(path.dirname(a.file)), /未重置已有设备/);
  await assert.rejects(() => a.select("local"), /未重置已有设备/);
  assert.equal(fs.readFileSync(a.file, "utf8"), "broken-main");
  assert.equal(fs.readFileSync(a.file + ".bak", "utf8"), "broken-backup");
});

test("independent checkpoints survive replacement of both replicas with a valid old list", async () => {
  const dir = temp(), a = new Agents(dir);
  await a.select("local");
  const old = fs.readFileSync(a.file);
  const key = "synthetic-history-only-key-1234";
  await a.save({ name: "Company fixture", host: "100.70.8.20", port: 43128, key });
  const id = a.list().agents.at(-1).id;
  const historyFiles = fs.readdirSync(a.file + ".history");
  for (const name of historyFiles)
    assert.ok(!fs.readFileSync(path.join(a.file + ".history", name), "utf8").includes(key));
  fs.writeFileSync(a.file, old);
  fs.writeFileSync(a.file + ".bak", old);
  const restarted = new Agents(dir);
  assert.equal(restarted.list().storage.source, "history");
  assert.equal(restarted.get(id).name, "Company fixture");
  assert.equal(await restarted.key(id), key);
  await restarted.select("local");
  assert.equal(new Agents(dir).list().agents.length, 2);
  assert.deepEqual(fs.readdirSync(a.file + ".history"), historyFiles);
});

test("removing both rolling files does not look like a first launch; explicit deletion stays deleted", async () => {
  const dir = temp(), a = new Agents(dir);
  await add(a, 10);
  const id = a.list().agents.at(-1).id;
  await a.remove(id);
  fs.unlinkSync(a.file);
  fs.unlinkSync(a.file + ".bak");
  const restarted = new Agents(dir);
  assert.equal(restarted.list().storage.source, "history");
  assert.equal(restarted.list().agents.length, 1);
  assert.throws(() => restarted.get(id), /设备不存在/);
  await restarted.select("local");
  assert.equal(new Agents(dir).list().agents.length, 1);
});

test("ordinary saves cannot drop devices and stale writers cannot reset a newer revision", async () => {
  const a = new Agents(temp());
  await add(a, 10);
  const stale = structuredClone(a.db);
  await add(a, 11);
  const before = fs.readFileSync(a.file);
  assert.throws(() => writeAgents(a.file, stale), /配置已变化/);
  const missing = { ...a.db, items: a.db.items.slice(0, 1) };
  assert.throws(() => writeAgents(a.file, missing), /非删除操作/);
  assert.throws(() => writeAgents(a.file, missing, { type: "remove", id: a.db.items[1].id }), /非删除操作/);
  const unrelated = structuredClone(a.db);
  unrelated.items[1].name = "unexpected edit";
  assert.throws(() => writeAgents(a.file, unrelated, { type: "save", id: "local" }), /本次操作以外/);
  assert.deepEqual(fs.readFileSync(a.file), before);
});

test("a committed checkpoint recovers when both rolling replacements fail", async t => {
  const dir = temp(), a = new Agents(dir), rename = fs.renameSync;
  await add(a, 10);
  t.mock.method(fs, "renameSync", (from, to) => {
    if (to === a.file + ".bak") throw Object.assign(Error("simulated I/O failure"), { code: "EIO" });
    return rename(from, to);
  });
  await assert.rejects(() => add(a, 11), /独立历史中的保存结果/);
  assert.equal(new Agents(dir).list().agents.length, 3);
  assert.equal(new Agents(dir).list().storage.source, "history");
});

test("a failed history commit cannot acknowledge or overwrite a device save", async t => {
  const dir = temp(), a = new Agents(dir), rename = fs.renameSync;
  await add(a, 10);
  const before = fs.readFileSync(a.file), backup = fs.readFileSync(a.file + ".bak");
  t.mock.method(fs, "renameSync", (from, to) => {
    if (String(to).startsWith(a.file + ".history")) throw Object.assign(Error("simulated full disk"), { code: "ENOSPC" });
    return rename(from, to);
  });
  await assert.rejects(() => add(a, 11), { code: "ENOSPC" });
  assert.deepEqual(fs.readFileSync(a.file), before);
  assert.deepEqual(fs.readFileSync(a.file + ".bak"), backup);
  assert.equal(new Agents(dir).list().agents.length, 2);
});

test("unexpected device removal with a higher revision fails instead of silently adopting it", async () => {
  const a = new Agents(temp());
  await add(a, 10);
  const { createHash } = await import("node:crypto");
  const data = { revision: a.db.revision + 20, selectedId: "local", items: a.db.items.slice(0, 1) };
  const raw = JSON.stringify({ format: 1, ...data, checksum: createHash("sha256").update(JSON.stringify(data)).digest("hex") });
  fs.writeFileSync(a.file, raw);
  fs.writeFileSync(a.file + ".bak", raw);
  assert.throws(() => new Agents(path.dirname(a.file)), /没有独立历史记录的设备删除/);
  assert.equal(fs.readFileSync(a.file, "utf8"), raw);
});

test("startup preserves legacy devices before any selection without rewriting their replicas", async () => {
  const dir = temp(), file = path.join(dir, "agents.json");
  const original = JSON.stringify({ selectedId: "saved", items: [
    { id: "local", kind: "local", name: "Local", host: "fixture", port: 43127 },
    { id: "saved", kind: "remote", name: "Saved", host: "100.70.8.10", port: 43128 },
  ] });
  fs.writeFileSync(file, original);
  await new Agents(dir).preserve();
  assert.equal(fs.readFileSync(file, "utf8"), original);
  fs.unlinkSync(file);
  assert.equal(new Agents(dir).get("saved").name, "Saved");
});

test("repeated startup selections do not rewrite replicas or consume device history", async () => {
  const dir = temp(), a = new Agents(dir);
  await add(a, 10);
  const raw = fs.readFileSync(a.file), historyFiles = fs.readdirSync(a.file + ".history");
  for (let i = 0; i < 5; i++) await new Agents(dir).select("local");
  assert.deepEqual(fs.readFileSync(a.file), raw);
  assert.deepEqual(fs.readdirSync(a.file + ".history"), historyFiles);
});

test("permission-like read failures are never interpreted as missing configuration", t => {
  const a = new Agents(temp()), read = fs.readFileSync;
  t.mock.method(fs, "readFileSync", (file, ...args) => {
    if (file === a.file) throw Object.assign(Error("denied"), { code: "EACCES" });
    return read(file, ...args);
  });
  assert.throws(() => a.list(), /访问权限/);
});

test("a failed primary replacement recovers the newest committed replica, including a deletion", async t => {
  const a = new Agents(temp());
  await add(a, 10);
  const id = a.list().agents.at(-1).id, rename = fs.renameSync;
  t.mock.method(fs, "renameSync", (from, to) => {
    if (to === a.file) throw Object.assign(Error("simulated interrupted primary commit"), { code: "EIO" });
    return rename(from, to);
  });
  await assert.rejects(() => a.remove(id), /备份已保存/);
  assert.equal(new Agents(path.dirname(a.file)).list().agents.length, 1);
  assert.ok(!fs.readdirSync(path.dirname(a.file)).some(f => f.endsWith(".tmp")));
});

test("independent processes serialize device additions without lost updates", async () => {
  const dir = temp();
  const children = Array.from({ length: 4 }, (_, i) => spawn(process.execPath,
    ["--input-type=module", "-e", `import {Agents} from './src/agents.mjs'; const a=new Agents(process.argv[1]); await new Promise(r=>setTimeout(r,100)); await a.save({name:'Fixture',host:'100.70.8.${i + 10}',port:43128});`, dir],
    { windowsHide: true, stdio: ["ignore", "ignore", "pipe"] }));
  const results = await Promise.all(children.map(async child => {
    child.stderr.resume();
    const [code] = await once(child, "exit");
    assert.equal(code, 0);
  }));
  assert.equal(results.length, 4);
  assert.equal(new Agents(dir).list().agents.length, 5);
});

test("terminating the lock holder releases the OS lock without deleting stale files", async () => {
  const dir = temp(), a = new Agents(dir);
  const holder = spawn(PYTHON, ["src/win_agent_lock.py", a.file + ".lock"],
    { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
  holder.stderr.resume();
  try {
    await once(holder.stdout, "data");
    const exited = once(holder, "exit");
    holder.kill();
    await exited;
    await add(a, 10);
    assert.equal(new Agents(dir).list().agents.length, 2);
  } finally { if (holder.exitCode === null) holder.kill(); }
});

test("legacy registry upgrades with stable IDs, BOM tolerance and no secret exposure", async () => {
  const dir = temp(), file = path.join(dir, "agents.json");
  fs.writeFileSync(file, "\uFEFF" + JSON.stringify({ selectedId: "fixture", items: [
    { id: "local", kind: "local", name: "Local", host: "fixture", port: 43127 },
    { id: "fixture", kind: "remote", name: "Saved", host: "100.70.8.10", port: 43128 },
  ] }));
  const a = new Agents(dir);
  await a.select("local");
  assert.equal(new Agents(dir).get("fixture").name, "Saved");
  assert.equal(JSON.parse(fs.readFileSync(file)).format, 1);
});
