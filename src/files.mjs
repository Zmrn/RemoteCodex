import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
export function contained(root, file) {
  const relative = path.relative(root, file);
  return (
    relative !== "" &&
    !relative.startsWith(".." + path.sep) &&
    relative !== ".." &&
    !path.isAbsolute(relative)
  );
}
export function resolveFile(root, name) {
  if (typeof name !== "string" || path.isAbsolute(name))
    throw Error("Invalid file name");
  const file = path.resolve(root, name);
  if (!contained(root, file)) throw Error("File outside output directory");
  let current = root;
  if (fs.lstatSync(root).isSymbolicLink())
    throw Error("Symlink output root rejected");
  for (const part of path.relative(root, file).split(path.sep)) {
    current = path.join(current, part);
    if (fs.lstatSync(current).isSymbolicLink()) throw Error("Symlink rejected");
  }
  const realRoot = fs.realpathSync(root),
    real = fs.realpathSync(file);
  if (!contained(realRoot, real) || !fs.statSync(real).isFile())
    throw Error("Not a regular output file");
  return real;
}
export function listFiles(root) {
  if (!fs.existsSync(root)) return [];
  if (fs.lstatSync(root).isSymbolicLink())
    throw Error("Symlink output root rejected");
  const result = [];
  function walk(dir, depth) {
    if (depth > 5 || result.length >= 200) return;
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      if (ent.isSymbolicLink()) continue;
      const p = path.join(dir, ent.name);
      if (ent.isDirectory()) walk(p, depth + 1);
      else if (ent.isFile()) {
        const st = fs.statSync(p);
        result.push({
          name: path.relative(root, p).replaceAll("\\", "/"),
          size: st.size,
          modifiedAt: st.mtime.toISOString(),
          source: "original-local-output-file",
        });
        if (result.length >= 200) return;
      }
    }
  }
  walk(root, 0);
  return result;
}
export function saveUpload(dir, dataUrl) {
  const m = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/.exec(
    dataUrl,
  );
  if (!m) throw Error("Only PNG/JPEG/WebP images");
  const bytes = Buffer.from(m[2], "base64");
  if (bytes.length > 5 * 1024 * 1024 || bytes.length < 12)
    throw Error("Image size limit");
  const signature =
    m[1] === "png"
      ? bytes
          .subarray(0, 8)
          .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
      : m[1] === "jpeg"
        ? bytes[0] === 255 && bytes[1] === 216
        : bytes.toString("ascii", 0, 4) === "RIFF" &&
          bytes.toString("ascii", 8, 12) === "WEBP";
  if (!signature) throw Error("Image signature mismatch");
  fs.mkdirSync(dir, { recursive: true });
  const hash = createHash("sha256").update(bytes).digest("hex");
  const p = path.join(dir, hash + "." + m[1]);
  if (!fs.existsSync(p)) fs.writeFileSync(p, bytes, { flag: "wx" });
  return { path: p, sha256: hash, bytes: bytes.length };
}
