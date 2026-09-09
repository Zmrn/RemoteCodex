import { zoomableImage } from "./image-viewer.mjs";

// Read a Markdown image without interpreting HTML or executing task content.
export function markdownImageAt(text, start) {
  if (text.slice(start, start + 2) !== "![") return null;
  let at = start + 2, alt = "";
  while (at < text.length && text[at] !== "]") {
    if (text[at] === "\n") return null;
    if (text[at] === "\\" && at + 1 < text.length) at++;
    alt += text[at++];
  }
  if (text.slice(at, at + 2) !== "](") return null;
  at += 2;
  while (text[at] === " ") at++;
  let url = "";
  if (text[at] === "<") {
    const end = text.indexOf(">", ++at);
    if (end < 0) return null;
    url = text.slice(at, end); at = end + 1;
  } else {
    let depth = 0;
    for (; at < text.length; at++) {
      const c = text[at];
      if (c === "\\" && at + 1 < text.length) { url += text[++at]; continue; }
      if (/\s/.test(c)) break;
      if (c === "(" && ++depth > 16) return null;
      if (c === ")") { if (!depth) break; depth--; }
      url += c;
    }
  }
  while (text[at] === " ") at++;
  if (text[at] === '"' || text[at] === "'") {
    const quote = text[at++];
    while (at < text.length && text[at] !== quote && text[at] !== "\n") {
      if (text[at] === "\\") at++;
      at++;
    }
    if (text[at++] !== quote) return null;
    while (text[at] === " ") at++;
  }
  if (text[at] !== ")") return null;
  return { alt, url, end: at + 1 };
}

export function webImageUrl(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || /[\u0000-\u0020]/.test(value)) return null;
    // Images load directly in the viewer. Never route arbitrary URLs through
    // the bridge's privileged local-file or authenticated device endpoints.
    if (/^(?:localhost|.*\.localhost|.*\.local|127\..*|0\..*|10\..*|192\.168\..*|169\.254\..*|172\.(?:1[6-9]|2\d|3[01])\..*|\[.*\])$/i.test(url.hostname)) return null;
    return url.href;
  } catch { return null; }
}

export function remoteMarkdownImage(url, alt) {
  const box = document.createElement("span"), image = document.createElement("img"), fallback = document.createElement("span");
  box.className = "remote-message-image";
  image.alt = alt || "会话图片";
  image.loading = "lazy";
  image.decoding = "async";
  image.referrerPolicy = "no-referrer";
  zoomableImage(image, image.alt);
  fallback.className = "remote-image-error";
  fallback.hidden = true;
  const label = document.createElement("span"), link = document.createElement("a"), retry = document.createElement("button");
  label.textContent = "图片暂时无法加载";
  link.href = url; link.textContent = "打开原图"; link.target = "_blank"; link.rel = "noopener noreferrer";
  retry.type = "button"; retry.textContent = "重试";
  fallback.append(label, link, retry);
  image.onload = () => { image.hidden = false; fallback.hidden = true; };
  image.onerror = () => { image.hidden = true; fallback.hidden = false; };
  retry.onclick = () => { fallback.hidden = true; image.hidden = false; image.removeAttribute("src"); image.src = url; };
  image.src = url;
  box.append(image, fallback);
  return box;
}
