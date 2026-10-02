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
  return models.map((model) => {
    const live = Array.isArray(model.serviceTiers);
    const stored = fresh && Array.isArray(cache.models)
      ? cache.models.find(m => m?.slug === model.id)?.service_tiers : null;
    const tiers = live ? model.serviceTiers : Array.isArray(stored) ? stored : [];
    return {
      ...model,
      serviceTiers: tiers
        .filter(t => t && ['priority', 'fast', 'ultrafast'].includes(t.id))
        .filter((t, index, all) => all.findIndex(other => other.id === t.id) === index)
        .map(t => ({ id: t.id, name: t.name, description: t.description })),
      serviceTiersSource: live ? 'official-desktop-tools-schema-live' : fresh
        ? 'official-model-catalog-disk-cache' : 'unavailable',
      serviceTiersObservedAt: live ? null : fresh ? cache.fetched_at : null,
    };
  });
}
export function tierOverride(value, model, models) {
  if (value === undefined) return {};
  if (
    typeof value !== 'string' || !['default', 'priority', 'fast', 'ultrafast'].includes(value) ||
    (value !== "default" && !models
      .find((m) => m.id === model)
      ?.serviceTiers?.some((t) => t.id === value))
  )
    throw Error("当前模型目录未提供此加速档位，请刷新模型列表");
  return { serviceTier: value };
}
