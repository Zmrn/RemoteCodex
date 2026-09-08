// Items can be split across pages; merging whole turns would discard a page.
export function mergeTurns(current, incoming, older = false) {
  const map = new Map(current.map((turn) => [turn.id, turn]));
  for (const turn of incoming) {
    const previous = map.get(turn.id);
    if (!previous || !turn.bridgePartial) {
      if (!older || !previous) map.set(turn.id, turn);
      continue;
    }
    const items = new Map(
      (previous.items ?? []).map((item) => [item.id, item]),
    );
    for (const item of turn.items ?? []) {
      if (!older || !items.has(item.id)) items.set(item.id, item);
    }
    map.set(turn.id, {
      ...(older ? { ...turn, ...previous } : { ...previous, ...turn }),
      items: [...items.values()].sort(
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
