// Read-only dependency and desktop connection check for the single-file release.
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { DATA_DIR, PYTHON } from "./runtime.mjs";
import { protect } from "./agents.mjs";
import { Desktop, discover } from "./desktop.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const report = {
  scope: "bundled runtimes and read-only official desktop access",
  checks: {},
};
let desktop;
try {
  assert.equal(
    process.execPath.toLowerCase(),
    path.join(root, "runtime/node/node.exe").toLowerCase(),
  );
  assert.equal(
    path.resolve(PYTHON).toLowerCase(),
    path.join(root, "runtime/python/python.exe").toLowerCase(),
  );
  report.checks.bundledNode = process.version;
  const { stdout } = await promisify(execFile)(PYTHON, ["--version"], {
    windowsHide: true,
  });
  report.checks.bundledPython = stdout.trim();
  const sample = "portable-self-test-" + randomUUID();
  assert.equal(await protect(await protect(sample), "unprotect"), sample);
  report.checks.dpapiRoundTrip = true;
  assert.ok(
    fs
      .readFileSync(path.join(root, "public/index.html"), "utf8")
      .includes("__BRIDGE_CSRF__"),
  );
  report.checks.webAssets = true;
  const identity = await discover();
  report.checks.win32PipeDiscovery = true;
  report.checks.officialDesktopFound = identity.pipes.some((p) =>
    /\\WindowsApps\\OpenAI\.Codex_[^\\]+\\app\\ChatGPT\.exe$/i.test(
      p.image || "",
    ),
  );
  desktop = new Desktop();
  await desktop.connect();
  await desktop.call("list_projects");
  await desktop.call("list_threads", { limit: 1 });
  report.checks.officialProjectsAndThreads = true;
  report.result = "passed";
} catch (error) {
  report.result = "incomplete";
  // Do not save task contents, identities, credentials or full IPC responses.
  report.error = String(error.message).slice(0, 500);
  process.exitCode = 1;
} finally {
  desktop?.close();
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(
    path.join(DATA_DIR, "self-test.json"),
    JSON.stringify(report, null, 2),
  );
}
