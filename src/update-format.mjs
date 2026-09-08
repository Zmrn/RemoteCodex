import fs from "node:fs";
import { verify, createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
export const updatePublicKey = () =>
  fs.readFileSync(
    fileURLToPath(new URL("./update-public-key.pem", import.meta.url)),
  );
export function newerVersion(a, b) {
  if (![a, b].every((v) => /^\d+\.\d+\.\d+$/.test(v)))
    throw Error("更新版本号无效");
  const x = a.split(".").map(Number),
    y = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i];
  return false;
}
export function verifyManifest(envelope, publicKey = updatePublicKey()) {
  if (
    !envelope ||
    typeof envelope.payload !== "string" ||
    typeof envelope.signature !== "string" ||
    envelope.payload.length > 16000 ||
    envelope.signature.length > 2048
  )
    throw Error("更新清单格式无效");
  const payload = Buffer.from(envelope.payload, "base64");
  if (
    !verify(
      "sha256",
      payload,
      publicKey,
      Buffer.from(envelope.signature, "base64"),
    )
  )
    throw Error("更新签名校验失败，未执行文件");
  const m = JSON.parse(payload);
  if (
    m.schema !== 1 ||
    m.platform !== "windows-x64" ||
    m.file !== "RemoteCodex.exe" ||
    !/^\d+\.\d+\.\d+$/.test(m.version) ||
    !/^[a-f0-9]{64}$/.test(m.sha256) ||
    !Number.isSafeInteger(m.bytes) ||
    m.bytes < 1024 ||
    m.bytes > 150 * 1024 * 1024
  )
    throw Error("更新清单内容无效");
  return m;
}
export function verifyExecutable(file, manifest) {
  const raw = fs.readFileSync(file);
  if (
    raw.length !== manifest.bytes ||
    raw.subarray(0, 2).toString() !== "MZ" ||
    createHash("sha256").update(raw).digest("hex") !== manifest.sha256
  )
    throw Error("更新文件校验失败，未执行文件");
}
