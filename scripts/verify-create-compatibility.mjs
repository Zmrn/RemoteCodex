import fs from "node:fs";
import path from "node:path";
import { CompatibilityProbes } from "../src/compatibility-probe.mjs";
import { ROOT } from "../src/bridge.mjs";
if (!process.argv.includes("--create-probe")) throw Error("Use --create-probe to run two dedicated official tasks");
const expectedVersion = process.argv.find(x => x.startsWith("--version="))?.slice(10);
const dir = fs.mkdtempSync(path.join(ROOT, "work/create-compatibility-"));
const probes = new CompatibilityProbes(dir), requestId = "create-compatibility-" + Date.now();
probes.start({ requestId, expectedVersion, scenario: "create-vision-owner-v1" });
let last;
for (;;) {
  const r = probes.read(requestId);
  const progress = r.phase + ":" + r.checks?.length;
  if (last !== progress) { console.log(JSON.stringify({ phase: r.phase, checks: r.checks, threadId: r.imageThreadId ?? r.textThreadId, error: r.error, directory: dir })); last = progress; }
  if (r.phase !== "running") { if (r.phase !== "passed") process.exitCode = 1; break; }
  await new Promise(r => setTimeout(r, 1000));
}
