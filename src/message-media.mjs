import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { userContent, itemText } from "../public/message-content.mjs";

const dataImage = /^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+$/;
// Receiving/saving originals has a separate limit from sending images.
const GIF_BYTES = 64 * 1024 * 1024;
const imageLimit = type => type === 'image/gif' ? GIF_BYTES : 25 * 1024 * 1024;
const sizeError = '图片格式不受支持或超过上限（GIF 64 MiB，其他图片 25 MiB）';
// Official Markdown uses /C:/... as an absolute Windows link. Passing it
// directly to fs resolves to C:\C:\... on Windows. Strip only that exact prefix;
// UNC/device paths, relative paths and URL escapes keep the existing checks.
export function messageLocalPath(source) {
  return process.platform === 'win32' && typeof source === 'string' && /^\/[a-z]:[\\/]/i.test(source)
    ? source.slice(1) : source;
}
function readDataImage(source) {
  if (typeof source !== 'string' || source.length > 4 * Math.ceil(GIF_BYTES / 3) + 32 || !dataImage.test(source)) throw Error(sizeError);
  const bytes = Buffer.from(source.slice(source.indexOf(',') + 1), 'base64'), type = imageType(bytes);
  if (!type || bytes.length > imageLimit(type)) throw Error(sizeError);
  return {bytes, type};
}
// A path is an authorization handle, not immutable image content. Probe only
// metadata while reading history; reading/hashing every large GIF on each poll
// would block the target. Metadata can collide on coarse filesystems; a new
// official message is separately scoped below and never trusts an older preview.
function localImageRevision(file, revisions) {
  if (revisions?.has(file)) return revisions.get(file);
  let stamp;
  try {
    const s = fs.statSync(file, { bigint: true });
    stamp = [s.dev, s.ino, s.mode, s.size, s.mtimeNs, s.ctimeNs, s.birthtimeNs].join(':');
  } catch (e) { stamp = 'unavailable:' + (e.code ?? 'unknown'); }
  const revision = createHash('sha256').update('local-image:' + file + ':' + stamp).digest('hex');
  revisions?.set(file, revision);
  return revision;
}
export function imageType(bytes) {
  if (['GIF87a', 'GIF89a'].some(header => bytes.subarray(0, 6).equals(Buffer.from(header))))
    return 'image/gif';
  if (
    bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  )
    return "image/png";
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255)
    return "image/jpeg";
  if (
    bytes.toString("ascii", 0, 4) === "RIFF" &&
    bytes.toString("ascii", 8, 12) === "WEBP"
  )
    return "image/webp";
  return null;
}
export class MessageMedia {
  constructor() {
    this.threads = new Map();
    this.inline = new Map();
    this.inlineBytes = 0;
    this.attachments = new Map();
    this.recentThreads = new Map();
    this.deferred = new Map();
  }
  addDeferred(threadId, key, read, name = '图片') {
    const id = createHash('sha256').update('official-history:' + key).digest('hex');
    const token = threadId + ':' + id;
    this.deferred.delete(token); this.deferred.set(token, {read, name});
    while (this.deferred.size > 4096) this.deferred.delete(this.deferred.keys().next().value);
    return {id, name};
  }
  addFile(threadId, source, name) {
    // Only exact local paths actually present in a read message become download IDs.
    // Never follow UNC/device paths or accept arbitrary paths from HTTP callers.
    source = messageLocalPath(source);
    if (
      typeof source !== "string" ||
      !path.isAbsolute(source) ||
      /^[\\/]{2}/.test(source)
    )
      return null;
    const file = path.normalize(source);
    const id = createHash("sha256").update(file).digest("hex");
    let entries = this.attachments.get(threadId);
    if (!entries) this.attachments.set(threadId, (entries = new Map()));
    const previous = entries.get(id);
    let real = previous?.real ?? null,
      size = null;
    try {
      const stat = fs.statSync(file);
      if (!stat.isFile()) return null;
      real ??= fs.realpathSync(file);
      size = stat.size;
    } catch {}
    const label = path.basename(name || file).replace(/[\r\n]/g, "");
    if (entries.size < 1000 || previous)
      entries.set(id, { file, real, name: label, size });
    return entries.has(id) ? { id, name: label, size } : null;
  }
  listFiles(threadId) {
    return [...(this.attachments.get(threadId) ?? [])].map(([id, entry]) => ({
      id,
      name: entry.name,
      size: entry.size,
    }));
  }
  openFile(threadId, id) {
    const entry = this.attachments.get(threadId)?.get(id);
    if (!entry) throw Error("文件未出现在已读取的此会话中，请刷新会话");
    if (!entry.real || fs.realpathSync(entry.file) !== entry.real)
      throw Error("原文件已移动、删除或替换，请重新读取会话");
    const fd = fs.openSync(entry.real, "r");
    try {
      const stat = fs.fstatSync(fd);
      if (!stat.isFile() || stat.size > 256 * 1024 * 1024)
        throw Error("文件不可用或超过 256 MB");
      return { fd, size: stat.size, name: entry.name };
    } catch (e) {
      fs.closeSync(fd);
      throw e;
    }
  }
  add(threadId, source, name, externalImages = false, revisions, reference) {
    if (typeof source !== "string") return null;
    if (dataImage.test(source)) {
      if (!externalImages) return { src: source, name: name ?? "图片" };
      const id = createHash("sha256").update(source).digest("hex");
      const key = threadId + ":" + id;
      const old = this.inline.get(key);
      if (old) this.inline.delete(key);
      else this.inlineBytes += source.length;
      this.inline.set(key, {
        source,
        name: name ?? "image." + source.slice(11, source.indexOf(";")),
      });
      while (this.inlineBytes > 96 * 1024 * 1024 && this.inline.size > 1) {
        const first = this.inline.keys().next().value;
        this.inlineBytes -= this.inline.get(first).source.length;
        this.inline.delete(first);
      }
      return { id, name: this.inline.get(key).name };
    }
    let file = messageLocalPath(source);
    if (!path.isAbsolute(file) || /^[\\/]{2}/.test(file) || !/\.(png|jpe?g|webp|gif)$/i.test(file))
      return null;
    const id = createHash("sha256").update(file).digest("hex");
    let entries = this.threads.get(threadId);
    if (!entries) this.threads.set(threadId, (entries = new Map()));
    if (entries.size < 1000)
      entries.set(id, { file, name: name ?? path.basename(file) });
    const contentKey = createHash('sha256').update(JSON.stringify([localImageRevision(file, revisions), reference ?? null])).digest('hex');
    return { id, contentKey, name: name ?? path.basename(file), ...(/\.gif$/i.test(file) ? {downloadName:path.basename(file)} : {}) };
  }
  decorate(threadId, data, { externalImages = false } = {}) {
    const revisions = new Map();
    this.recentThreads.delete(threadId);
    this.recentThreads.set(threadId, true);
    while (this.recentThreads.size > 64) {
      const old = this.recentThreads.keys().next().value;
      this.recentThreads.delete(old);
      this.threads.delete(old);
      this.attachments.delete(old);
      for (const [key, entry] of this.inline) if (key.startsWith(old + ':')) {
        this.inlineBytes -= entry.source.length;
        this.inline.delete(key);
      }
    }
    return {
      ...data,
      turns: (data.turns ?? []).map((turn) => ({
        ...turn,
        items: (turn.items ?? []).map((item) => {
          const reference = JSON.stringify([turn.id ?? null, item.id ?? null]);
          const user = ["userMessage", "steeringUserMessage"].includes(
            item.type,
          );
          const output =
            typeof item.output === "string" ? item.output : item.output?.text;
          const delegated =
            item.type === "functionCallOutput" && item.namespace === "codex_app"
              ? /<input>([\s\S]*?)<\/input>/.exec(output ?? "")?.[1]
              : undefined;
          let text = user ? itemText(item) : (delegated ?? item.text);
          const images = [...(item.bridgeHistoryImages ?? [])],
            files = [];
          const add = (source, name) => {
            const ref = this.add(threadId, source, name, externalImages, revisions, reference);
            if (ref) images.push(ref);
          };
          if (user || delegated !== undefined) {
            const parsed = userContent(text);
            text = parsed.text;
            for (const file of parsed.files) {
              if (/\.(png|jpe?g|webp|gif)$/i.test(file.path))
                add(file.path, file.name);
              else {
                const ref = this.addFile(threadId, file.path, file.name);
                files.push(ref ?? { name: file.name });
              }
            }
            for (const c of item.content ?? item.input ?? []) {
              if (c.type === "image") add(c.url);
              if (c.type === "localImage") add(c.path);
            }
          }
          if (item.type === "imageGeneration") {
            const result = item.savedPath ?? item.result;
            if (typeof result === "string")
              add(
                path.isAbsolute(result) || dataImage.test(result)
                  ? result
                  : "data:image/png;base64," + result,
              );
          }
          if (item.type === "agentMessage" && typeof text === "string") {
            text = text.replace(
              /!\[([^\]]*)\]\(<?((?:[A-Za-z]:[\\/]|\/)[^\n]*?)>?\)/g,
              (whole, label, file) => {
                const ref = this.add(threadId, file, label || undefined, false, revisions, reference);
                if (!ref) return whole;
                images.push(ref);
                return "";
              },
            );
            text = text.replace(
              /\[([^\]]+)\]\(<?((?:[A-Za-z]:[\\/]|\/)[^\n]*?)>?\)/g,
              (whole, label, file) => {
                // A line suffix is a source-navigation link, not part of the filename.
                const source = file.replace(/:\d+(?::\d+)?$/, "");
                const ref = this.addFile(
                  threadId,
                  source,
                  path.basename(source),
                );
                if (!ref) return whole;
                files.push(ref);
                return label;
              },
            );
          }
          return {
            ...item,
            bridgeDisplay: {
              text,
              images: [
                ...new Map(images.map((i) => [i.id ?? i.src, i])).values(),
              ],
              files: [
                ...new Map(files.map((f) => [f.id ?? f.name, f])).values(),
              ],
            },
          };
        }),
      })),
    };
  }
  read(threadId, id) {
    const deferred = this.deferred.get(threadId + ':' + id);
    if (deferred) {
      const source = deferred.read();
      return {...readDataImage(source), name:deferred.name};
    }
    const inline = this.inline.get(threadId + ":" + id);
    if (inline) {
      return {...readDataImage(inline.source), name:inline.name};
    }
    const entry = this.threads.get(threadId)?.get(id);
    if (!entry) throw Error("图片未出现在已读取的此会话中，请刷新会话");
    let fd;
    try { fd = fs.openSync(entry.file, "r"); }
    catch (e) {
      if (['ENOENT', 'ENOTDIR'].includes(e.code)) throw Error('找不到原图，文件可能已移动或删除');
      if (['EACCES', 'EPERM'].includes(e.code)) throw Error('目标设备没有读取原图的权限');
      throw e;
    }
    try {
      const stat = fs.fstatSync(fd);
      const header = Buffer.alloc(12);
      if (!stat.isFile()) throw Error('图片文件不可用');
      fs.readSync(fd, header, 0, header.length, 0);
      const declared = imageType(header);
      if (!declared) throw Error("附件不是支持的图片文件");
      if (stat.size > imageLimit(declared)) throw Error(sizeError);
      const bytes = fs.readFileSync(fd),
        type = imageType(bytes);
      if (!type) throw Error("附件不是支持的图片文件");
      if (bytes.length > imageLimit(type)) throw Error(sizeError);
      return { bytes, type, name: entry.name };
    } finally {
      fs.closeSync(fd);
    }
  }
}
