// Official cite markers carry opaque lookup IDs, not URLs. The current desktop
// history adapter drops the source metadata: never infer a URL from these IDs.
export const missingCitationSource =
  "官方会话读取接口未提供这些引用的网址。请在官方 ChatGPT 中查看来源。";

export function citationParts(text, numbers = new Map()) {
  const parts = [];
  // Only consume the cite marker family; other private-use text stays literal.
  // An unfinished marker at the end can occur during streaming or truncation.
  const re = /\ue200cite\ue202([^\ue200\ue201\n]*)\ue201|\ue200(?:c(?:i(?:t(?:e(?:\ue202[^\ue200\ue201\n]*)?)?)?)?)?$/g;
  let start = 0;
  for (const match of String(text).matchAll(re)) {
    if (match.index > start) parts.push({ text: text.slice(start, match.index) });
    const ids = match[1]?.split("\ue202");
    if (ids?.length && ids.length <= 100 && ids.every(id => /^[A-Za-z0-9][A-Za-z0-9_.:-]*$/.test(id))) {
      const refs = [...new Set(ids)].map(id => {
        if (!numbers.has(id)) numbers.set(id, numbers.size + 1);
        return numbers.get(id);
      });
      parts.push({ refs });
    } else parts.push({ refs: [] });
    start = match.index + match[0].length;
  }
  if (start < text.length) parts.push({ text: text.slice(start) });
  return parts;
}

export function fenceStart(line) {
  return /^\s{0,3}(`{3,}|~{3,})(.*)$/.exec(line);
}
export function fenceEnd(line, marker) {
  return new RegExp("^\\s{0,3}" + marker[0] + "{" + marker.length + ",}\\s*$").test(line);
}

// Keep Markdown and code examples when copying, replacing only real citation
// markup outside code. Use the same numbering order as the rendered message.
export function copyMarkdown(text) {
  const numbers = new Map();
  let fence = null, hadCitations = false;
  const result = String(text ?? "").split(/(\r?\n)/).map(line => {
    if (fence) { if (fenceEnd(line, fence)) fence = null; return line; }
    const open = fenceStart(line);
    if (open) { fence = open[1]; return line; }
    return line.split(/(`+[^`\n]+`+)/g).map(part => {
      if (/^(`+)[^`\n]+\1$/.test(part)) return part;
      return citationParts(part, numbers).map(p => {
        if (p.text !== undefined) return p.text;
        hadCitations = true;
        return p.refs.length ? "[来源 " + p.refs.join(", ") + "]" : "[引用信息不完整]";
      }).join("");
    }).join("");
  }).join("");
  return result + (hadCitations ? "\n\n注：" + missingCitationSource : "");
}
