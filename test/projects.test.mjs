import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Bridge } from "../src/bridge.mjs";
import { projectSelection, savedProjectTarget } from "../src/project-target.mjs";
import { modeCatalog } from "../public/modes.mjs";
const id = "99999999-1111-4111-8111-111111111111";
const project = { projectId: "saved-project", projectKind: "local", hostId: "local", path: "C:\\fixture", isGitRepository: true };
const selection = { projectId: project.projectId, environment: "local" };
function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bridge-project-"));
  const bridge = new Bridge(dir), calls = [], catalog = { projects: [project] };
  bridge.connected = true;
  bridge.desktop = {
    identity: { appToolsPipe: { image: "OpenAI.Codex_26.901.6511.0_x64__fixture" } },
    catalog: [{ namespace: "codex_app", name: "send_message_to_thread", inputSchema: { properties: { model: { description: "fixture (Fixture; supported reasoning efforts: low)" } } } }],
    call: async (name, args) => { calls.push({ name, args }); return name === "list_projects" ? catalog : { threadId: id, cwd: project.path }; },
    close() {},
  };
  bridge.follow = async () => {};
  t.after(() => { bridge.disconnect(); clearInterval(bridge.subscriptionTimer); fs.rmSync(dir, { recursive: true }); });
  return { bridge, calls, catalog };
}
test("project create resolves the target desktop catalog and sends the saved ID with explicit local execution", async t => {
  const { bridge, calls, catalog } = fixture(t);
  const first = await bridge.create("project-create-001", "synthetic probe", {}, selection);
  assert.equal(first.result.threadId, id);
  assert.deepEqual(calls[0], { name: "list_projects", args: undefined });
  assert.deepEqual(calls[1].args.target, { type: "project", projectId: project.projectId, environment: { type: "local" } });
  assert.equal(Object.hasOwn(bridge.db.tests, id), false, "ordinary creation is not a test target");
  assert.equal(Object.hasOwn(calls.find(c => c.name === "create_thread").args, "title"), false);
  catalog.projects = [];
  assert.equal((await bridge.create("project-create-001", "synthetic probe", {}, selection)).deduplicated, true);
  assert.equal(calls.length, 2);
  await assert.rejects(bridge.create("project-create-001", "synthetic probe", {}), /different content/);
  assert.ok(!fs.readFileSync(bridge.stateFile, "utf8").includes("synthetic probe"));
});
test("missing, remote or Chat projects never become projectless tasks", async t => {
  const { bridge, calls, catalog } = fixture(t);
  for (const [i, projects] of [[], [{ ...project, projectKind: "remote", hostId: "remote-host" }], [{ ...project, projectKind: "chatgpt" }]].entries()) {
    catalog.projects = projects;
    await assert.rejects(bridge.create("project-invalid-" + i, "probe", {}, selection), /所选项目|本地 Codex/);
    assert.equal(bridge.db.requests["project-invalid-" + i].status, "rejected");
  }
  assert.equal(calls.filter(c => c.name === "create_thread").length, 0);
});
test("reject arbitrary paths and unsupported environments before dispatch", () => {
  for (const input of [{ projectId: "x", path: "C:\\other", environment: "local" }, { projectId: "x" }, { projectId: "x", environment: "worktree" }, "x", [], {}])
    assert.throws(() => projectSelection(input), /无效/);
  assert.throws(() => savedProjectTarget(selection, { projects: [project, project] }), /无法确认/);
});
test("projectless creation stays compatible; local creation records never resurrect absent official tasks", async t => {
  const { bridge, calls } = fixture(t);
  await bridge.create("projectless-001", "probe");
  assert.equal(calls.length, 1); assert.equal(calls[0].args.target.type, "projectless");
  const records = { [id]: { projectId: project.projectId, title: "old title" } };
  assert.deepEqual(modeCatalog({}, "codex", records), []);
  const official = { id, kind: "codex", title: "official title", projectId: "moved" };
  assert.deepEqual(modeCatalog({ threads: [official] }, "codex", records), [official]);
  assert.equal(records[id].title, "old title", "creation safety metadata is retained");
});
test("unknown creation acknowledgement never dispatches a second task after restart", async t => {
  const { bridge, calls } = fixture(t), original = bridge.desktop.call;
  bridge.desktop.call = async (name, args) => { const result = await original(name, args); if (name === "create_thread") throw Error("pipe lost"); return result; };
  await assert.rejects(bridge.create("project-unknown-001", "probe", {}, selection), /pipe lost/);
  bridge.db = JSON.parse(fs.readFileSync(bridge.stateFile));
  assert.equal((await bridge.create("project-unknown-001", "probe", {}, selection)).status, "outcome-unknown");
  assert.equal(calls.filter(c => c.name === "create_thread").length, 1);
});
test("connection replacement during catalog lookup aborts before sending", async t => {
  const { bridge, calls, catalog } = fixture(t);
  bridge.desktop.call = async () => { bridge.desktop = { ...bridge.desktop }; return catalog; };
  await assert.rejects(bridge.create("project-connection-001", "probe", {}, selection), /连接已更换/);
  assert.equal(calls.length, 0);
});
