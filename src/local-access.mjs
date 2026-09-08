import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { randomBytes } from "node:crypto";
import { protect, isTailAddress } from "./agents.mjs";
import { validateAccessKey } from "./access-key.mjs";
import { startRemoteListener } from "./remote.mjs";

export const tailscaleAddresses = () =>
  [
    ...new Set(
      Object.values(os.networkInterfaces())
        .flat()
        .filter((n) => n && isTailAddress(n.address))
        .map((n) => n.address),
    ),
  ].sort((a, b) => Number(a.includes(":")) - Number(b.includes(":")));

export class LocalAccess {
  constructor(
    dir,
    { addresses = tailscaleAddresses, listen = startRemoteListener } = {},
  ) {
    this.file = path.join(dir, "remote-access.json");
    this.config = fs.existsSync(this.file)
      ? JSON.parse(fs.readFileSync(this.file))
      : {};
    this.addresses = addresses;
    this.listen = listen;
    this.server = null;
    this.queue = Promise.resolve();
    this.error = "";
  }
  status() {
    const addresses = this.addresses();
    return {
      source: "Windows-network-interfaces-live",
      addresses,
      host: this.config.host || addresses[0] || "",
      port: this.config.port || 43128,
      enabled: !!this.config.enabled,
      hasKey: !!this.config.sealedKey,
      listening: this.server?.address() ?? null,
      error: this.error,
    };
  }
  write(config) {
    if (this.closed) throw Error("本机接入管理已关闭");
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(this.file + ".tmp", JSON.stringify(config, null, 2));
    fs.renameSync(this.file + ".tmp", this.file);
    this.config = config;
  }
  key() {
    return this.mutate(() => this.readKey());
  }
  async readKey() {
    if (this.config.sealedKey)
      return protect(this.config.sealedKey, "unprotect");
    const key = randomBytes(32).toString("hex");
    this.write({ ...this.config, sealedKey: await protect(key) });
    return key;
  }
  async start({ localPort, secret, host, port }) {
    this.connection = { localPort, secret };
    if (host) await this.save({ enabled: true, host, port });
    else await this.reconcile();
    if (this.closed) return;
    this.timer = setInterval(() => this.reconcile().catch(() => {}), 15000);
    this.timer.unref();
  }
  reconcile() {
    return this.mutate(async () => {
      if (!this.config.enabled || this.server) return;
      try {
        const host = this.config.host || this.addresses()[0];
        if (!host || !this.addresses().includes(host))
          throw Error("尚未检测到所选 Tailscale IP");
        const key = await this.readKey();
        this.currentKey = key;
        if (this.closed) return;
        const candidate = await this.listen({
          ...this.connection,
          host,
          port: this.config.port || 43128,
          getKey: () => this.currentKey,
        });
        if (this.closed) {
          candidate.closeAllConnections();
          candidate.close();
          return;
        }
        this.server = candidate;
        this.error = "";
      } catch (error) {
        this.error = error.message;
      }
    });
  }
  mutate(fn) {
    const next = this.queue.then(() => {
      if (this.closed) throw Error("本机接入管理已关闭");
      return fn();
    });
    this.queue = next.catch(() => {});
    return next;
  }
  save(input) {
    return this.mutate(async () => {
      if (
        !input ||
        Object.keys(input).some(
          (k) => !["enabled", "host", "port", "key"].includes(k),
        )
      )
        throw Error("本机接入参数无效");
      if (typeof input.enabled !== "boolean")
        throw Error("请选择是否启用远程访问");
      const host = String(input.host ?? "").trim(),
        port = Number(input.port);
      if (!Number.isInteger(port) || port < 1 || port > 65535)
        throw Error("端口必须在 1–65535 之间");
      if (host && !this.addresses().includes(host))
        throw Error("地址必须是本机已有的 Tailscale IP");
      if (input.enabled && !host)
        throw Error("尚未检测到 Tailscale IP，请先连接 Tailscale");
      const key = input.key
        ? validateAccessKey(input.key)
        : await this.readKey();
      const config = {
        enabled: input.enabled,
        host,
        port,
        sealedKey: await protect(key),
      };
      const old = this.server;
      if (this.closed) throw Error("本机接入管理已关闭");
      const same =
        old?.address()?.address === host && old?.address()?.port === port;
      let candidate = input.enabled && same ? old : null;
      if (input.enabled && !same)
        candidate = await this.listen({
          ...this.connection,
          host,
          port,
          key,
          getKey: () =>
            candidate && candidate === this.server ? this.currentKey : key,
        });
      try {
        this.write(config);
      } catch (error) {
        if (candidate && candidate !== old) candidate.close();
        throw error;
      }
      const keyChanged = this.currentKey !== key;
      this.currentKey = key;
      this.server = candidate;
      this.error = "";
      if (old && (old !== candidate || keyChanged)) old.closeAllConnections();
      if (old && old !== candidate) old.close();
      return this.status();
    });
  }
  close() {
    this.closed = true;
    clearInterval(this.timer);
    this.server?.closeAllConnections();
    this.server?.close();
    this.server = null;
  }
}
