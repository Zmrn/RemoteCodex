// Private publishing key stays DPAPI-encrypted on this Windows user account.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  generateKeyPairSync,
  createPublicKey,
  sign,
  createHash,
} from "node:crypto";
import { protect } from "../src/agents.mjs";
import { supportManifest } from "../src/official-protocol.mjs";
import { isDeepStrictEqual } from "node:util";
import { checkGenerated, releaseNotes } from "./compatibility-report.mjs";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const keyFile = path.join(root, "data/release-signing-key.json"),
  publicFile = path.join(root, "src/update-public-key.pem");
if (process.argv[2] === "--init") {
  if (fs.existsSync(keyFile) || fs.existsSync(publicFile))
    throw Error("Publishing key already initialized; do not regenerate it");
  const { publicKey, privateKey } = generateKeyPairSync("rsa", {
    modulusLength: 3072,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });
  fs.mkdirSync(path.dirname(keyFile), { recursive: true });
  fs.writeFileSync(
    keyFile,
    JSON.stringify({ sealedPrivateKey: await protect(privateKey) }),
    { flag: "wx" },
  );
  fs.writeFileSync(publicFile, publicKey, { flag: "wx" });
  console.log(
    "Publishing public key created; private key saved with Windows DPAPI.",
  );
} else {
  const [exePath, version, outputPath] = process.argv.slice(2);
  const android = path.extname(exePath ?? "").toLowerCase() === ".apk";
  if (!exePath || !outputPath || !/^\d+\.\d+\.\d+$/.test(version ?? ""))
    throw Error("Usage: node scripts/sign-release.mjs EXE VERSION OUTPUT_JSON");
  checkGenerated();
  const support = supportManifest();
  const buildFile = exePath.replace(/\.(exe|apk)$/i, android ? ".apk.build.json" : ".build.json");
  const build = JSON.parse(fs.readFileSync(buildFile, "utf8"));
  if (build.version !== version || !isDeepStrictEqual(build.desktopCompatibility, support))
    throw Error("Rebuild artifact with the current official desktop compatibility catalog before signing");
  const privateKey = await protect(
    JSON.parse(fs.readFileSync(keyFile)).sealedPrivateKey,
    "unprotect",
  );
  if (
    createPublicKey(privateKey).export({ type: "spki", format: "pem" }) !==
    fs.readFileSync(publicFile, "utf8")
  )
    throw Error(
      "Publishing key does not match the installed client public key",
    );
  const bytes = fs.readFileSync(exePath);
  const payload = Buffer.from(
    JSON.stringify({
      schema: 1,
      version,
      platform: android ? "android" : "windows-x64",
      file: android ? "RemoteCodex.apk" : "RemoteCodex.exe",
      ...(android ? {packageName: "com.anso.remotecodex", versionCode: version.split('.').reduce((n, v) => n * 1000 + Number(v), 0)} : {}),
      bytes: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      publishedAt: new Date().toISOString(),
      desktopCompatibility: support,
      releaseNotesSha256: createHash("sha256").update(releaseNotes(version)).digest("hex"),
    }),
  );
  fs.writeFileSync(
    outputPath,
    JSON.stringify(
      {
        payload: payload.toString("base64"),
        signature: sign("sha256", payload, privateKey).toString("base64"),
      },
      null,
      2,
    ),
  );
  console.log("Signed release " + version + " (no private key exported).");
}
