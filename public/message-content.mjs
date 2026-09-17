// Official desktop message wrappers; parse only complete, recognized envelopes.
export function questionReply(text) {
  const match =
    /^\s*<send_user_message_question_reply>\s*([\s\S]*?)\s*<\/send_user_message_question_reply>\s*$/.exec(
      text ?? "",
    );
  if (!match) return null;
  try {
    const raw = JSON.parse(match[1]),
      rows = Array.isArray(raw) ? raw : [raw];
    return rows.length &&
      rows.every(
        (r) =>
          r &&
          [r.questionItemId, r.question, r.answer].every(
            (v) => typeof v === "string",
          ),
      )
      ? rows
      : null;
  } catch {
    return null;
  }
}
export function asyncQuestions(item) {
  if (item.type !== "agentMessage" || item.delivery !== "async") return [];
  return item.questions?.length
    ? item.questions.map((q, i) => ({
        id: JSON.stringify(["request_user_input_async", item.id, i]),
        title: q.title,
        options: q.options ?? [],
      }))
    : [{ id: item.id, title: item.text, options: [] }];
}
export function userContent(text = "") {
  const match =
    /^\s*# Files (?:mentioned|pasted) by the user:\s*\r?\n([\s\S]*?)^## My request(?: for Codex)?:\s*\r?\n([\s\S]*)$/m.exec(
      text,
    );
  if (!match || match.index !== 0) return { text, files: [] };
  const files = [
    ...match[1].matchAll(/^##\s+(.+?):\s+((?:[A-Za-z]:[\\/]|\/)[^\r\n]+)$/gm),
  ].map((m) => ({ name: m[1], path: m[2].trim() }));
  if (!files.length) return { text, files: [] };
  return { text: match[2].trim(), files };
}
export function itemText(item) {
  return (item.content ?? item.input ?? [])
    .filter((c) => c.type === "text")
    .map((c) => c.text)
    .join("\n");
}

// Display only per-message official timestamps, never the turn or local read time.
export function messageTime(item) {
  const startedMs = item.bridgeMessageStartedAtMs;
  const isStarted = item.type === 'agentMessage' &&
    Number.isSafeInteger(startedMs) && startedMs > 0 && startedMs <= 8.64e15;
  const recorded = item.bridgeRecordedAt;
  const recordMs = typeof recorded === 'string' &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(recorded)
    ? Date.parse(recorded) : NaN;
  const date = new Date(isStarted ? startedMs : recordMs);
  if (!Number.isFinite(date.getTime()) || date.getTime() <= 0) return {
    text: '时间未知', title: '官方未提供此条消息的时间；不使用本轮开始或本设备加载时间代替', iso: null,
  };
  const pad = n => String(n).padStart(2, '0');
  const text = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
  return {
    text: `${isStarted ? '开始接收' : '记录于'} ${text}`,
    title: (isStarted ? '官方此条回复开始到达的时间（item/started），不是整轮开始或本设备加载时间' : '官方消息完成记录时间') +
      '；按当前设备时区显示（' + Intl.DateTimeFormat().resolvedOptions().timeZone + '）',
    iso: date.toISOString(),
  };
}
