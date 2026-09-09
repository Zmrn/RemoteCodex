import test from "node:test";
import assert from "node:assert/strict";
import { DeviceConnections } from "../public/device-connections.mjs";
import { allowedRoute } from "../src/remote.mjs";

function view(api) {
  const elements = new Map(["device-connections-panel", "keep-device-connections", "device-connections-status"].map(id => [id, { checked: true, disabled: false, hidden: true, textContent: "" }]));
  const ui = Object.assign(Object.create(DeviceConnections.prototype), { $: id => elements.get(id), api });
  return { ui, control: elements.get("keep-device-connections"), message: elements.get("device-connections-status") };
}
test("all-device status is local and independent of whichever remote task is selected", async () => {
  const calls = [];
  const { ui, message } = view(async route => { calls.push(route); return { enabled: true, running: true, connected: 1, devices: 2, detail: "全部设备独立同步，断线自动重连" }; });
  await ui.refresh();
  assert.deepEqual(calls, ["/api/device-connections"]);
  assert.match(message.textContent, /1 \/ 2 台已连接/);
  assert.equal(allowedRoute("POST", "/api/device-connections"), false);
  assert.equal(allowedRoute("GET", "/api/device-connections"), false);
});
test("pausing writes only the local service setting and reflects server-confirmed state", async () => {
  const calls = [];
  const { ui, control, message } = view(async (...args) => { calls.push(args); return { enabled: false, running: false, detail: "持续同步已暂停" }; });
  control.checked = false;
  await ui.toggle();
  assert.deepEqual(calls, [["/api/device-connections", { enabled: false }]]);
  assert.equal(control.checked, false); assert.equal(control.disabled, false);
  assert.equal(message.textContent, "持续同步已暂停");
});
test("failed setting persists the previous displayed choice, with no blind request replay", async () => {
  let calls = 0;
  const { ui, control, message } = view(async () => { calls++; throw Error("同步设置无法保存"); });
  control.checked = false;
  await ui.toggle();
  assert.equal(calls, 1); assert.equal(control.checked, true); assert.equal(control.disabled, false);
  assert.match(message.textContent, /无法保存/);
});
