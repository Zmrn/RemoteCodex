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
  }
  add(threadId, source, name) {
    if (typeof source !== "string") return null;
    if (dataImage.test(source)) return { src: source, name: name ?? "图片" };
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
  decorate(threadId, data) {
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
          const images = [],
            files = [];
          const add = (source, name) => {
            const ref = this.add(threadId, source, name);
            if (ref) images.push(ref);
          };
          if (user || delegated !== undefined) {
            const parsed = userContent(text);
            text = parsed.text;
            for (const file of parsed.files) {
              if (/\.(png|jpe?g|webp)$/i.test(file.path))
                add(file.path, file.name);
              else files.push({ name: file.name });
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
          }
          return {
            ...item,
            bridgeDisplay: {
              text,
              images: [
                ...new Map(images.map((i) => [i.id ?? i.src, i])).values(),
              ],
              files,
            },
          };
        }),
      })),
    };
  }
  read(threadId, id) {
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
