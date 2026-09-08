import fs from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { protect } from "./agents.mjs";
export async function pairingKey(dir) {
  const file = path.join(dir, "remote-access.json");
  if (fs.existsSync(file))
    return protect(JSON.parse(fs.readFileSync(file)).sealedKey, "unprotect");
  const key = randomBytes(32).toString("hex"),
    sealedKey = await protect(key);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ sealedKey }, null, 2), {
    flag: "wx",
  });
  return key;
}
