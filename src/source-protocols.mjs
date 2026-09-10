import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { OFFICIAL } from "./official-protocol.mjs";
export function sourceProtocols(image) {
  const asar = path.join(path.dirname(image), "resources", "app.asar"), fd = fs.openSync(asar, "r");
  try {
    const prefix = Buffer.alloc(16); fs.readSync(fd, prefix, 0, 16, 0);
    const size = prefix.readUInt32LE(12), offset = 8 + prefix.readUInt32LE(4);
    if (size > 16 * 1024 * 1024 || size < 2) throw Error("Unexpected ASAR header");
    const raw = Buffer.alloc(size); fs.readSync(fd, raw, 0, size, 16);
    const tree = JSON.parse(raw), files = [];
    const walk = (entries, prefix = "") => { for (const [name, item] of Object.entries(entries ?? {})) {
      const key = prefix + name; if (item.files) walk(item.files, key + "/");
      else if (/^\.vite\/build\/src-[\w-]+\.js$/.test(key)) files.push({ key, item });
    } };
    walk(tree.files);
    const records = [];
    for (const { key, item } of files) {
      if (item.unpacked || item.size > 32 * 1024 * 1024 || !Number.isSafeInteger(Number(item.offset))) continue;
      const buf = Buffer.alloc(item.size); fs.readSync(fd, buf, 0, buf.length, offset + Number(item.offset));
      const text = buf.toString("utf8");
      if (!Object.values(OFFICIAL.ipc).some(spec => spec.method !== 'initialize' && text.includes('"' + spec.method + '":'))) continue;
      const methods = {};
      for (const spec of Object.values(OFFICIAL.ipc)) {
        const at = text.indexOf('"' + spec.method + '":');
        if (at >= 0) methods[spec.method] = Number(/^\d+/.exec(text.slice(at + spec.method.length + 3))?.[0]);
      }
      records.push({ file: key, sha256: createHash("sha256").update(buf).digest("hex"), methods });
    }
    return records;
  } finally { fs.closeSync(fd); }
}
