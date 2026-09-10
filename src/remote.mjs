import { REQUEST_BYTES } from "../public/image-input.mjs";
import http from "node:http";
import os from "node:os";
import { timingSafeEqual } from "node:crypto";
import { isTailAddress, resolveAgent } from "./agents.mjs";
import { validateAccessKey } from "./access-key.mjs";
export function allowedRoute(method, url) {
  const u = new URL(url, "http://bridge.invalid");
  if (method === "GET" && ["/api/compatibility", "/api/compatibility/probe", "/api/compatibility/report"].includes(u.pathname)) return true;
  if (method === "POST" && u.pathname === "/api/compatibility/probe") return true;
  if (
    method === "GET" &&
    /^\/api\/(status|events|projects|threads|models|usage|updates|task-summary|instance|notification-state)$/.test(
      u.pathname,
    )
  )
    return true;
  if (method === 'POST' && /^\/api\/threads\/[a-f0-9-]{36}\/notification-reply$/.test(u.pathname)) return true;
  if (method === "POST" && /^\/api\/(connect|threads)$/.test(u.pathname))
    return true;
  if (
    method === "POST" &&
    /^\/api\/updates\/(check|install|settings)$/.test(u.pathname)
  )
    return true;
  const m =
    /^\/api\/threads\/[\w-]+(?:\/(follow|open|messages|interrupt|files|file|settings|queue|questions|media|read-receipt))?$/.exec(
      u.pathname,
    );
  return (
    !!m &&
    (method === "GET"
      ? !m[1] || ["files", "file", "queue", "media"].includes(m[1])
      : method === "POST" &&
        [
          "follow",
          "open",
          "messages",
          "interrupt",
          "settings",
          "queue",
          "questions",
          "read-receipt",
        ].includes(m[1]))
  );
}
// One HTTP attempt only, including writes. A dropped response is never retried.
export function connectionFailure(error, { hostname, port, method }) {
  const target =
    hostname === "127.0.0.1"
      ? "目标电脑的桥接程序"
      : (hostname.includes(":") ? `[${hostname}]` : hostname) + ":" + port;
  const reason =
    error?.code === "ECONNREFUSED"
      ? `无法连接 ${target}：目标端口未接受连接。请在目标电脑编辑“这台电脑”，勾选允许其他设备通过 Tailscale 连接并保存，保持软件打开。`
      : error?.code === "ETIMEDOUT"
        ? `连接 ${target} 超时。请确认目标电脑已开启远程接入、双方 Tailscale 可互通，且访问端口填写一致。`
        : `与 ${target} 的连接中断。请检查目标电脑的远程接入状态。`;
  return {
    error:
      reason +
      (method === "POST"
        ? " 提交结果未知；请重新读取核对，不要重复发送。"
        : ""),
    code: ["ECONNREFUSED", "ETIMEDOUT"].includes(error?.code)
      ? error.code
      : "CONNECTION_INTERRUPTED",
    status: "connection-interrupted",
    confirmed: false,
  };
}
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
          ...(req.headers["accept-encoding"]
            ? { "accept-encoding": req.headers["accept-encoding"] }
            : {}),
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
          "content-encoding",
          "vary",
        ])
          if (r.headers[h]) responseHeaders[h] = r.headers[h];
        res.writeHead(r.statusCode, responseHeaders);
        r.on("error", () => res.destroy());
        r.on("end", done);
        r.pipe(res);
      },
    );
    const fail = (error) => {
      if (!res.headersSent) {
        res.writeHead(502, { "content-type": "application/json" });
        res.end(
          JSON.stringify(
            connectionFailure(error, { hostname, port, method: req.method }),
          ),
        );
      } else res.destroy();
      done();
    };
    const timedOut = () =>
      upstream.destroy(
        Object.assign(new Error("Bridge connection timeout"), {
          code: "ETIMEDOUT",
        }),
      );
    upstream.setTimeout(75000, timedOut);
    const connectTimer = setTimeout(timedOut, 8000);
    upstream.on("socket", (socket) =>
      socket.once("connect", () => clearTimeout(connectTimer)),
    );
    upstream.on("close", () => clearTimeout(connectTimer));
    upstream.on("error", fail);
    req.on("data", (chunk) => {
      total += chunk.length;
      if (total > REQUEST_BYTES) upstream.destroy();
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
  if (res.destroyed || req.aborted) return;
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
  getKey = () => key,
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
  validateAccessKey(getKey());
  const server = http.createServer(async (req, res) => {
    const expected = Buffer.from("Bearer " + getKey());
    const supplied = Buffer.from(req.headers.authorization ?? "");
    if (
      req.headers.origin ||
      supplied.length !== expected.length ||
      !timingSafeEqual(supplied, expected)
    ) {
      res.writeHead(401, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          error: "目标设备已响应，但连接验证失败。请核对目标电脑的访问密钥。",
          code: "AUTHENTICATION_FAILED",
        }),
      );
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
