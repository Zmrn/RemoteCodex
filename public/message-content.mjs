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
