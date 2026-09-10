import fs from "node:fs";
import path from "node:path";
// Availability metadata only. Current selection always comes from the owner stream.
export function withServiceTiers(models, officialHome = null) {
  let cache;
  try {
    if (!officialHome || !path.isAbsolute(officialHome)) throw Error("Official catalog directory unavailable");
    cache = JSON.parse(
      fs.readFileSync(
        path.join(
          officialHome,
          "models_cache.json",
        ),
        "utf8",
      ),
    );
  } catch {}
  const fresh =
    cache &&
    Number.isFinite(Date.parse(cache.fetched_at)) &&
    Date.now() >= Date.parse(cache.fetched_at) &&
    Date.now() - Date.parse(cache.fetched_at) < 86400000;
  return models.map((model) => ({
    ...model,
    serviceTiers: fresh
      ? (cache.models?.find((m) => m.slug === model.id)?.service_tiers ?? [])
          .filter((t) => ["priority", "fast"].includes(t.id))
          .map((t) => ({ id: t.id, name: t.name, description: t.description }))
      : [],
    serviceTiersSource: fresh
      ? "official-model-catalog-disk-cache"
      : "unavailable",
    serviceTiersObservedAt: fresh ? cache.fetched_at : null,
  }));
}
export function tierOverride(value, model, models) {
  if (value === undefined) return {};
  if (
    value !== "default" &&
    !models
      .find((m) => m.id === model)
      ?.serviceTiers?.some((t) => t.id === value)
  )
    throw Error("当前模型目录未提供此加速档位，请刷新模型列表");
  return { serviceTier: value };
}
