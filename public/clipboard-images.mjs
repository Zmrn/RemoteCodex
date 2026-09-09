import { validateImageBatch } from "./image-input.mjs";
export function clipboardImages(data) {
  // files and items are two views of the same clipboard; never append both.
  const files = [...(data?.files ?? [])].filter(file => file.type.startsWith("image/"));
  if (files.length) return files;
  for (const item of data?.items ?? []) {
    if (item.kind === "file") {
      const file = item.getAsFile();
      if (file?.type.startsWith("image/")) files.push(file);
    }
  }
  return files;
}
export const clipboardImage = data => clipboardImages(data)[0] ?? null;
export function validateImage(file) {
  validateImageBatch([file]);
  return file;
}
