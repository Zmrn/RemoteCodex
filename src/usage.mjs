// Only quota display fields leave the adapter. No account IDs or credit details.
export function weeklyUsage(raw, observedAt = new Date().toISOString()) {
  const byId = raw?.rateLimitsByLimitId;
  const buckets =
    byId &&
    typeof byId === "object" &&
    !Array.isArray(byId) &&
    Object.keys(byId).length
      ? Object.entries(byId)
      : raw?.rateLimits
        ? [[raw.rateLimits.limitId ?? "codex", raw.rateLimits]]
        : [];
  const weekly = [];
  for (const [id, bucket] of buckets) {
    for (const window of ["primary", "secondary"]) {
      const value = bucket?.[window];
      if (value?.windowDurationMins !== 10080) continue;
      const used = value.usedPercent;
      const confirmed = typeof used === "number" && Number.isFinite(used);
      weekly.push({
        limitId: id,
        label: bucket.limitName || (id === "codex" ? "Codex" : id),
        window,
        windowDurationMins: 10080,
        usedPercent: confirmed ? used : null,
        remainingPercent: confirmed
          ? Math.max(0, Math.min(100, 100 - used))
          : null,
        resetsAt:
          typeof value.resetsAt === "number" &&
          Number.isFinite(value.resetsAt) &&
          value.resetsAt > 0
            ? value.resetsAt
            : null,
      });
    }
  }
  weekly.sort(
    (a, b) => Number(b.limitId === "codex") - Number(a.limitId === "codex"),
  );
  return {
    source: "official-desktop-app-tools-live",
    scope: "selected-device-account-shared",
    observedAt,
    status: weekly.some((w) => w.remainingPercent !== null)
      ? "available"
      : "unknown",
    weekly,
  };
}
