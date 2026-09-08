// These IDs exclude automated Probe writes, not the user's normal conversation.
export const testExcludedThreadIds = () => [
  ...new Set(
    [
      process.env.REMOTE_BRIDGE_DEVELOPMENT_THREAD_ID,
      process.env.CODEX_THREAD_ID,
    ].filter(Boolean),
  ),
];
export function assertProbeTarget(status, id) {
  const excluded = new Set([
    ...testExcludedThreadIds(),
    ...(status.testExcludedThreadIds ?? []),
    ...(status.protectedThreadIds ?? []),
    status.protectedThreadId,
  ]);
  if (excluded.has(id))
    throw Error("protected-development-thread: excluded from automated probes");
  if (typeof id !== "string" || !/^[a-f0-9-]{36}$/.test(id))
    throw Error("Invalid official task ID");
  if (!Object.hasOwn(status.testThreads ?? {}, id))
    throw Error("此操作仍仅适用于桥接器创建的测试任务");
}
