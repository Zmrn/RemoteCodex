import http from "node:http";
import os from "node:os";
import { timingSafeEqual } from "node:crypto";
import { isTailAddress, resolveAgent } from "./agents.mjs";
export function allowedRoute(method, url) {
  const u = new URL(url, "http://bridge.invalid");
  if (
    method === "GET" &&
    /^\/api\/(status|events|projects|threads|models|usage)$/.test(u.pathname)
  )
    return true;
  if (method === "POST" && /^\/api\/(connect|threads)$/.test(u.pathname))
    return true;
  const m =
    /^\/api\/threads\/[\w-]+(?:\/(follow|open|messages|interrupt|files|file|settings|queue))?$/.exec(
      u.pathname,
    );
  return (
    !!m &&
    (method === "GET"
      ? !m[1] || ["files", "file", "queue"].includes(m[1])
      : method === "POST" &&
        [
          "follow",
          "open",
          "messages",
          "interrupt",
          "settings",
          "queue",
        ].includes(m[1]))
  );
}
// One HTTP attempt only, including writes. A dropped response is never retried.
export function relay(req, res, { hostname, port, route, headers }) {
  return new Promise((resolve) => {
    let settled = false,
      total = 0;
    const done = () => {
      if (!settled) {
        settled = true;
        resolve();
      }
    };
    const upstream = http.request(
      {
        hostname,
        port,
        path: route,
        method: req.method,
        headers: {
          ...headers,
          ...(req.headers["content-type"]
            ? { "content-type": req.headers["content-type"] }
            : {}),
        },
        agent: false,
      },
      (r) => {
        const responseHeaders = { "cache-control": "no-store" };
        for (const h of [
          "content-type",
          "content-length",
          "content-disposition",
        ])
          if (r.headers[h]) responseHeaders[h] = r.headers[h];
        res.writeHead(r.statusCode, responseHeaders);
        r.on("error", () => res.destroy());
        r.on("end", done);
        r.pipe(res);
      },
    );
    const fail = () => {
      if (!res.headersSent) {
        res.writeHead(502, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            error:
              req.method === "POST"
                ? "设备连接中断，提交结果未知；请重新读取核对，不要重复发送。"
                : "无法连接设备。请检查 agent、Tailscale 地址、端口和连接密钥。",
            status: "connection-interrupted",
            confirmed: false,
          }),
        );
      } else res.destroy();
      done();
    };
    upstream.setTimeout(75000, () => upstream.destroy());
    const connectTimer = setTimeout(() => upstream.destroy(), 8000);
    upstream.on("socket", (socket) =>
      socket.once("connect", () => clearTimeout(connectTimer)),
    );
    upstream.on("close", () => clearTimeout(connectTimer));
    upstream.on("error", fail);
    req.on("data", (chunk) => {
      total += chunk.length;
      if (total > 8 * 1024 * 1024) upstream.destroy();
    });
    req.on("aborted", () => upstream.destroy());
    res.on("close", () => {
      upstream.destroy();
      done();
    });
    req.pipe(upstream);
  });
}
export async function proxyAgent(
  req,
  res,
  agents,
  id,
  route,
  resolve = resolveAgent,
) {
  if (!allowedRoute(req.method, route)) throw Error("此设备操作不支持远程转发");
  const a = agents.get(id),
    key = await agents.key(id);
  const hostname = await resolve(a.host);
  return relay(req, res, {
    hostname,
    port: a.port,
    route: "/bridge/v1" + route,
    headers: { Authorization: "Bearer " + key },
  });
}
export async function startRemoteListener({
  host,
  port = 43128,
  key,
  localPort,
  secret,
}) {
  // Loopback is permitted for isolated integration tests; network bindings require
  // an actual assigned Tailscale address. Never bind 0.0.0.0 or change networking.
  if (
    host !== "127.0.0.1" &&
    (!isTailAddress(host) ||
      !Object.values(os.networkInterfaces())
        .flat()
        .some((n) => n.address === host))
  )
    throw Error("监听地址必须是本机已有的 Tailscale IP");
  if (!/^[a-f0-9]{64}$/.test(key ?? ""))
    throw Error("无有效连接密钥，不能开启远程入口");
  const expected = Buffer.from("Bearer " + key);
  const server = http.createServer(async (req, res) => {
    const supplied = Buffer.from(req.headers.authorization ?? "");
    if (
      req.headers.origin ||
      supplied.length !== expected.length ||
      !timingSafeEqual(supplied, expected)
    ) {
      res.writeHead(401, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "连接密钥无效" }));
      return;
    }
    const route = req.url.startsWith("/bridge/v1/api/")
      ? req.url.slice("/bridge/v1".length)
      : "";
    if (!route || !allowedRoute(req.method, route)) {
      res.writeHead(404);
      res.end();
      return;
    }
    await relay(req, res, {
      hostname: "127.0.0.1",
      port: localPort,
      route,
      headers: { "X-Bridge-CSRF": secret },
    });
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, resolve);
  });
  return server;
}
