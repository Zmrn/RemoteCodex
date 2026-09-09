import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { Agents } from "../src/agents.mjs";
import { captureDeviceUpdate, verifyDeviceUpdate } from "../src/device-update-snapshot.mjs";

test("updater preserves exact encrypted configuration and refuses to approve device loss", async () => {
  fs.mkdirSync("test/scratch", { recursive: true });
  const dir = fs.mkdtempSync(path.resolve("test/scratch/device-update-"));
  const a = new Agents(dir), key = "synthetic-update-snapshot-key-only-1234";
  await a.save({ name: "Fixture", host: "100.70.8.10", port: 43128, key });
  const original = fs.readFileSync(a.file);
  fs.writeFileSync(path.join(dir, "remote-access.json"), JSON.stringify({ enabled: true, sealedKey: a.db.items[1].sealedKey }));
  const destination = path.join(dir, "updates/device-backups/fixture");
  const snapshot = captureDeviceUpdate(dir, destination);
  assert.deepEqual(fs.readFileSync(path.join(destination, "agents.json")), original);
  for (const name of fs.readdirSync(destination)) assert.ok(!fs.readFileSync(path.join(destination, name), "utf8").includes(key));
  await new Agents(dir).select(a.db.items[1].id);
  verifyDeviceUpdate(dir, snapshot);
  // Even a valid, intentional deletion is unexpected during an EXE update.
  await a.remove(a.db.items[1].id);
  assert.throws(() => verifyDeviceUpdate(dir, snapshot), /设备配置发生变化/);
  assert.deepEqual(fs.readFileSync(path.join(destination, "agents.json")), original);
});

test("updater retains access/settings backups and does not overwrite an existing snapshot", async () => {
  const dir = fs.mkdtempSync(path.resolve("test/scratch/device-update-"));
  const a = new Agents(dir);
  await a.select("local");
  const access = path.join(dir, "remote-access.json");
  fs.writeFileSync(access, '{"enabled":true,"port":43128}');
  const destination = path.join(dir, "updates/device-backups/fixture");
  const snapshot = captureDeviceUpdate(dir, destination);
  assert.throws(() => captureDeviceUpdate(dir, destination), { code: "EEXIST" });
  fs.writeFileSync(access, '{"enabled":false,"port":43128}');
  assert.throws(() => verifyDeviceUpdate(dir, snapshot), /接入或更新设置发生变化/);
  fs.unlinkSync(access);
  assert.throws(() => verifyDeviceUpdate(dir, snapshot), /接入或更新设置发生变化/);
});
