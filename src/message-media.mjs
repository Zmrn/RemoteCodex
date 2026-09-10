import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { userContent, itemText } from "../public/message-content.mjs";

const dataImage = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/;
export function imageType(bytes) {
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
  add(threadId, source, name, externalImages = false) {
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
    let file = source;
    if (!path.isAbsolute(file) || !/\.(png|jpe?g|webp)$/i.test(file))
      return null;
    const id = createHash("sha256").update(file).digest("hex");
    let entries = this.threads.get(threadId);
    if (!entries) this.threads.set(threadId, (entries = new Map()));
    if (entries.size < 1000)
      entries.set(id, { file, name: name ?? path.basename(file) });
    return { id, name: name ?? path.basename(file) };
  }
  decorate(threadId, data, { externalImages = false } = {}) {
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
            const ref = this.add(threadId, source, name, externalImages);
            if (ref) images.push(ref);
          };
          if (user || delegated !== undefined) {
            const parsed = userContent(text);
            text = parsed.text;
            for (const file of parsed.files) {
              if (/\.(png|jpe?g|webp)$/i.test(file.path))
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
                const ref = this.add(threadId, file, label || undefined);
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
      if (typeof source !== 'string' || source.length > 36 * 1024 * 1024 || !dataImage.test(source)) throw Error('官方图片格式不受支持或超过 25 MB');
      const bytes = Buffer.from(source.slice(source.indexOf(',') + 1), 'base64'), type = imageType(bytes);
      if (!type || bytes.length > 25 * 1024 * 1024) throw Error('官方图片文件不可用或大于 25 MB');
      return {bytes,type,name:deferred.name};
    }
    const inline = this.inline.get(threadId + ":" + id);
    if (inline) {
      const bytes = Buffer.from(
        inline.source.slice(inline.source.indexOf(",") + 1),
        "base64",
      );
      const type = imageType(bytes);
      if (!type || bytes.length > 25 * 1024 * 1024)
        throw Error("图片文件不可用或大于 25 MB");
      return { bytes, type, name: inline.name };
    }
    const entry = this.threads.get(threadId)?.get(id);
    if (!entry) throw Error("图片未出现在已读取的此会话中，请刷新会话");
    const fd = fs.openSync(entry.file, "r");
    try {
      const stat = fs.fstatSync(fd);
      if (!stat.isFile() || stat.size > 25 * 1024 * 1024)
        throw Error("图片文件不可用或大于 25 MB");
      const bytes = fs.readFileSync(fd),
        type = imageType(bytes);
      if (!type) throw Error("附件不是支持的图片文件");
      return { bytes, type, name: entry.name };
    } finally {
      fs.closeSync(fd);
    }
  }
}
