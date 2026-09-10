import { randomUUID } from "node:crypto";
import { conversationView } from "./state.mjs";

// Paging is only a view of official data. Snapshots never own or control turns.
export class ConversationPages {
  constructor({
    maxItems = 40,
    maxBytes = 128 * 1024,
    maxSnapshots = 32,
    maxCacheBytes = 32 * 1024 * 1024,
    ttlMs = 30 * 60 * 1000,
  } = {}) {
    Object.assign(this, {
      maxItems,
      maxBytes,
      maxSnapshots,
      maxCacheBytes,
      ttlMs,
    });
    this.snapshots = new Map();
  }
  prune() {
    const now = Date.now();
    for (const [key, value] of this.snapshots)
      if (now - value.at > this.ttlMs) this.snapshots.delete(key);
    let bytes = [...this.snapshots.values()].reduce((n, s) => n + s.bytes, 0);
    while (
      this.snapshots.size > this.maxSnapshots ||
      bytes > this.maxCacheBytes
    ) {
      const key = this.snapshots.keys().next().value;
      bytes -= this.snapshots.get(key).bytes;
      this.snapshots.delete(key);
    }
  }
  touch(threadId, cursor) {
    const key = cursor?.split(":")[0],
      value = this.snapshots.get(key);
    if (value?.threadId !== threadId) return;
    value.at = Date.now();
    this.snapshots.delete(key);
    this.snapshots.set(key, value);
  }
  snapshot(threadId, result) {
    const view = conversationView(result);
    const rows = (view.data.turns ?? []).flatMap((turn) =>
      turn.items?.length
        ? turn.items
            .map((item, index) => ({
              turn,
              item: { ...item, bridgeItemIndex: index },
            }))
            .reverse()
        : [{ turn, item: null }],
    );
    const key = randomUUID(),
      bytes = Buffer.byteLength(JSON.stringify(view));
    const value = {
      threadId,
      view,
      rows,
      bytes,
      at: Date.now(),
      nextKey: null,
      pending: null,
    };
    if (bytes > this.maxCacheBytes)
      throw Error("单段历史过大，暂时无法分页读取；请在官方桌面查看");
    this.snapshots.set(key, value);
    this.prune();
    return { key, value };
  }
  async read(threadId, before, readOfficial) {
    this.prune();
    let key,
      value,
      offset = 0;
    if (before) {
      const match = /^([a-f0-9-]{36}):(\d+)$/.exec(before);
      value = match && this.snapshots.get(match[1]);
      offset = match ? Number(match[2]) : -1;
      if (
        !value ||
        value.threadId !== threadId ||
        offset < 0 ||
        !Number.isSafeInteger(offset) ||
        offset > value.rows.length
      )
        throw Error("历史分页已失效，请重新打开此会话后继续加载");
      key = match[1];
      value.at = Date.now();
      this.snapshots.delete(key);
      this.snapshots.set(key, value);
      if (offset === value.rows.length) {
        const cursor = value.view.data.page?.nextCursor;
        if (!cursor) throw Error("没有更早的消息");
        // Retrying a view cursor returns the same page, even as new turns arrive.
        const parent = value,
          cached = this.snapshots.get(parent.nextKey);
        if (cached) {
          key = parent.nextKey;
          value = cached;
        } else {
          parent.pending ??= readOfficial(cursor)
            .then((result) => {
              const child = this.snapshot(threadId, result);
              parent.nextKey = child.key;
              return child;
            })
            .finally(() => {
              parent.pending = null;
            });
          ({ key, value } = await parent.pending);
        }
        offset = 0;
      }
    } else ({ key, value } = this.snapshot(threadId, await readOfficial(null)));
    const selected = [];
    let bytes = 0,
      end = offset;
    while (end < value.rows.length && selected.length < this.maxItems) {
      const row = value.rows[end],
        size = Buffer.byteLength(JSON.stringify(row.item));
      if (selected.length && bytes + size > this.maxBytes) break;
      selected.push(row);
      bytes += size;
      end++;
    }
    const turns = new Map();
    for (const { turn, item } of selected) {
      if (!turns.has(turn.id))
        turns.set(turn.id, { ...turn, items: [], bridgePartial: true,
          bridgeItemIds: (turn.items ?? []).map(i => i.id) });
      if (item) turns.get(turn.id).items.unshift(item);
    }
    for (const turn of turns.values()) {
      const first = turn.items[0]?.bridgeItemIndex ?? 0;
      const last = turn.items.at(-1)?.bridgeItemIndex ?? -1;
      turn.bridgeRange = { start: first, end: last };
    }
    const more = end < value.rows.length || !!value.view.data.page?.nextCursor;
    return {
      ...value.view,
      data: {
        ...value.view.data,
        turns: [...turns.values()],
        page: {
          order: "newest_first",
          pagination: "items-v1",
          nextCursor: more ? key + ":" + end : null,
          hasMore: more,
          limit: this.maxItems,
        },
      },
    };
  }
}

// Keep the fields the conversation UI actually renders, not hidden raw tool
// payloads or a second copy of every image. Full official reads stay unchanged.
export function compactConversation(data) {
  return {
    ...data,
    turns: (data.turns ?? []).map((turn) => ({
      ...turn,
      items: (turn.items ?? []).flatMap((item) => {
        const base = { id: item.id, type: item.type, status: item.status };
        const display = item.bridgeDisplay;
        switch (item.type) {
          case "userMessage":
          case "steeringUserMessage":
            return [
              {
                ...base,
                content: (item.content ?? item.input ?? []).filter(
                  (c) => c.type === "text",
                ),
                bridgeDisplay: display,
              },
            ];
          case "agentMessage":
            return [
              {
                ...base,
                text: item.text,
                delivery: item.delivery,
                questions: item.questions,
                bridgeDisplay: display,
              },
            ];
          case "userInputResponse":
            return [
              {
                ...base,
                requestId: item.requestId,
                questions: item.questions,
                answers: item.answers,
                completed: item.completed,
              },
            ];
          case "functionCallOutput": {
            const text =
              typeof item.output === "string" ? item.output : item.output?.text;
            const input =
              item.namespace === "codex_app" &&
              /<input>([\s\S]*?)<\/input>/.exec(text ?? "");
            return input
              ? [
                  {
                    ...base,
                    namespace: item.namespace,
                    output: input[0],
                    bridgeDisplay: display,
                  },
                ]
              : [];
          }
          case "imageGeneration":
            return [{ ...base, bridgeDisplay: display }];
          case "commandExecution":
            return [
              {
                ...base,
                command: item.command,
                output: String(item.output ?? "").slice(0, 6000),
              },
            ];
          case "fileChange":
            return [{ ...base, changes: item.changes }];
          default:
            return [];
        }
      }),
    })),
  };
}
