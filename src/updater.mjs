import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { INSTANCE } from "./runtime.mjs";
import { DurableJson } from "./durable-json.mjs";
import {
  verifyManifest,
  verifyExecutable,
  newerVersion,
} from "./update-format.mjs";
import { updateSource as source, releaseAssetUrl, fetchUpdateAsset, readUpdateBytes } from './update-channel.mjs';

export class Updater {
  constructor(dir, notify = () => {}, { verifyUpdateManifest = verifyManifest } = {}) {
    this.verifyUpdateManifest = verifyUpdateManifest;
    this.dir = path.join(dir, "updates");
    this.settingsFile = path.join(dir, "update-settings.json");
    this.store = new DurableJson(this.settingsFile,{label:"更新设置",empty:{automatic:true},validate:value=>value&&typeof value==='object'&&typeof value.automatic==='boolean'&&Object.keys(value).every(k=>k==='automatic')});
    this.settings = this.store.health.writable ? this.store.value : {automatic:false};
    this.notify = notify;
    this.phase = "idle";
    this.error = "";
    this.supported =
      INSTANCE.portable && !!process.env.REMOTE_BRIDGE_LAUNCHER_EXE && !!source.manifestUrl;
    this.clients = new Map();
  }
  start(address) {
    this.address = address;
    if (!this.supported) return;
    this.timer = setInterval(() => {
      if (this.settings.automatic) this.check().catch(() => {});
    }, source.checkIntervalMs);
    this.timer.unref();
    this.initial = setTimeout(() => {
      if (this.settings.automatic) this.check().catch(() => {});
    }, 8000);
    this.initial.unref();
  }
  close() {
    this.closed = true;
    clearInterval(this.timer);
    clearTimeout(this.initial);
  }
  activity(body) {
    if (
      !/^[a-f0-9-]{36}$/.test(body?.id ?? "") ||
      typeof body.busy !== "boolean"
    )
      throw Error("界面活动参数无效");
    this.clients.set(body.id, { busy: body.busy, at: Date.now() });
    for (const [id, state] of this.clients)
      if (Date.now() - state.at > 20000) this.clients.delete(id);
    return { accepted: true };
  }
  busy() {
    return [...this.clients.values()].some(
      (s) => s.busy && Date.now() - s.at < 15000,
    );
  }
  status() {
    const ready = this.readyStatus();
    let result = null;
    try {
      result = JSON.parse(fs.readFileSync(path.join(this.dir, "result.json")));
    } catch {}
    if (
      this.jobId &&
      result?.jobId === this.jobId &&
      result.status !== "updated"
    ) {
      this.installing = false;
      this.phase = "error";
      this.error = "安装失败：" + result.error;
    }
    return {
      currentVersion: INSTANCE.version,
      supported: this.supported,
      automatic: !!this.settings.automatic,
      phase: this.phase,
      latestVersion: this.latest?.version ?? null,
      downloadVersion: this.downloadVersion ?? null,
      downloadedVersion: ready.version,
      packageState: ready.state,
      available:
        !!this.latest && newerVersion(this.latest.version, INSTANCE.version),
      checkedAt: this.checkedAt ?? null,
      error: this.store.health.message || this.error,
      storageHealth: this.store.health,
      progress: this.progress ?? 0,
      result,
      source: source.manifestUrl,
      checkIntervalMinutes: source.checkIntervalMs / 60000,
    };
  }
  readyStatus() {
    const file = path.join(this.dir, "ready.exe"), metadata = path.join(this.dir, "ready-manifest.json");
    try {
      const stat = fs.statSync(file, { bigint: true }), meta = fs.statSync(metadata, { bigint: true });
      const stamp = [stat.ino, stat.size, stat.mtimeNs, stat.ctimeNs, meta.ino, meta.size, meta.mtimeNs, meta.ctimeNs].join(":");
      if (this.readyStamp !== stamp || Date.now() - this.readyVerifiedAt >= 60000) {
        this.readyStamp = stamp;
        this.readyPackage = { version: null, state: "unverified" };
        try {
          const manifest = this.verifyUpdateManifest(JSON.parse(fs.readFileSync(metadata, "utf8")));
          if (stat.size !== BigInt(manifest.bytes)) throw Error("更新文件大小不符");
          verifyExecutable(file, manifest);
          this.readyPackage = { version: manifest.version, state: "verified" };
          this.readyVerifiedAt = Date.now();
        } catch { this.readyStamp = null; } // A repaired candidate must be retried even on coarse filesystem clocks.
      }
      return this.readyPackage;
    } catch {
      this.readyStamp = null;
      return { version: null, state: fs.existsSync(file) ? "unverified" : "none" };
    }
  }
  configure(input) {
    if (
      typeof input?.automatic !== "boolean" ||
      Object.keys(input).some((k) => k !== "automatic")
    )
      throw Error("更新设置无效");
    this.store.write(input);
    this.settings = input;
    if (input.automatic && this.supported) this.check().catch(() => {});
    return this.status();
  }
  async check() {
    if (this.installing) return this.status();
    if (this.checking) return this.checking;
    this.checking = this.fetchManifest();
    try {
      return await this.checking;
    } finally {
      this.checking = null;
    }
  }
  async fetchManifest() {
    this.phase = "checking";
    this.error = "";
    try {
      const response = await fetchUpdateAsset(source.manifestUrl, {
        signal: AbortSignal.timeout(12000),
        cache: "no-store",
      });
      if (!response.ok)
        throw Error("GitHub 更新资源暂不可用（" + response.status + "）");
      const text = (await readUpdateBytes(response, 24000)).toString('utf8');
      const envelope = JSON.parse(text),
        latest = this.verifyUpdateManifest(envelope);
      this.envelope = envelope;
      this.latest = latest;
      this.checkedAt = new Date().toISOString();
      this.phase = newerVersion(latest.version, INSTANCE.version)
        ? "available"
        : "current";
      if (
        !this.closed &&
        this.settings.automatic &&
        this.supported &&
        this.phase === "available" &&
        this.status().result?.failedVersion !== latest.version
      )
        this.install();
      return this.status();
    } catch (error) {
      this.phase = "error";
      this.error = "检查更新失败：" + error.message;
      throw Error(this.error);
    }
  }
  install(manual = false) {
    this.store.assertWritable();
    if (!this.supported) throw Error("自动安装仅支持单 EXE 版本");
    if (this.installing) {
      if (manual) this.force = true;
      return this.status();
    }
    if (!this.latest || !newerVersion(this.latest.version, INSTANCE.version))
      throw Error("没有可安装的新版本，请先检查更新");
    this.installing = true;
    this.jobId = null;
    this.force = manual;
    this.phase = "downloading";
    this.error = "";
    this.progress = 0;
    this.downloadVersion = this.latest.version;
    this.downloadAndApply().catch((error) => {
      this.phase = "error";
      this.error = error.message;
      this.installing = false;
    }).finally(() => { this.downloadVersion = null; });
    return this.status();
  }
  async downloadAndApply() {
    const manifest = this.latest,
      envelope = this.envelope;
    fs.mkdirSync(this.dir, { recursive: true });
    const file = path.join(this.dir, "ready.exe"),
      partial = path.join(this.dir, "download.tmp");
    let cached = false;
    try {
      verifyExecutable(file, manifest);
      cached = true;
      this.progress = 100;
    } catch {}
    if (!cached) {
      const response = await fetchUpdateAsset(releaseAssetUrl(manifest.version, manifest.file), {
        signal: AbortSignal.timeout(20 * 60000),
        cache: "no-store",
      });
      if (!response.ok)
        throw Error("更新包下载失败（" + response.status + "）");
      const fd = fs.openSync(partial, "w");
      let total = 0;
      try {
        for await (const chunk of response.body) {
          if (this.closed) throw Error("桥接器已关闭，取消下载");
          total += chunk.length;
          if (total > manifest.bytes) throw Error("更新包大小与签名清单不符");
          fs.writeSync(fd, chunk);
          this.progress = Math.floor((total * 100) / manifest.bytes);
        }
      } finally {
        fs.closeSync(fd);
      }
      verifyExecutable(partial, manifest);
      if (this.closed) throw Error("桥接器已关闭，取消本次安装");
      fs.renameSync(partial, file);
    }
    // Associate a verified candidate with its own signed manifest, independently
    // of a later latest-version check. A restart must reverify both before display.
    const metadata = path.join(this.dir, "ready-manifest.json");
    fs.writeFileSync(metadata + ".tmp", JSON.stringify(envelope));
    fs.renameSync(metadata + ".tmp", metadata);
    this.readyStamp = null;
    while (!this.force && this.busy()) {
      this.phase = "waiting";
      await new Promise((resolve) => setTimeout(resolve, 2000));
      if (this.closed || !this.settings.automatic) {
        this.installing = false;
        this.phase = "available";
        return;
      }
    }
    if (!this.force && !this.settings.automatic) {
      this.installing = false;
      this.phase = "available";
      return;
    }
    this.jobId = randomUUID();
    const job = {
      jobId: this.jobId,
      envelope,
      address: this.address,
      instanceId: INSTANCE.instanceId,
      pid: process.pid,
      launcher: process.env.REMOTE_BRIDGE_LAUNCHER_EXE,
      home: process.env.REMOTE_BRIDGE_HOME,
      version: INSTANCE.version,
      candidate: file,
      desktopPid: Number(process.env.REMOTE_BRIDGE_DESKTOP_PID) || null,
    };
    const jobFile = path.join(this.dir, "job.json");
    fs.writeFileSync(jobFile, JSON.stringify(job));
    this.phase = "installing";
    this.notify({
      kind: "bridge-updating",
      source: "bridge-local",
      version: manifest.version,
    });
    // Allow connected windows to save their draft before the local UI service restarts.
    await new Promise((resolve) => setTimeout(resolve, 2000));
    if (this.closed) throw Error("桥接器已关闭，取消本次安装");
    if (!this.force && !this.settings.automatic) {
      this.installing = false;
      this.phase = "available";
      return;
    }
    if (job.desktopPid) {
      // The owning desktop launches the installer outside its process job.
      // The installer may finish replacing the EXE after the old window exits.
      fs.writeFileSync(
        path.join(this.dir, "desktop-request.json.tmp"),
        JSON.stringify({ jobId: job.jobId, instanceId: job.instanceId }),
      );
      fs.renameSync(
        path.join(this.dir, "desktop-request.json.tmp"),
        path.join(this.dir, "desktop-request.json"),
      );
      return;
    }
    const child = spawn(
      process.execPath,
      [fileURLToPath(new URL("./apply-update.mjs", import.meta.url)), jobFile],
      { detached: true, stdio: "ignore", windowsHide: true },
    );
    await new Promise((resolve, reject) => {
      child.once("spawn", resolve);
      child.once("error", reject);
    });
    child.unref();
  }
}
