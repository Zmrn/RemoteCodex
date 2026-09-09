import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import net from "node:net";
import dns from "node:dns/promises";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { PYTHON } from "./runtime.mjs";
import { validateAccessKey } from "./access-key.mjs";
import { readAgents, writeAgents, lockAgents, preserveAgents } from "./agent-storage.mjs";
const here = path.dirname(fileURLToPath(import.meta.url));
export function protect(value, operation = "protect") {
  return new Promise((resolve, reject) => {
    const p = spawn(PYTHON, [path.join(here, "win_secret.py")], {
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let output = "";
    const timer = setTimeout(() => {
      p.kill();
      reject(Error("Windows 密钥存储超时"));
    }, 10000);
    p.stdout.on("data", (b) => (output += b));
    p.stderr.resume();
    p.on("error", () => {
      clearTimeout(timer);
      reject(Error("无法启动 Windows 密钥存储"));
    });
    p.on("close", (code) => {
      clearTimeout(timer);
      try {
        if (code !== 0) throw Error();
        resolve(JSON.parse(output).value);
      } catch {
        reject(Error("无法读取 Windows 用户的连接密钥"));
      }
    });
    p.stdin.on("error", () => {});
    p.stdin.end(JSON.stringify({ value, operation }));
  });
}
export function isTailAddress(address) {
  const kind = net.isIP(address);
  if (kind === 4) {
    const p = address.split(".").map(Number);
    return p[0] === 100 && p[1] >= 64 && p[1] <= 127;
  }
  return kind === 6 && address.toLowerCase().startsWith("fd7a:115c:a1e0:");
}
export function validateEndpoint(host, port) {
  host = String(host ?? "")
    .trim()
    .toLowerCase()
    .replace(/^\[([^\]]+)\]$/, "$1");
  if (
    !isTailAddress(host) &&
    !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+ts\.net$/.test(host)
  )
    throw Error(
      "请输入 Tailscale IP（100.64–100.127 或 fd7a:115c:a1e0）或完整 .ts.net 名称",
    );
  port = Number(port);
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw Error("端口必须在 1–65535 之间");
  return { host, port };
}
export async function resolveAgent(host) {
  if (isTailAddress(host)) return host;
  const result = await dns.lookup(host, { all: true });
  if (!result.length || result.some((r) => !isTailAddress(r.address)))
    throw Error("设备地址未解析到 Tailscale 网络");
  return result[0].address;
}
export class Agents {
  constructor(dir) {
    this.file = path.join(dir, "agents.json");
    fs.mkdirSync(dir, { recursive: true });
    this.persisted = false;
    this.db = {
      selectedId: "local",
      items: [{ id: "local", name: "这台电脑", kind: "local", host: os.hostname(), port: 43127 }],
    };
    this.refresh();
    this.queue = Promise.resolve();
  }
  refresh() {
    const saved = readAgents(this.file, !this.persisted);
    if (saved) {
      this.db = saved.db;
      this.storage = saved.storage;
      this.persisted = true;
    }
  }
  write(operation) {
    this.db = writeAgents(this.file, this.db, operation);
    this.persisted = true;
  }
  list() {
    this.refresh();
    return {
      storage: this.storage ?? { source: "new", recovered: false },
      selectedId: this.db.selectedId,
      agents: this.db.items.map(({ sealedKey, ...a }) => ({
        ...a,
        hasKey: !!sealedKey,
      })),
    };
  }
  get(id) {
    this.refresh();
    const a = this.db.items.find((a) => a.id === id);
    if (!a) throw Error("设备不存在");
    return a;
  }
  async key(id) {
    const a = this.get(id);
    if (!a.sealedKey) throw Error("请编辑设备并填写连接密钥");
    return protect(a.sealedKey, "unprotect");
  }
  mutate(fn) {
    const next = this.queue.then(async () => {
      const locked = await lockAgents(this.file);
      return locked(() => {
        this.refresh();
        try { return fn(); }
        catch (error) { this.refresh(); throw error; }
      });
    });
    this.queue = next.catch(() => {});
    return next;
  }
  preserve() {
    return this.mutate(() => preserveAgents(this.file));
  }
  async save(body) {
    let protectedKey;
    if (body.id !== "local" && body.key) {
      validateAccessKey(body.key);
      protectedKey = await protect(body.key);
    }
    return this.mutate(() => {
      const name = String(body.name ?? "").trim();
      if (!name || name.length > 60) throw Error("Agent 名称需要 1–60 个字符");
      const old = body.id ? this.get(body.id) : null;
      if (old?.kind === "local") old.name = name;
      else {
        const endpoint = validateEndpoint(body.host, body.port);
        if (
          this.db.items.some(
            (a) =>
              a.id !== old?.id &&
              a.kind === "remote" &&
              a.host === endpoint.host &&
              a.port === endpoint.port,
          )
        )
          throw Error("此地址和端口已经保存");
        const changed =
          old && (old.host !== endpoint.host || old.port !== endpoint.port);
        let sealedKey = changed ? undefined : old?.sealedKey;
        if (protectedKey) sealedKey = protectedKey;
        const item = {
          id: old?.id ?? randomUUID(),
          name,
          kind: "remote",
          ...endpoint,
          ...(sealedKey ? { sealedKey } : {}),
        };
        if (old) this.db.items[this.db.items.indexOf(old)] = item;
        else this.db.items.push(item);
      }
      this.write({ type: "save", id: old?.id ?? this.db.items.at(-1).id });
      return this.list();
    });
  }
  remove(id) {
    return this.mutate(() => {
      if (id === "local") throw Error("本机设备不能移除");
      this.get(id);
      this.db.items = this.db.items.filter((a) => a.id !== id);
      if (this.db.selectedId === id) this.db.selectedId = "local";
      this.write({ type: "remove", id });
      return this.list();
    });
  }
  select(id) {
    return this.mutate(() => {
      this.get(id);
      if (this.db.selectedId === id && this.db.format === 1 && this.storage?.source === "primary") {
        preserveAgents(this.file);
        return this.list();
      }
      this.db.selectedId = id;
      this.write({ type: "select", id });
      return this.list();
    });
  }
}
