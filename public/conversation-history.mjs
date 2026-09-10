// Items can be split across pages; merging whole turns would discard a page.
export function mergeTurns(current, incoming, older = false) {
  const map = new Map(current.map((turn) => [turn.id, turn]));
  for (const turn of incoming) {
    const previous = map.get(turn.id);
    if (!previous || !turn.bridgePartial) {
      if (!older || !previous) map.set(turn.id, turn);
      continue;
    }
    // The newest official snapshot owns membership and order, including removals.
    // A page from an older cursor can fill gaps but cannot resurrect deleted IDs.
    const ids = older ? previous.bridgeItemIds : turn.bridgeItemIds;
    const positions = Array.isArray(ids) ? new Map(ids.map((id, n) => [id, n])) : null;
    const items = new Map((previous.items ?? [])
      .filter(item => !positions || positions.has(item.id)).map(item => [item.id, item]));
    for (const item of turn.items ?? []) {
      if (positions && !positions.has(item.id)) continue;
      if (!older || !items.has(item.id)) items.set(item.id, item);
    }
    map.set(turn.id, {
      ...(older ? { ...turn, ...previous } : { ...previous, ...turn }),
      items: [...items.values()].map(item => positions ? { ...item, bridgeItemIndex: positions.get(item.id) } : item).sort(
        (a, b) => a.bridgeItemIndex - b.bridgeItemIndex,
      ),
    });
  }
  return [...map.values()];
}
export function overlaps(current, incoming) {
  const ids = new Set(
    current.flatMap((t) =>
      t.items?.length ? t.items.map((i) => t.id + ":" + i.id) : [t.id],
    ),
  );
  return incoming.some((t) =>
    t.items?.length
      ? t.items.some((i) => ids.has(t.id + ":" + i.id))
      : ids.has(t.id),
  );
}
