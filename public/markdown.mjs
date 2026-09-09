import { Lexer } from "./marked.mjs";
import { citationParts, missingCitationSource } from "./citations.mjs";
import { remoteMarkdownImage, webImageUrl } from "./markdown-images.mjs";

let citationViewId = 0;
const options = { gfm: true, breaks: true };
const element = (tag, text) => {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  return node;
};

// Decode only an individual entity, never HTML supplied by a task. The decoded
// result still goes into textContent or a separately validated URL attribute.
function entities(text) {
  return String(text ?? "").replace(/&(?:#[0-9]+|#x[0-9a-f]+|[a-z][a-z0-9]+);/gi, entity => {
    const decoder = element("textarea");
    decoder.innerHTML = entity;
    return decoder.value;
  });
}
function linkUrl(value) {
  const href = entities(value);
  if (/[\u0000-\u0020]/.test(href)) return null;
  try {
    const url = new URL(href);
    return ["http:", "https:", "mailto:"].includes(url.protocol) && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}
function appendText(parent, text, citations) {
  for (const part of citationParts(text, citations?.numbers)) {
    if (part.text !== undefined) { parent.append(document.createTextNode(part.text)); continue; }
    const button = element("button", part.refs.length ? "[" + part.refs.join(", ") + "]" : "[引用]");
    button.type = "button";
    button.className = "citation-ref";
    button.title = (part.refs.length ? "来源 " + part.refs.join("、") : "引用信息不完整") + " · 链接未提供";
    button.setAttribute("aria-label", button.title);
    if (citations) {
      citations.used = true;
      button.setAttribute("aria-controls", citations.id);
      button.onclick = () => { citations.notice.open = true; citations.notice.querySelector("summary").focus(); };
    }
    parent.append(button);
  }
}

function renderTokens(parent, tokens, citations, depth = 0) {
  for (const token of tokens ?? []) {
    if (depth > 64) { parent.append(document.createTextNode(token.raw ?? token.text ?? "")); continue; }
    const children = node => renderTokens(node, token.tokens, citations, depth + 1);
    let node;
    switch (token.type) {
      case "space": case "def": continue;
      case "text":
        if (token.tokens) children(parent);
        else appendText(parent, token.escaped ? token.text : entities(token.text), citations);
        continue;
      case "escape": parent.append(document.createTextNode(token.text)); continue;
      case "codespan": node = element("code", token.text); break;
      case "code": {
        node = element("pre");
        const code = element("code", token.text);
        const language = token.lang?.trim().split(/\s+/)[0];
        if (language) node.dataset.language = language;
        node.append(code);
        break;
      }
      case "html":
        // A bare <br> is a useful table-cell line break. All other raw HTML,
        // including scripts, iframes and image tags, remains inert visible text.
        node = /^<br\s*\/?>$/i.test(token.raw) ? element("br") : document.createTextNode(token.raw);
        break;
      case "br": node = element("br"); break;
      case "hr": node = element("hr"); break;
      case "paragraph": node = element("p"); children(node); break;
      case "heading": node = element("h" + Math.max(1, Math.min(6, token.depth))); children(node); break;
      case "strong": case "em": case "del": node = element(token.type); children(node); break;
      case "blockquote": node = element("blockquote"); children(node); break;
      case "link": {
        const href = linkUrl(token.href);
        node = element(href ? "a" : "span");
        if (href) { node.href = href; node.target = "_blank"; node.rel = "noopener noreferrer"; }
        if (token.title) node.title = entities(token.title);
        children(node);
        break;
      }
      case "image": {
        const url = webImageUrl(entities(token.href));
        node = url ? remoteMarkdownImage(url, entities(token.text)) : document.createTextNode(token.raw);
        break;
      }
      case "list": {
        node = element(token.ordered ? "ol" : "ul");
        if (token.ordered && token.start !== 1) node.start = token.start;
        for (const item of token.items) {
          const li = element("li");
          if (item.task) { li.className = "task-list-item"; node.classList.add("task-list"); }
          renderTokens(li, item.tokens, citations, depth + 1);
          node.append(li);
        }
        break;
      }
      case "checkbox":
        node = element("input"); node.type = "checkbox"; node.checked = token.checked; node.disabled = true;
        node.setAttribute("aria-label", token.checked ? "已完成" : "未完成");
        break;
      case "table": {
        node = element("div"); node.className = "table-scroll";
        node.tabIndex = 0; node.setAttribute("role", "region"); node.setAttribute("aria-label", "表格，可横向滚动");
        const table = element("table"), head = element("thead"), body = element("tbody");
        const row = (cells, header) => {
          const tr = element("tr");
          cells.forEach((cell, index) => {
            const td = element(header ? "th" : "td");
            if (header) td.scope = "col";
            if (["left", "center", "right"].includes(token.align[index])) td.style.textAlign = token.align[index];
            renderTokens(td, cell.tokens, citations, depth + 1);
            tr.append(td);
          });
          return tr;
        };
        head.append(row(token.header, true));
        for (const cells of token.rows) body.append(row(cells, false));
        table.append(head, body); node.append(table);
        break;
      }
      default: node = document.createTextNode(token.raw ?? token.text ?? "");
    }
    parent.append(node);
  }
}

export function inline(parent, text, citations) {
  renderTokens(parent, Lexer.lexInline(String(text ?? ""), options), citations);
}
export function markdown(text) {
  const root = element("div"); root.className = "markdown";
  const notice = element("details"), summary = element("summary", "来源链接未提供");
  notice.className = "citation-notice";
  notice.id = "citation-sources-" + ++citationViewId;
  notice.append(summary, element("p", missingCitationSource));
  const citations = { numbers: new Map(), id: notice.id, notice, used: false };
  try { renderTokens(root, Lexer.lex(String(text ?? ""), options), citations); }
  catch {
    // A malformed or deeply nested streamed response must remain readable.
    root.replaceChildren(element("pre", String(text ?? "")));
  }
  if (citations.used) root.append(notice);
  return root;
}
