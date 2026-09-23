import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const edition = JSON.parse(fs.readFileSync(path.join(root, "src/edition.json"), "utf8")).edition;
if (!["full", "limit"].includes(edition)) throw Error("Invalid product edition");
export const DATA_DIR = process.env.REMOTE_BRIDGE_DATA_DIR
  ? path.resolve(process.env.REMOTE_BRIDGE_DATA_DIR)
  : path.join(root, "data");
export const PYTHON = process.env.REMOTE_BRIDGE_PYTHON || "python";
export const INSTANCE = Object.freeze({
  application: edition === "limit" ? "limit-remote-codex" : "remote-codex",
  edition,
  instanceId: process.env.REMOTE_BRIDGE_INSTANCE_ID || randomUUID(),
  pid: process.pid,
  version: JSON.parse(fs.readFileSync(path.join(root, "package.json"))).version,
  portable: process.env.REMOTE_BRIDGE_PORTABLE === "1",
});
