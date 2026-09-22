import { OFFICIAL, TOOLS } from "./official-protocol.mjs";
// Current desktop tools publish their host's model/effort catalog in this schema.
// This is a live desktop source, not a separate app-server model list.
export function parseModels(catalog) {
  const field = catalog.find(
    (t) => t.namespace === OFFICIAL.discovery.toolsNamespace && t.name === TOOLS.sendMessage,
  )?.inputSchema?.properties?.model;
  const models = [
    ...(field?.description ?? "").matchAll(
      /([a-z0-9][a-z0-9._-]+) \(([^()]*?); supported reasoning efforts: ([a-z, ]+)\)/g,
    ),
  ].map((m) => ({
    id: m[1],
    description: m[2],
    efforts: m[3]
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  }));
  if (!models.length) throw Error("官方桌面模型目录不可读，暂不能更换模型");
  return models;
}
export function modelOverrides(input = {}, models) {
  if (
    !input ||
    typeof input !== "object" ||
    Array.isArray(input) ||
    Object.keys(input).some((k) => !["model", "effort"].includes(k))
  )
    throw Error("Invalid model settings");
  if (!Object.keys(input).length) return {};
  const model = models.find((m) => m.id === input.model);
  if (!model) throw Error("模型未出现在当前设备的官方目录中");
  if (input.effort !== undefined && !model.efforts.includes(input.effort))
    throw Error("该模型不支持此推理强度");
  return {
    model: model.id,
    ...(input.effort === undefined ? {} : { effort: input.effort }),
  };
}
export function permissionOverrides(mode) {
  if (mode === undefined || mode === "keep") return {};
  // These are the official agent-mode presets, not just profile selection.
  // A profile-only update preserves the previous approval policy/reviewer.
  // Named profiles still let the official application enforce requirements.
  const permissions = {
    "read-only": ":read-only",
    workspace: ":workspace",
    full: ":danger-full-access",
  }[mode];
  if (!permissions) throw Error("Invalid permission mode");
  return {
    permissions,
    approvalPolicy: mode === "full" ? "never" : "on-request",
    approvalsReviewer: "user",
  };
}

export function permissionPresetMatches(mode, current) {
  const expected = permissionOverrides(mode);
  if (!expected.permissions || !current) return false;
  const profile = current.activePermissionProfile;
  return profile?.id === expected.permissions &&
    current.approvalPolicy === expected.approvalPolicy &&
    current.approvalsReviewer === expected.approvalsReviewer;
}
