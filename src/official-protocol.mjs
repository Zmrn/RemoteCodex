// Single catalog for the installed official desktop's private protocol.
// This is not a standalone app-server client.
import fs from "node:fs";
import { createHash } from "node:crypto";
const raw = fs.readFileSync(new URL("./official-desktop.json", import.meta.url), "utf8");
const freeze = value => {
  if (value && typeof value === "object") {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
};
export const OFFICIAL = freeze(JSON.parse(raw));
export const CATALOG_SHA256 = createHash("sha256").update(raw).digest("hex");
export const TOOLS = freeze(Object.fromEntries(Object.entries(OFFICIAL.tools).map(([key, value]) => [key, value.name])));
export const EVENTS = freeze(Object.fromEntries(Object.entries(OFFICIAL.events).map(([key, value]) => [key, value.method])));
export function supportedBuild(image) {
  const { packagePrefix, packageSuffix, verifiedVersions } = OFFICIAL.support;
  return typeof image === "string" && verifiedVersions.some(version => image.includes(packagePrefix + version + packageSuffix));
}
export function assertSupportedBuild(image) {
  if (!supportedBuild(image)) throw Error("Unsupported desktop build: read-only until protocol is revalidated");
}
export function supportManifest() {
  const { officialProduct, platform, verifiedVersions, unknownVersionPolicy, codex, chat, work } = OFFICIAL.support;
  return { catalogSha256: CATALOG_SHA256, officialProduct, platform, verifiedVersions: [...verifiedVersions], unknownVersionPolicy, modes: { codex, chat, work } };
}
export function desktopCompatibility(image) {
  const prefix = OFFICIAL.support.packagePrefix;
  const at = typeof image === "string" ? image.indexOf(prefix) : -1;
  const version = at >= 0 ? /^(\d+\.\d+\.\d+\.\d+)_/.exec(image.slice(at + prefix.length))?.[1] ?? null : null;
  return { ...supportManifest(), detectedVersion: version, writeSupported: supportedBuild(image) };
}
export function protocolRequest(pipe, key, params, options = {}) {
  const spec = OFFICIAL.ipc[key];
  if (!spec || key === "following") throw Error("Unknown official request: " + key);
  if (Object.hasOwn(options, "version")) throw Error("Official protocol versions must come from the catalog");
  return pipe.request(spec.method, params, { ...options, version: spec.version });
}
export function protocolBroadcast(pipe, key, params, targets) {
  const spec = OFFICIAL.ipc[key];
  if (key !== "following") throw Error("Unknown official broadcast: " + key);
  return pipe.broadcast(spec.method, params, spec.version, targets);
}
