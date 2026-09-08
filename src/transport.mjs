import net from "node:net";
import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";

export function encode(frame) {
  const b = Buffer.from(JSON.stringify(frame));
  if (b.length > 32 * 1024 * 1024) throw Error("Frame too large");
  const h = Buffer.alloc(4);
  h.writeUInt32LE(b.length);
  return Buffer.concat([h, b]);
}
export class Pipe extends EventEmitter {
  constructor(path, kind = "tools") {
    super();
    this.path = path;
    this.kind = kind;
    this.pending = new Map();
    this.clientId = "initializing-client";
    this.buffer = Buffer.alloc(0);
  }
  async connect() {
    if (this.socket && !this.socket.destroyed) return;
    this.buffer = Buffer.alloc(0);
    this.socket = net.createConnection(this.path);
    this.socket.on("data", (c) => {
      try {
        this.data(c);
      } catch (e) {
        this.fail(e);
        this.socket.destroy();
      }
    });
    this.socket.on("error", (e) => this.fail(e));
    this.socket.on("close", () => this.fail(Error("connection-interrupted")));
    await new Promise((res, rej) => {
      this.socket.once("connect", res);
      this.socket.once("error", rej);
    });
    if (this.kind === "desktop") {
      const f = await this.request(
        "initialize",
        { clientType: "remote-bridge-prototype" },
        { version: 1 },
      );
      this.clientId = f.result.clientId;
    }
  }
  fail(error) {
    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
      p.reject(error);
    }
    this.pending.clear();
    this.emit("disconnected", error.message);
  }
  data(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    while (this.buffer.length >= 4) {
      let n = this.buffer.readUInt32LE(0);
      if (n > 32 * 1024 * 1024) throw Error("Oversize IPC frame");
      if (this.buffer.length < n + 4) return;
      let f = JSON.parse(this.buffer.subarray(4, n + 4));
      this.buffer = this.buffer.subarray(n + 4);
      if (f.type === "client-discovery-request") {
        this.send({
          type: "client-discovery-response",
          requestId: f.requestId,
          response: { canHandle: false },
        });
        continue;
      }
      if (f.type === "request") {
        this.send({
          type: "response",
          requestId: f.requestId,
          resultType: "error",
          error: "no-handler-for-request",
        });
        continue;
      }
      const id = f.requestId ?? f.id,
        p = this.pending.get(id);
      if (p) {
        this.pending.delete(id);
        clearTimeout(p.timer);
        if (f.error || f.resultType === "error")
          p.reject(
            Error(
              typeof f.error === "string" ? f.error : JSON.stringify(f.error),
            ),
          );
        else p.resolve(f);
      } else this.emit("frame", f);
    }
  }
  send(f) {
    if (!this.socket || this.socket.destroyed)
      throw Error("connection-interrupted");
    this.socket.write(encode(f));
  }
  request(
    method,
    params,
    { version = 0, targetClientId, timeoutMs = 15000 } = {},
  ) {
    const id = randomUUID();
    const frame =
      this.kind === "tools"
        ? { id, jsonrpc: "2.0", method, params }
        : {
            type: "request",
            requestId: id,
            sourceClientId: this.clientId,
            method,
            params,
            version,
            targetClientId,
            timeoutMs,
          };
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(Error("outcome-unknown: timeout " + method));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      try {
        this.send(frame);
      } catch (e) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(e);
      }
    });
  }
  broadcast(method, params, version = 1, targetClientIds) {
    this.send({
      type: "broadcast",
      method,
      params,
      sourceClientId: this.clientId,
      version,
      ...(targetClientIds ? { targetClientIds } : {}),
    });
  }
  close() {
    this.socket?.destroy();
    this.fail(Error("connection-interrupted"));
  }
}
