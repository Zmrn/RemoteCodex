// Only saved projects on this bridge's official desktop may be selected.
// The UI explicitly selects local execution; worktrees/branches are not implied.
export function projectSelection(input) {
  if (input === undefined || input === null) return null;
  if (typeof input !== "object" || Array.isArray(input) ||
      Object.keys(input).some(k => !["projectId", "environment"].includes(k)) ||
      typeof input.projectId !== "string" || !input.projectId.trim() || input.projectId.length > 200 ||
      input.environment !== "local")
    throw Error("无效的项目选择；请从当前设备的项目列表重新选择本地项目");
  return { projectId: input.projectId, environment: "local" };
}

export function savedProjectTarget(selection, catalog) {
  const matches = (catalog?.projects ?? []).filter(p => p.projectId === selection.projectId);
  if (matches.length !== 1) throw Error("所选项目已不存在或无法确认，请重新选择；未创建会话");
  const project = matches[0];
  if ((project.projectKind ?? project.kind) !== "local" || (project.hostId && project.hostId !== "local"))
    throw Error("请选择此设备的本地 Codex 项目；其他电脑的项目请先切换设备");
  return { type: "project", projectId: project.projectId, environment: { type: "local" } };
}
