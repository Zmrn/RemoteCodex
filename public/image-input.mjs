// Steering carries input plus restoreMessage. 10 MiB raw becomes ~26.7 MiB
// across those two copies, leaving room under the official 32 MiB IPC limit.
export const IMAGE_LIMITS = Object.freeze({ count: 20, fileBytes: 5 * 1024 * 1024, totalBytes: 10 * 1024 * 1024 });
export const REQUEST_BYTES = 24 * 1024 * 1024;
export function validateImageBatch(files) {
  if (files.length > IMAGE_LIMITS.count) throw Error("每条消息最多添加 20 张图片");
  let total = 0;
  for (const file of files) {
    if (!file || !["image/png", "image/jpeg", "image/webp"].includes(file.type)) throw Error("请使用 PNG、JPEG 或 WebP 图片");
    if (!file.size || file.size > IMAGE_LIMITS.fileBytes) throw Error("每张图片大小需在 5 MB 以内");
    total += file.size;
  }
  if (total > IMAGE_LIMITS.totalBytes) throw Error("每条消息的图片合计不得超过 10 MB");
  return files;
}
export function imageUrls(value) {
  if (value === undefined || value === null) return [];
  if (typeof value === "string") return value ? [value] : [];
  if (!Array.isArray(value)) throw Error("Invalid images");
  return value;
}
export function validateImageUrls(value) {
  const urls = imageUrls(value);
  validateImageBatch(urls.map(url => {
    if (typeof url !== "string" || !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]*={0,2}$/.test(url)) throw Error("Invalid image data");
    const base64 = url.slice(url.indexOf(",") + 1);
    if (base64.length % 4 !== 0) throw Error("Invalid image data");
    return { type: url.slice(5, url.indexOf(";")), size: base64.length / 4 * 3 - (base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0) };
  }));
  return urls;
}
export function imagesFromBody(body) {
  if (body.imageDataUrls !== undefined && body.imageDataUrl !== undefined) throw Error("Conflicting image fields");
  return validateImageUrls(body.imageDataUrls ?? body.imageDataUrl);
}
// Retain the old single-image wire format for older Windows targets.
export function imagePayload(urls, multiImageSupported) {
  validateImageUrls(urls);
  if (urls.length > 1 && !multiImageSupported) throw Error("目标电脑尚不支持多图，请先将该电脑的 Remote Codex 更新到 0.10.4 或更高版本；图片已保留");
  return urls.length > 1 ? { imageDataUrls: urls } : urls.length ? { imageDataUrl: urls[0] } : {};
}
