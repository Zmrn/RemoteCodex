import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { parseArgs } from "node:util";
import { randomBytes } from "node:crypto";
import { Bridge, ROOT } from "./bridge.mjs";
import { listFiles, resolveFile, saveUpload } from "./files.mjs";
import { Agents } from "./agents.mjs";
import { proxyAgent, allowedRoute } from "./remote.mjs";
import { LocalAccess } from "./local-access.mjs";
import { Updater } from "./updater.mjs";
import { DATA_DIR, INSTANCE } from "./runtime.mjs";
import { createGzip } from "node:zlib";
import { conversationView } from "./state.mjs";
export async function startServer({
  port = 43127,
  bridge = new Bridge(),
  agents,
  agentHost,
  agentPort = 43128,
  access,
} = {}) {
  agents ??= new Agents(bridge.dataDir ?? DATA_DIR);
  access ??= new LocalAccess(bridge.dataDir ?? DATA_DIR);
  const updater = new Updater(bridge.dataDir ?? DATA_DIR, (e) =>
    bridge.emitEvent?.(e.kind, e),
  );
  const secret = randomBytes(32).toString("hex"),
    sse = new Set();
  let closing = false;
  const staticTypes = new Map([
    ["/app.js", "text/javascript; charset=utf-8"],
    ["/ui.mjs", "text/javascript; charset=utf-8"],
    ["/message-content.mjs", "text/javascript; charset=utf-8"],
    ["/questions-ui.mjs", "text/javascript; charset=utf-8"],
    ["/queue-ui.mjs", "text/javascript; charset=utf-8"],
    ["/device-settings.mjs", "text/javascript; charset=utf-8"],
    ["/update-recovery.mjs", "text/javascript; charset=utf-8"],
    ["/style.css", "text/css; charset=utf-8"],
    ["/app-icon.svg", "image/svg+xml"],
    ["/app-icon.ico", "image/x-icon"],
    ["/app-icon-192.png", "image/png"],
    ["/app-icon-512.png", "image/png"],
    ["/app.webmanifest", "application/manifest+json"],
  ]);
  const json = (res, code, data) => {
    if (res.destroyed || res.writableEnded) return;
    const payload = JSON.stringify(data);
    const compress =
      Buffer.byteLength(payload) >= 4096 &&
      String(res.req?.headers["accept-encoding"] ?? "")
        .split(",")
        .some((part) => {
          const [encoding, ...parameters] = part.trim().split(";");
          const quality = parameters
            .map((p) => p.trim())
            .find((p) => p.startsWith("q="));
          return (
            encoding === "gzip" && (!quality || Number(quality.slice(2)) > 0)
          );
        });
    res.writeHead(code, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      Vary: "Accept-Encoding",
      ...(compress ? { "Content-Encoding": "gzip" } : {}),
    });
    if (compress) {
      const gzip = createGzip({ level: 1 });
      res.on("close", () => gzip.destroy());
      gzip.on("error", () => res.destroy());
      gzip.pipe(res);
      gzip.end(payload);
    } else res.end(payload);
  };
  const sourceError = (e) => ({
    error: e.message,
    status: "unknown",
    confirmed: false,
  });
  const outputRoot = async (id) => {
    bridge.guardProbe(id);
    const record = bridge.db.tests[id];
    if (record.outputDirectory) return record.outputDirectory;
    const r = await bridge.read(id);
    const cwd = r.data.thread.cwd;
    if (!cwd || !/^remotebridge-probe-/i.test(path.basename(cwd)))
      throw Error("Unexpected test workspace");
    record.cwd = cwd;
    record.outputDirectory = path.join(cwd, "outputs");
    bridge.save();
    return record.outputDirectory;
  };
  const event = (e) => {
    for (const res of sse)
      res.write(`id: ${e.epoch}:${e.id}\ndata: ${JSON.stringify(e)}\n\n`);
  };
  bridge.on("event", event);
  const server = http.createServer(async (req, res) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'",
    );
    const expected = "127.0.0.1:" + server.address().port;
    if (
      req.headers.host !== expected ||
      !["127.0.0.1", "::ffff:127.0.0.1"].includes(req.socket.remoteAddress) ||
      (req.headers.origin && req.headers.origin !== "http://" + expected)
    )
      return json(res, 403, { error: "Loopback same-origin access only" });
    let url = new URL(req.url, "http://" + expected);
    if (req.method === "GET" && url.pathname === "/") {
      res.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
      });
      return res.end(
        fs
          .readFileSync(path.join(ROOT, "public/index.html"), "utf8")
          .replace("__BRIDGE_CSRF__", secret)
          .replace("__BRIDGE_VERSION__", INSTANCE.version),
      );
    }
    if (req.method === "GET" && staticTypes.has(url.pathname)) {
      res.writeHead(200, {
        "Content-Type": staticTypes.get(url.pathname),
        "Cache-Control": "no-store",
      });
      return res.end(
        fs.readFileSync(path.join(ROOT, "public", url.pathname.slice(1))),
      );
    }
    if (
      !url.pathname.startsWith("/api/") ||
      req.headers["x-bridge-csrf"] !== secret
    )
      return json(res, 403, { error: "Bridge session header required" });
    try {
      const agentRoute = /^\/api\/agents\/([\w-]+)\/bridge(\/.*)$/.exec(
        url.pathname,
      );
      if (agentRoute) {
        const id = agentRoute[1],
          route = "/api" + agentRoute[2] + url.search;
        agents.get(id);
        if (!allowedRoute(req.method, route))
          throw Error("此操作不可通过设备入口调用");
        if (id !== "local")
          return await proxyAgent(req, res, agents, id, route);
        url = new URL(route, "http://" + expected);
      }
      if (req.method === "GET" && url.pathname === "/api/agents")
        return json(res, 200, agents.list());
      if (req.method === "GET" && url.pathname === "/api/remote-info")
        return json(res, 200, {
          host: os.hostname(),
          ...access.status(),
          defaultPort: 43128,
        });
      if (req.method === "GET" && url.pathname === "/api/local-access")
        return json(res, 200, access.status());
      if (req.method === "GET" && url.pathname === "/api/updates")
        return json(res, 200, updater.status());
      if (req.method === "GET" && url.pathname === "/api/status")
        return json(res, 200, bridge.status());
      if (req.method === "GET" && url.pathname === "/api/instance")
        return json(res, 200, INSTANCE);
      if (req.method === "GET" && url.pathname === "/api/events") {
        res.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-store",
          Connection: "keep-alive",
        });
        res.write(
          `data: ${JSON.stringify({ kind: "resync-required", ...bridge.status() })}\n\n`,
        );
        sse.add(res);
        req.on("close", () => sse.delete(res));
        return;
      }
      if (req.method === "GET" && url.pathname === "/api/projects")
        return json(res, 200, await bridge.projects());
      if (req.method === "GET" && url.pathname === "/api/threads")
        return json(res, 200, await bridge.threads());
      if (req.method === "GET" && url.pathname === "/api/models")
        return json(res, 200, await bridge.models());
      if (req.method === "GET" && url.pathname === "/api/usage")
        return json(res, 200, await bridge.usage());
      const match =
        /^\/api\/threads\/([\w-]+)(?:\/(messages|follow|open|files|file|interrupt|settings|queue|questions|media))?$/.exec(
          url.pathname,
        );
      if (req.method === "GET" && match) {
        const id = match[1];
        if (match[2] === "media") {
          const file = bridge.media.read(id, url.searchParams.get("id"));
          res.writeHead(200, {
            "Content-Type": file.type,
            "Content-Length": file.bytes.length,
            "Cache-Control": "no-store",
            "Content-Disposition":
              "inline; filename*=UTF-8''" + encodeURIComponent(file.name),
          });
          return res.end(file.bytes);
        }
        if (match[2] === "queue") return json(res, 200, bridge.queue.read(id));
        if (!match[2]) {
          const result = await bridge.read(id, url.searchParams.get("cursor"));
          return json(
            res,
            200,
            url.searchParams.get("view") === "conversation"
              ? conversationView(result)
              : result,
          );
        }
        if (match[2] === "files")
          return json(res, 200, { files: listFiles(await outputRoot(id)) });
        if (match[2] === "file") {
          const file = resolveFile(
            await outputRoot(id),
            url.searchParams.get("name"),
          );
          res.writeHead(200, {
            "Content-Type": "application/octet-stream",
            "Content-Disposition":
              "attachment; filename*=UTF-8''" +
              encodeURIComponent(path.basename(file)),
            "Content-Length": fs.statSync(file).size,
            "Cache-Control": "no-store",
          });
          fs.createReadStream(file).pipe(res);
          return;
        }
      }
      if (req.method !== "POST")
        return json(res, 404, { error: "Unknown route" });
      if (
        !String(req.headers["content-type"] ?? "").startsWith(
          "application/json",
        )
      )
        return json(res, 415, { error: "JSON required" });
      let total = 0,
        chunks = [];
      for await (const chunk of req) {
        total += chunk.length;
        if (total > 8 * 1024 * 1024)
          return json(res, 413, { error: "Request too large" });
        chunks.push(chunk);
      }
      const body = JSON.parse(Buffer.concat(chunks).toString() || "{}");
      if (url.pathname === "/api/agents")
        return json(res, 200, await agents.save(body));
      if (url.pathname === "/api/agents/select")
        return json(res, 200, await agents.select(body.id));
      if (url.pathname === "/api/agents/remove")
        return json(res, 200, await agents.remove(body.id));
      if (url.pathname === "/api/pairing-key")
        return json(res, 200, { key: await access.key() });
      if (url.pathname === "/api/local-access") {
        const status = await access.save(body);
        const file = path.join(bridge.dataDir ?? DATA_DIR, "server.json");
        if (fs.existsSync(file)) {
          const record = JSON.parse(fs.readFileSync(file));
          if (record.instanceId === INSTANCE.instanceId) {
            record.remoteAddress = status.listening;
            fs.writeFileSync(file + ".tmp", JSON.stringify(record));
            fs.renameSync(file + ".tmp", file);
          }
        }
        return json(res, 200, status);
      }
      if (url.pathname === "/api/updates/settings")
        return json(res, 200, updater.configure(body));
      if (url.pathname === "/api/updates/check")
        return json(res, 200, await updater.check());
      if (url.pathname === "/api/updates/install")
        return json(res, 200, updater.install(true));
      if (url.pathname === "/api/updates/activity")
        return json(res, 200, updater.activity(body));
      if (url.pathname === "/api/connect") {
        await bridge.connect();
        return json(res, 200, bridge.status());
      }
      if (url.pathname === "/api/disconnect") {
        bridge.disconnect();
        return json(res, 200, bridge.status());
      }
      if (url.pathname === "/api/stop") {
        json(res, 200, { stopped: true, officialTasksUnaffected: true });
        closing = true;
        access.close();
        updater.close();
        bridge.disconnect();
        for (const s of sse) s.end();
        server.close();
        // Closing a viewer must also release slow proxy requests and SSE
        // sockets. This does not send interrupts to any official task.
        setTimeout(() => server.closeAllConnections(), 250).unref();
        return;
      }
      if (url.pathname === "/api/threads")
        return json(
          res,
          200,
          await bridge.create(body.requestId, body.prompt, body.settings),
        );
      if (match) {
        const id = match[1];
        if (match[2] === "questions")
          return json(
            res,
            200,
            await bridge.answerQuestions(id, body.requestId, body),
          );
        if (match[2] === "queue")
          return json(
            res,
            200,
            await bridge.queue.mutate(id, body.requestId, body),
          );
        if (match[2] === "follow")
          return json(res, 200, await bridge.follow(id));
        if (match[2] === "open") return json(res, 200, await bridge.open(id));
        if (match[2] === "settings")
          return json(
            res,
            200,
            await bridge.updateSettings(id, body.requestId, body.settings),
          );
        if (match[2] === "messages") {
          bridge.guard(id);
          if (body.imageDataUrl)
            saveUpload(path.join(bridge.dataDir, "uploads"), body.imageDataUrl);
          const result = await bridge.nativeSend(
            id,
            body.requestId,
            body.prompt,
            body.imageDataUrl,
            body.settings,
          );
          if (result.status === "accepted")
            bridge.queue.clearRecovery(id, body.recoveryId);
          return json(res, 200, result);
        }
        if (match[2] === "interrupt")
          return json(
            res,
            200,
            await bridge.interrupt(id, body.requestId, body.expectedTurnId),
          );
      }
      return json(res, 404, { error: "Unknown route" });
    } catch (e) {
      return json(res, 400, sourceError(e));
    }
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });
  const heartbeat = setInterval(() => {
    for (const res of sse) res.write(": heartbeat\n\n");
  }, 15000);
  heartbeat.unref();
  server.on("close", () => {
    access.close();
    updater.close();
    clearInterval(heartbeat);
    bridge.off("event", event);
  });
  const address = "http://127.0.0.1:" + server.address().port;
  try {
    await access.start({
      localPort: server.address().port,
      secret,
      host: agentHost,
      port: agentPort,
    });
  } catch (e) {
    access.close();
    server.close();
    throw e;
  }
  if (!closing)
    await bridge
      .connect()
      .catch((e) =>
        bridge.emitEvent("connection-interrupted", { reason: e.message }),
      );
  updater.start(address);
  return {
    server,
    bridge,
    secret,
    address,
    agents,
    access,
    updater,
    get remoteServer() {
      return access.server;
    },
  };
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.join(ROOT, "src/server.mjs")
) {
  try {
    const { values } = parseArgs({
      options: {
        "agent-address": { type: "string" },
        "agent-port": { type: "string" },
        port: { type: "string" },
      },
    });
    const { server, bridge, address, remoteServer } = await startServer({
      port: Number(values.port ?? 43127),
      agentHost: values["agent-address"],
      agentPort: Number(values["agent-port"] ?? 43128),
    });
    console.log("Remote Bridge UI: " + address + " (loopback only)");
    if (remoteServer)
      console.log(
        "Authenticated agent listener: " +
          remoteServer.address().address +
          ":" +
          remoteServer.address().port,
      );
    console.log(
      "Codex tasks accept user messages, including the development task. Automated probes exclude it. Ctrl+C stops this bridge only.",
    );
    const record = path.join(bridge.dataDir, "server.json");
    fs.writeFileSync(
      record + ".tmp",
      JSON.stringify({
        ...INSTANCE,
        executable: process.execPath,
        address,
        startedAt: new Date().toISOString(),
        remoteAddress: remoteServer?.address() ?? null,
      }),
    );
    fs.renameSync(record + ".tmp", record);
    for (const signal of ["SIGINT", "SIGTERM"])
      process.on(signal, () => {
        bridge.disconnect();
        server.closeAllConnections();
        server.close(() => process.exit(0));
      });
  } catch (error) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(
      path.join(DATA_DIR, "startup-error.txt"),
      String(error.message),
    );
    console.error(error.message);
    process.exitCode = 1;
  }
}
