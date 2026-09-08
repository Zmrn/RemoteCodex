import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, sign, createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { ROOT } from "../src/bridge.mjs";
import {
  verifyManifest,
  verifyExecutable,
  newerVersion,
} from "../src/update-format.mjs";
import { allowedRoute } from "../src/remote.mjs";
test("release signature and executable digest fail closed", () => {
  const { publicKey, privateKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
  });
  const raw = Buffer.alloc(2048);
  raw.write("MZ");
  const m = {
    schema: 1,
    version: "0.8.1",
    platform: "windows-x64",
    file: "RemoteCodex.exe",
    bytes: raw.length,
    sha256: createHash("sha256").update(raw).digest("hex"),
  };
  const payload = Buffer.from(JSON.stringify(m));
  const e = {
    payload: payload.toString("base64"),
    signature: sign("sha256", payload, privateKey).toString("base64"),
  };
  assert.deepEqual(verifyManifest(e, publicKey), m);
  assert.throws(
    () =>
      verifyManifest(
        {
          ...e,
          payload: Buffer.from(
            JSON.stringify({ ...m, version: "99.0.0" }),
          ).toString("base64"),
        },
        publicKey,
      ),
    /签名/,
  );
  const folder = fs.mkdtempSync(path.join(ROOT, "test/scratch/update-")),
    file = path.join(folder, "fixture.bin");
  fs.writeFileSync(file, raw);
  assert.doesNotThrow(() => verifyExecutable(file, m));
  raw[500] = 1;
  const corrupt = path.join(folder, "corrupt.bin");
  fs.writeFileSync(corrupt, raw);
  assert.throws(() => verifyExecutable(corrupt, m), /校验/);
});
test("version ordering and remote update routes remain constrained", () => {
  assert.equal(newerVersion("0.10.0", "0.9.9"), true);
  assert.equal(newerVersion("0.8.1", "0.8.1"), false);
  assert.equal(newerVersion("0.7.0", "0.8.1"), false);
  assert.throws(() => newerVersion("latest", "0.8.1"));
  assert.equal(allowedRoute("POST", "/api/updates/install"), true);
  assert.equal(allowedRoute("POST", "/api/updates/settings"), true);
  for (const route of [
    "/api/local-access",
    "/api/pairing-key",
    "/api/updates/activity",
    "/api/stop",
  ])
    assert.equal(allowedRoute("POST", route), false);
});
