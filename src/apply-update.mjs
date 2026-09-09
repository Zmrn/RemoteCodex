// Runs independently of the bridge being replaced. Never stops official processes.
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { captureDeviceUpdate, verifyDeviceUpdate } from "./device-update-snapshot.mjs";
import {
  verifyManifest,
  verifyExecutable,
  newerVersion,
} from "./update-format.mjs";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const jobFile = path.resolve(process.argv[2] || ""),
  dir = path.dirname(jobFile);
const job = JSON.parse(fs.readFileSync(jobFile));
const manifest = verifyManifest(job.envelope);
const resultFile = path.join(dir, "result.json");
const result = (value) => {
  fs.writeFileSync(
    resultFile + ".tmp",
    JSON.stringify({
      ...value,
      jobId: job.jobId,
      at: new Date().toISOString(),
    }),
  );
  fs.renameSync(resultFile + ".tmp", resultFile);
};
let stopped = false,
  replaced = false;
const backup = path.join(dir, "previous.exe");
let staged;
const run = (exe, args) =>
  new Promise((resolve, reject) => {
    // The launcher starts a long-lived child. Inherited stdout pipes would keep
    // execFile pending after the launcher exits, despite successful startup.
    const child = spawn(exe, ["--headless", "--home", job.home, ...args], {
      windowsHide: true,
      stdio: "ignore",
      timeout: 90000,
    });
    child.once("error", reject);
    child.once("exit", (code) =>
      code === 0 ? resolve() : reject(Error("更新启动器退出：" + code)),
    );
  });
const api = async (route, body) => {
  const html = await (
    await fetch(job.address + "/", { signal: AbortSignal.timeout(3000) })
  ).text();
  const csrf = /name="bridge-csrf" content="([a-f0-9]+)"/.exec(html)?.[1];
  if (!csrf) throw Error("无法确认桥接服务页面");
  const r = await fetch(job.address + "/api" + route, {
    method: body ? "POST" : "GET",
    headers: { "X-Bridge-CSRF": csrf, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(5000),
  });
  if (!r.ok) throw Error("桥接器控制请求失败");
  return r.json();
};
async function replaceFile(source, target) {
  const temporary = path.join(
    path.dirname(target),
    ".remote-codex-update-" + randomUUID() + ".exe",
  );
  fs.copyFileSync(source, temporary);
  try {
    for (let i = 0; ; i++) {
      try {
        fs.renameSync(temporary, target);
        return;
      } catch (error) {
        if (i >= 29) throw error;
        await sleep(200);
      }
    }
  } finally {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
}
try {
  if (
    path.resolve(job.home, "data/updates") !== dir ||
    path.resolve(job.candidate) !== path.join(dir, "ready.exe") ||
    !path.isAbsolute(job.launcher) ||
    path.extname(job.launcher).toLowerCase() !== ".exe"
  )
    throw Error("更新路径校验失败");
  const url = new URL(job.address);
  if (
    url.hostname !== "127.0.0.1" ||
    url.protocol !== "http:" ||
    url.pathname !== "/"
  )
    throw Error("更新控制地址不是本机回环地址");
  if (!newerVersion(manifest.version, job.version))
    throw Error("拒绝回退到旧版本");
  verifyExecutable(job.candidate, manifest);
  if (fs.lstatSync(job.launcher).isSymbolicLink())
    throw Error("EXE 不能通过文件链接更新");
  staged = path.join(
    path.dirname(job.launcher),
    ".remote-codex-write-test-" + randomUUID(),
  );
  fs.writeFileSync(staged, "", { flag: "wx" });
  fs.unlinkSync(staged);
  staged = null;
  fs.copyFileSync(job.launcher, backup);
  await run(job.candidate, ["--prepare-only"]);
  const before = await api("/instance");
  if (before.instanceId !== job.instanceId || before.pid !== job.pid)
    throw Error("当前桥接实例已经变化，取消更新");
  await api("/stop", {});
  stopped = true;
  for (let i = 0; i < 100; i++) {
    let alive = true;
    try {
      process.kill(job.pid, 0);
    } catch {
      alive = false;
    }
    if (!alive) break;
    if (i === 99) throw Error("原桥接器尚未退出，取消替换");
    await sleep(100);
  }
  verifyExecutable(job.candidate, manifest);
  if (job.desktopPid) {
    for (let i = 0; i < 100; i++) {
      let alive = true;
      try {
        process.kill(job.desktopPid, 0);
      } catch {
        alive = false;
      }
      if (!alive) break;
      if (i === 99) throw Error("原桌面窗口尚未退出，取消替换");
      await sleep(100);
    }
  }
  const deviceSnapshot = captureDeviceUpdate(path.join(job.home, "data"), path.join(dir, "device-backups", randomUUID()));
  await replaceFile(job.candidate, job.launcher);
  replaced = true;
  await run(job.launcher, ["--port", url.port]);
  const after = await api("/instance");
  if (after.version !== manifest.version || after.instanceId === job.instanceId)
    throw Error("新版本启动校验失败");
  verifyDeviceUpdate(path.join(job.home, "data"), deviceSnapshot);
  result({
    status: "updated",
    fromVersion: job.version,
    version: manifest.version,
  });
} catch (error) {
  let rolledBack = false;
  try {
    if (replaced) {
      await run(job.launcher, ["--stop"]);
      await replaceFile(backup, job.launcher);
    }
    if (stopped) {
      await run(job.launcher, ["--port", new URL(job.address).port]);
      rolledBack = true;
    }
  } catch {}
  result({
    status: rolledBack ? "rolled-back" : "failed",
    failedVersion: manifest.version,
    error: error.message,
  });
} finally {
  if (staged && fs.existsSync(staged)) fs.unlinkSync(staged);
}
