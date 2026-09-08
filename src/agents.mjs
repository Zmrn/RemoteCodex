import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import net from "node:net";
import dns from "node:dns/promises";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { PYTHON } from "./runtime.mjs";
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
    this.db = fs.existsSync(this.file)
      ? JSON.parse(fs.readFileSync(this.file))
      : {
          selectedId: "local",
          items: [
            {
              id: "local",
              name: "这台电脑",
              kind: "local",
              host: os.hostname(),
              port: 43127,
            },
          ],
        };
    this.queue = Promise.resolve();
  }
  write() {
    fs.writeFileSync(this.file + ".tmp", JSON.stringify(this.db, null, 2));
    fs.renameSync(this.file + ".tmp", this.file);
  }
  list() {
    return {
      selectedId: this.db.selectedId,
      agents: this.db.items.map(({ sealedKey, ...a }) => ({
        ...a,
        hasKey: !!sealedKey,
      })),
    };
  }
  get(id) {
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
    const next = this.queue.then(fn);
    this.queue = next.catch(() => {});
    return next;
  }
  save(body) {
    return this.mutate(async () => {
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
        if (body.key) {
          if (!/^[a-f0-9]{64}$/.test(body.key))
            throw Error("连接密钥应为远端生成的 64 位十六进制字符");
          sealedKey = await protect(body.key);
        }
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
      this.write();
      return this.list();
    });
  }
  remove(id) {
    return this.mutate(() => {
      if (id === "local") throw Error("本机设备不能移除");
      this.get(id);
      this.db.items = this.db.items.filter((a) => a.id !== id);
      if (this.db.selectedId === id) this.db.selectedId = "local";
      this.write();
      return this.list();
    });
  }
  select(id) {
    return this.mutate(() => {
      this.get(id);
      this.db.selectedId = id;
      this.write();
      return this.list();
    });
  }
}
