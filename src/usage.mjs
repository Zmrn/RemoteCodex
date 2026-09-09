// Only quota display fields leave the adapter. No account IDs or credit details.
export function accountUsage(raw, observedAt = new Date().toISOString()) {
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
  const weekly = [], fiveHour = [];
  for (const [id, bucket] of buckets) {
    for (const window of ["primary", "secondary"]) {
      const value = bucket?.[window];
      const duration = value?.windowDurationMins;
      if (duration !== 10080 && duration !== 300) continue;
      const used = value.usedPercent;
      const confirmed = typeof used === "number" && Number.isFinite(used);
      (duration === 300 ? fiveHour : weekly).push({
        limitId: id,
        label: bucket.limitName || (id === "codex" ? "Codex" : id),
        window,
        windowDurationMins: duration,
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
  const order =
    (a, b) => Number(b.limitId === "codex") - Number(a.limitId === "codex"),
    primary = buckets.find(([id]) => id === "codex")?.[1] ?? buckets[0]?.[1];
  weekly.sort(order); fiveHour.sort(order);
  const planType = ["free", "plus", "pro", "team", "business", "enterprise", "edu"].includes(primary?.planType) ? primary.planType : null;
  return {
    schemaVersion: 2,
    source: "official-desktop-app-tools-live",
    scope: "selected-device-account-shared",
    observedAt,
    planType,
    status: [...fiveHour, ...weekly].some((w) => w.remainingPercent !== null)
      ? "available"
      : "unknown",
    weekly,
    fiveHour,
  };
}

// Compatibility for existing callers; the weekly field remains unchanged.
export const weeklyUsage = accountUsage;
