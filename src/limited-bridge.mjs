import { EventEmitter } from "node:events";

// The Limit Windows controller never discovers, connects to, or writes the
// official app on its own computer. Its loopback server only manages remote
// connection records and forwards authenticated requests.
export class LimitedBridge extends EventEmitter {
  constructor(dataDir) {
    super();
    this.dataDir = dataDir;
    this.connected = false;
  }
  status() { return { connected: false, edition: "limit", threads: {} }; }
  disconnect() {}
  connect() { throw Error("Limit 版不能连接本机官方应用"); }
}
